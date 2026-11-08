import { validateWorldExperience } from './WorldExperience.js';
import { collisionPathStatus, sweptCollisionCellKeys } from './CollisionFrontier.js';
import { PLAYER_EYE_HEIGHT } from '../player/PlayerDimensions.js';
import { parseGLB } from '../engine/loaders/GLTF.js';
import { fetchGLBWithCoarseKTX2 } from '../engine/loaders/GLBRange.js';
import { isWorldID } from './WorldIdentity.js';
import { playerCapsuleParameters } from './WorldRules.js';
import { LocalRegionDiskCache } from './LocalRegionDiskCache.js';
import { localRegionStaticModelSets, localRegionVisualStreamingBounds } from './LocalRegionStaticModels.js';
import { decodeStaticModelInstanceSet, MAX_STATIC_MODEL_INSTANCE_SET_BYTES, STATIC_MODEL_INSTANCE_SET_ASSET_KIND } from './StaticModelInstanceSet.js';
import { worldComponentAssetIDs } from './WorldComponentRegistry.js';
import { PriorityRequestQueue } from './PriorityRequestQueue.js';
import { worldViewCellCoordinates } from './WorldViewCells.js';

const MAX_LOCAL_REGION_BYTES = 768 * 1024 * 1024;
const MAX_LOCAL_REGION_DISK_WRITE_QUEUE_BYTES = 768 * 1024 * 1024;
const MAX_LOCAL_REGION_DISK_WRITE_BATCH_ENTRIES = 64;
const DEFAULT_LOCAL_REGION_CACHE_BYTES = 128 * 1024 * 1024;
const MAX_LOCAL_REGION_CACHE_BYTES = 1024 * 1024 * 1024;
const MIN_LOCAL_REGION_CACHE_BYTES = 64 * 1024 * 1024;
const LOCAL_REGION_CACHE_BYTES_PER_GIB = 64 * 1024 * 1024;
const REGION_LEASE_RENEW_MS = 10000;
// Provisional shared request budget: browsers do not expose their per-origin
// connection limit. Two data requests leave control headroom in Chromium.
const REGION_DATA_REQUEST_LIMIT = 2;
// Provisional render-prefetch radius; tune it from streamed-cell latency and cache telemetry.
const LOCAL_REGION_PREFETCH_RADIUS_CELLS = 4;
// worldd's dynamic-provider gateway limits raw query strings to 4096 characters.
const LOCAL_REGION_CELL_QUERY_LIMIT = 4096;
const LOCAL_REGION_CELL_BATCH_LIMIT = 512;
const EMPTY_GLB = createEmptyGlb();
const EXTERNAL_TEXTURE_ID = /^(?:sha256:[0-9a-f]{64}|source:[A-Za-z0-9_-]{1,2040})$/;
const LOCAL_REGION_ETAG = /^\"(?:sha256-[0-9a-f]{64}|source:[A-Za-z0-9_-]{1,2040})\"$/;

function isSourceTextureID( assetId ) {
	return typeof assetId === 'string' && assetId.startsWith( 'source:' );
}

function textureAssetETag( assetId ) {
	return isSourceTextureID( assetId ) ? `"${assetId}"` : null;
}

function createEmptyGlb() {
	const json = new TextEncoder().encode( JSON.stringify( { asset: { version: '2.0' }, scene: 0, scenes: [ { nodes: [] } ], nodes: [] } ) );
	const jsonLength = ( json.byteLength + 3 ) & ~3;
	const bytes = new Uint8Array( 20 + jsonLength );
	const view = new DataView( bytes.buffer );
	view.setUint32( 0, 0x46546c67, true );
	view.setUint32( 4, 2, true );
	view.setUint32( 8, bytes.byteLength, true );
	view.setUint32( 12, jsonLength, true );
	view.setUint32( 16, 0x4e4f534a, true );
	bytes.fill( 0x20, 20 );
	bytes.set( json, 20 );
	return bytes;
}

function requireValue( value, message ) {
	if ( ! value ) throw new Error( message );
}

function externalTextureAssetIDs( bytes ) {
	if ( ! ( bytes instanceof Uint8Array ) || bytes.byteLength < 20 ) return [];
	const header = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	if ( header.getUint32( 0, true ) !== 0x46546c67 || header.getUint32( 4, true ) !== 2 || header.getUint32( 16, true ) !== 0x4e4f534a ) return [];
	const jsonLength = header.getUint32( 12, true );
	if ( jsonLength < 2 || jsonLength > bytes.byteLength - 20 ) return [];
	let document;
	try { document = JSON.parse( new TextDecoder().decode( bytes.subarray( 20, 20 + jsonLength ) ) ); } catch { return []; }
	return [ ...new Set( ( document.images || [] ).map( image => image.extensions?.EXT_elsemesh_asset_reference?.assetId )
		.filter( assetId => typeof assetId === 'string' && EXTERNAL_TEXTURE_ID.test( assetId ) ) ) ];
}

function localRegionCacheBudgetBytes() {
	// deviceMemory is a coarse, browser-bounded physical-memory hint, not a
	// free-RAM measurement. Use a conservative ceiling when unavailable.
	const deviceMemory = globalThis.navigator?.deviceMemory;
	if ( ! Number.isFinite( deviceMemory ) || deviceMemory <= 0 ) return DEFAULT_LOCAL_REGION_CACHE_BYTES;
	return Math.min( MAX_LOCAL_REGION_CACHE_BYTES, Math.max( MIN_LOCAL_REGION_CACHE_BYTES, Math.floor( deviceMemory * LOCAL_REGION_CACHE_BYTES_PER_GIB ) ) );
}

function cellCoordinate( position, sizeMeters ) {
	const coordinate = Math.floor( position / sizeMeters );
	requireValue( Number.isSafeInteger( coordinate ), 'Local provider has a preview spawn outside the supported cell range' );
	return coordinate;
}

function deriveStartupCells( position, previewRegion, playerCapsule ) {
	const { cellSizeMeters } = previewRegion;
	const spawnFoot = [ position[ 0 ], position[ 1 ] - PLAYER_EYE_HEIGHT, position[ 2 ] ];
	return [ ...sweptCollisionCellKeys( spawnFoot, spawnFoot, {
		cellSizeMeters, radius: playerCapsule.radiusMeters, height: playerCapsule.heightMeters,
	} ) ]
		.map( key => key.split( ',' ).map( Number ) );
}

function abortIfNeeded( signal ) {
	if ( signal?.aborted ) throw signal.reason || new DOMException( 'Aborted', 'AbortError' );
}

function hasEmbeddedCollisionShape( bytes ) {
	const parsed = parseGLB( bytes );
	return parsed.nodes.some( node => {
		const collision = node.extras?.elsemeshCollision;
		if ( collision?.coordinateSystem !== 'elsemesh-y-up-meters/1' ) return false;
		return [ 'boxes', 'spheres', 'capsules', 'taperedCapsules', 'convexes' ].some( key => Array.isArray( collision[ key ] ) && collision[ key ].length > 0 );
	} );
}

async function fetchJSON( url, signal ) {
	const response = await fetch( url, { credentials: 'omit', cache: 'no-store', signal } );
	if ( ! response.ok ) throw new Error( `Local region provider returned HTTP ${response.status}` );
	return response.json();
}

async function fetchJSONBytes( url, signal ) {
	const response = await fetch( url, { credentials: 'omit', cache: 'no-store', signal } );
	if ( ! response.ok ) throw new Error( `Local region provider returned HTTP ${response.status}` );
	const bytes = new Uint8Array( await response.arrayBuffer() );
	return { bytes, value: JSON.parse( new TextDecoder().decode( bytes ) ) };
}

function findBytes( haystack, needle, start = 0 ) {
	for ( let index = start; index <= haystack.byteLength - needle.byteLength; index ++ ) {
		let match = true;
		for ( let offset = 0; offset < needle.byteLength; offset ++ ) if ( haystack[ index + offset ] !== needle[ offset ] ) { match = false; break; }
		if ( match ) return index;
	}
	return - 1;
}

async function parseByteRangeResponse( response ) {
	const contentType = response.headers.get( 'Content-Type' ) || '';
	const multipart = contentType.match( /^multipart\/byteranges\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i );
	if ( ! multipart ) {
		const contentRange = response.headers.get( 'Content-Range' )?.match( /^bytes (\d+)-(\d+)\/(\d+)$/ );
		requireValue( contentRange, 'Local region byte-range response has no valid Content-Range' );
		return [ { start: Number( contentRange[ 1 ] ), end: Number( contentRange[ 2 ] ), totalLength: Number( contentRange[ 3 ] ), bytes: new Uint8Array( await response.arrayBuffer() ) } ];
	}
	const boundary = multipart[ 1 ] || multipart[ 2 ];
	const body = new Uint8Array( await response.arrayBuffer() );
	const marker = new TextEncoder().encode( `--${boundary}` );
	const separator = new TextEncoder().encode( '\r\n--' );
	const headerSeparator = new TextEncoder().encode( '\r\n\r\n' );
	const decoder = new TextDecoder( 'ascii' );
	const parts = [];
	let cursor = 0;
	while ( cursor < body.byteLength ) {
		requireValue( findBytes( body, marker, cursor ) === cursor, 'Local region multipart byte-range boundary is invalid' );
		cursor += marker.byteLength;
		if ( body[ cursor ] === 0x2d && body[ cursor + 1 ] === 0x2d ) break;
		requireValue( body[ cursor ] === 0x0d && body[ cursor + 1 ] === 0x0a, 'Local region multipart byte-range part has no header separator' );
		cursor += 2;
		const headerEnd = findBytes( body, headerSeparator, cursor );
		requireValue( headerEnd >= 0, 'Local region multipart byte-range headers are truncated' );
		const headers = decoder.decode( body.subarray( cursor, headerEnd ) );
		const contentRange = headers.match( /(?:^|\r\n)Content-Range:\s*bytes (\d+)-(\d+)\/(\d+)(?:\r\n|$)/i );
		requireValue( contentRange, 'Local region multipart part has no valid Content-Range' );
		const start = Number( contentRange[ 1 ] ), end = Number( contentRange[ 2 ] ), totalLength = Number( contentRange[ 3 ] );
		cursor = headerEnd + headerSeparator.byteLength;
		const delimiter = findBytes( body, separator, cursor );
		requireValue( delimiter >= 0 && delimiter - cursor === end - start + 1, 'Local region multipart byte-range body length is invalid' );
		parts.push( { start, end, totalLength, bytes: body.slice( cursor, delimiter ) } );
		cursor = delimiter + 2;
	}
	return parts;
}

export class LocalRegionConnector {
	constructor( { localProvider, localMap, regionDiagnostics = false } ) {
		this.localOnly = true;
		this.localProvider = new URL( localProvider ).origin;
		this.localMap = localMap;
		this.regionDiagnostics = regionDiagnostics;
		this.worldId = '';
		this.nodeId = '';
		this.gateway = this.localProvider;
		this.directory = '';
		this.providers = [];
		const memoryCacheBudgetBytes = localRegionCacheBudgetBytes();
		this.assets = new Map();
		this.assetBytes = 0;
		this.assetCacheBudgetBytes = Math.floor( memoryCacheBudgetBytes * 0.8 );
		this.assetRanges = new Map();
		this.assetRangeBytes = 0;
		this.assetRangeCacheBudgetBytes = memoryCacheBudgetBytes - this.assetCacheBudgetBytes;
		this.regionAssets = new Map();
		this.regionRequestQueue = new PriorityRequestQueue( REGION_DATA_REQUEST_LIMIT );
		this.syntheticAssetLoaders = new Map();
		this.collisionAssetIDs = new Set();
		this.collisionObjectIDByAsset = new Map();
		this.unknownCollisionObjectIDs = new Set();
		this.missingCollisionPayloadObjectIDs = new Set();
		this.unverifiedCollisionSourceObjectIDs = new Set();
		this.verifiedEmptyCollisionObjectIDs = new Set();
		this.collisionObjectIDsExpectShape = new Set();
		this.collisionObjectIDsMissingKnownShape = new Set();
		this.collisionObjectIDsByCell = new Map();
		this.unknownSourcesByCell = new Map();
		this.unknownSourcesCompleteByCell = new Map();
		this.emptyCollisionCellsAreVerified = false;
		this.lastCollisionPathStatus = null;
		this.lastCollisionPathDiagnostic = null;
		this.collisionLoadLatencyMs = 2000;
		this.cellSizeMeters = 0;
		this.maxViewDistanceMeters = 0;
		this.manifest = null;
		this.closed = false;
		this.diskCache = null;
		this.pendingDiskWriteBytes = 0;
		this.pendingDiskWriteEntries = [];
		this.diskWriteFlushTimer = null;
	}

	async getManifest( { signal } = {} ) {
		abortIfNeeded( signal );
		const base = `${this.localProvider}/v1`;
		const descriptor = await fetchJSON( `${base}/descriptor`, signal );
		requireValue( descriptor.schema === 'elsemesh.dynamic-region-provider/1' && descriptor.readOnly === true && typeof descriptor.sourceRevision === 'string' && isWorldID( descriptor.worldId ) && ( descriptor.title === undefined || typeof descriptor.title === 'string' && descriptor.title.trim() && descriptor.title.length <= 160 ), 'Local provider returned an unsupported descriptor' );
		const cacheRevision = descriptor.cacheRevision;
		requireValue( typeof cacheRevision === 'string' && cacheRevision.trim() && cacheRevision.length <= 512, 'Local provider returned an invalid cache revision' );
		const selection = descriptor.entrySelection;
		requireValue( selection && ( selection.schema === undefined || selection.schema === 'elsemesh.world-entry-selection/1' ) && typeof selection.entryPointActionLabel === 'string' && selection.entryPointActionLabel.trim() && selection.entryPointActionLabel.length <= 80 && typeof selection.entryPointPrompt === 'string' && selection.entryPointPrompt.trim() && Array.isArray( selection.choices ) && selection.choices.length <= 16 && new Set( selection.choices.map( choice => choice?.id ) ).size === selection.choices.length && selection.choices.every( choice => /^[a-z0-9][a-z0-9.-]{0,63}$/.test( choice?.id || '' ) && typeof choice.label === 'string' && choice.label.trim() && choice.label.length <= 80 ) && selection.previewSpawn && Array.isArray( selection.previewSpawn.position ) && selection.previewSpawn.position.length === 3 && selection.previewSpawn.position.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) && Number.isFinite( selection.previewSpawn.yaw ) && Math.abs( selection.previewSpawn.yaw ) <= 360 && ( selection.previewSpawn.pitch === undefined || Number.isFinite( selection.previewSpawn.pitch ) && Math.abs( selection.previewSpawn.pitch ) <= 1.5 ), 'Local provider has no valid world-authored entry selection or preview pose' );
		const previewRegion = selection.previewRegion;
		requireValue( previewRegion && Number.isInteger( previewRegion.cellSizeMeters ) && previewRegion.cellSizeMeters >= 8 && previewRegion.cellSizeMeters <= 256, 'Local provider has no valid preview cell size' );
		requireValue( Number.isFinite( previewRegion.maxViewDistanceMeters ) && previewRegion.maxViewDistanceMeters > 0 && previewRegion.maxViewDistanceMeters <= 10000, 'Local provider has no valid world-authored cell view distance' );
		const playerCapsule = playerCapsuleParameters( { playerCapsule: selection.playerCapsule } );
		const startupCells = deriveStartupCells( selection.previewSpawn.position, previewRegion, playerCapsule );
		if ( selection.previewSupport !== undefined ) {
			const support = selection.previewSupport;
			requireValue( support?.status === 'provisional' && typeof support.basis === 'string' && support.basis.length <= 500 && Array.isArray( support.position ) && support.position.length === 3 && support.position.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) && Array.isArray( support.halfExtents ) && support.halfExtents.length === 3 && support.halfExtents.every( value => Number.isFinite( value ) && value > 0 && value <= 1000 ) && ( support.yaw === undefined || Number.isFinite( support.yaw ) && Math.abs( support.yaw ) <= 360 ), 'Local provider has invalid provisional preview support' );
		}
		const experience = selection.experience ? structuredClone( validateWorldExperience( selection.experience ) ) : null;
		if ( experience?.theme?.logo?.src.startsWith( '/' ) ) experience.theme.logo.src = new URL( experience.theme.logo.src, `${base}/` ).href;
		if ( experience?.navigation?.map?.src.startsWith( '/' ) ) experience.navigation.map.src = new URL( experience.navigation.map.src, `${base}/` ).href;
		const catalog = await fetchJSON( new URL( descriptor.regions, `${base}/descriptor` ), signal );
		requireValue( Array.isArray( catalog.regions ) && catalog.regions.length <= 10000, 'Local provider returned an invalid region catalog' );
		const region = catalog.regions.find( item => item.id === this.localMap || item.label === this.localMap );
		requireValue( region && typeof region.id === 'string' && typeof region.asset === 'string', `No local map matches “${this.localMap}”` );
		const layerLabels = previewRegion.layers || [];
		requireValue( Array.isArray( layerLabels ) && layerLabels.length <= 8 && layerLabels.every( label => typeof label === 'string' && label.trim() && label.length <= 160 ) && new Set( layerLabels ).size === layerLabels.length, 'Local provider has invalid preview layers' );
		const regions = [ region, ...layerLabels.map( label => catalog.regions.find( item => item.id === label || item.label === label ) ) ];
		requireValue( regions.every( item => item && typeof item.id === 'string' && typeof item.asset === 'string' ) && new Set( regions.map( item => item.id ) ).size === regions.length, 'Local provider is missing or duplicates a preview layer' );
		this.cellSizeMeters = previewRegion.cellSizeMeters;
		this.maxViewDistanceMeters = previewRegion.maxViewDistanceMeters;
		const assetURL = new URL( region.asset, `${base}/` );
		requireValue( assetURL.origin === this.localProvider && assetURL.pathname.startsWith( '/v1/regions/' ), 'Local provider returned an unsafe region URL' );
		this.region = region;
		this.worldId = descriptor.worldId;
		this.sourceRevision = descriptor.sourceRevision;
		this.cacheRevision = cacheRevision;
		this.diskCache = await LocalRegionDiskCache.open( {
			worldId: this.worldId,
			cacheRevision: this.cacheRevision,
			onError: error => { if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region disk cache unavailable:', error ); },
			onMetric: metric => { if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region disk cache index:', JSON.stringify( metric ) ); },
		} );
		const startupCellKeys = new Set( startupCells.map( cell => cell.join( ',' ) ) );
		this.allCollisionSourcesIndexed = true;
		this.emptyCollisionCellsAreVerified = true;
		this.initialRegionCellObjectIDs = new Set();
		this.initialStartupCellKeys = startupCellKeys;
		const spawn = selection.previewSpawn;
		this.manifest = {
			protocol: 'elsemesh.world/3', worldId: this.worldId, title: descriptor.title ? `${descriptor.title} · ${region.label}` : region.label,
			experience, ownerPeerId: '', authorityEpoch: 1, assets: [], objects: [], components: [], portals: [],
			// Shared ElseMesh movement defaults are provisional and are not game-derived or parity evidence.
			rules: { gravity: 1, avatarComplexity: 20000, physicsProfile: 'default', maxVisitors: 128, spawnRadius: 0, playerCapsule },
			spawn,
			entryPointActionLabel: selection.entryPointActionLabel,
			entryPoints: selection.choices.map( choice => ( { id: choice.id, label: choice.label, ...( choice.uniform ? { uniform: choice.uniform } : {} ) } ) ),
			entryPointPrompt: selection.entryPointPrompt, sourceRevision: this.sourceRevision,
		};
		this.baseURL = base;
		this.previewRegion = previewRegion;
		this.playerCapsule = playerCapsule;
		this.sourceRegions = regions;
		this.queriedCellsByRegion = new Map( regions.map( item => [ item.id, new Set() ] ) );
		this.collisionSourceInventories = new Map();
		this.knownCells = new Set();
		this.cellQueryQueue = Promise.resolve();
		await this.ensureCells( startupCells, { signal } );
		if ( ! this.allCollisionSourcesIndexed ) this.unknownSourcesCompleteByCell.clear();
		const support = selection.previewSupport;
		if ( support ) {
			this.manifest.objects.push( {
				id: 'elsemesh-object:region-preview-floor-support', label: 'Provisional preview floor support', kind: 'asset-instance', assetId: null,
				transform: { position: support.position, yaw: support.yaw || 0 }, scale: [ 1, 1, 1 ], priority: 'visible',
				collision: { enabled: true, shape: 'box', center: [ 0, 0, 0 ], halfExtents: support.halfExtents, walkable: true, solid: true },
			} );
		}
		await this.ensureCellsForView( spawn.position, spawn.position );
		return this.manifest;
	}

	async ensureCells( coordinates, { signal } = {} ) {
		const previousQuery = this.cellQueryQueue;
		const query = previousQuery.then( () => this.#ensureCells( coordinates, { signal } ) );
		this.cellQueryQueue = query.catch( () => {} );
		return query;
	}

	async #ensureCells( coordinates, { signal } = {} ) {
		abortIfNeeded( signal );
		requireValue( this.manifest && Array.isArray( coordinates ) && coordinates.length > 0, 'Local provider cell request is empty or the manifest is unavailable' );
		const requested = [ ...new Set( coordinates.map( coordinate => {
			const values = Array.isArray( coordinate ) ? coordinate : String( coordinate ).split( ',' ).map( Number );
			requireValue( values.length === 3 && values.every( Number.isSafeInteger ), 'Local provider cell coordinate is invalid' );
			return values.join( ',' );
		} ) ) ];
		requireValue( requested.length > 0, 'Local provider cell request is empty' );
		const cellSize = this.previewRegion.cellSizeMeters;
		for ( const sourceRegion of this.sourceRegions ) {
			const queried = this.queriedCellsByRegion.get( sourceRegion.id );
			const pending = requested.filter( key => ! queried.has( key ) );
			if ( pending.length === 0 ) continue;
			const sourceURL = new URL( sourceRegion.asset, `${this.baseURL}/` );
			requireValue( sourceURL.origin === this.localProvider && sourceURL.pathname.startsWith( '/v1/regions/' ), 'Local provider returned an unsafe region URL' );
			for ( let offset = 0; offset < pending.length; ) {
				const params = new URLSearchParams();
				params.set( 'size', String( cellSize ) );
				params.set( 'sourceInventory', this.collisionSourceInventories.has( sourceRegion.id ) ? '0' : '1' );
				const batch = [];
				let queryLength = params.toString().length;
				while ( offset + batch.length < pending.length && batch.length < LOCAL_REGION_CELL_BATCH_LIMIT ) {
					const cell = pending[ offset + batch.length ];
					const cellParameterLength = new URLSearchParams( [ [ 'cell', cell ] ] ).toString().length;
					const nextQueryLength = queryLength + ( batch.length ? 1 : 0 ) + cellParameterLength;
					if ( nextQueryLength > LOCAL_REGION_CELL_QUERY_LIMIT ) break;
					params.append( 'cell', cell );
					batch.push( cell );
					queryLength = nextQueryLength;
				}
				requireValue( batch.length > 0, 'Local provider cell coordinate exceeds the request URL limit' );
				const cellIndexURL = new URL( `${sourceURL.pathname}/cells`, this.localProvider );
				cellIndexURL.search = params.toString();
				const includesSourceInventory = ! this.collisionSourceInventories.has( sourceRegion.id );
				const cacheKey = `cell-index\0${sourceRegion.id}\0${cellSize}\0${JSON.stringify( this.previewRegion )}\0${includesSourceInventory ? 1 : 0}\0${batch.join( ';' )}`;
				let cellIndex = null;
				let responseBytes = null;
				try {
					responseBytes = await this.diskCache?.get( cacheKey ) || null;
					if ( responseBytes ) cellIndex = JSON.parse( new TextDecoder().decode( responseBytes ) );
				} catch ( error ) {
					if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region cell-index disk cache read failed:', error );
					cellIndex = null;
					responseBytes = null;
				}
				const requestedSet = new Set( batch );
				const validateCellIndex = value => {
					requireValue( value?.sourceRevision === this.sourceRevision && value.cellSizeMeters === cellSize && Array.isArray( value.cells ) && value.cells.length <= batch.length && ( includesSourceInventory ? value.collisionSourceInventory && typeof value.collisionSourceInventory === 'object' : value.collisionSourceInventory == null ), 'Local provider returned an invalid cell response' );
					for ( const cell of value.cells ) requireValue( requestedSet.has( `${cell?.x},${cell?.y},${cell?.z}` ), 'Local provider returned an unrequested cell' );
				};
				if ( cellIndex ) {
					try { validateCellIndex( cellIndex ); } catch ( error ) {
						if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region cached cell index is stale:', error );
						cellIndex = null;
						responseBytes = null;
					}
				}
				if ( ! cellIndex ) {
					const fetched = await fetchJSONBytes( cellIndexURL, signal );
					cellIndex = fetched.value;
					responseBytes = fetched.bytes;
					validateCellIndex( cellIndex );
					// Cell-index responses are immutable for the provider cache revision. Skip
					// hashing these potentially large JSON bodies; scope and key identify them.
					this.#persistDiskEntries( [ { assetId: cacheKey, bytes: responseBytes, digest: null } ], 'cell index' );
				}
				this.#installCellIndex( sourceRegion, cellIndex );
				for ( const cell of batch ) queried.add( cell );
				offset += batch.length;
			}
		}
		for ( const key of requested ) this.knownCells.add( key );
		if ( ! this.allCollisionSourcesIndexed ) this.unknownSourcesCompleteByCell.clear();
		return this.manifest;
	}

	ensureCellsForView( from, to ) {
		const cellSize = this.cellSizeMeters;
		if ( ! cellSize || ! this.manifest ) return Promise.resolve( this.manifest );
		const center = Array.isArray( from ) ? from : [ from.x, from.y, from.z ];
		const centerCell = center.map( value => cellCoordinate( value, cellSize ) );
		const frontier = sweptCollisionCellKeys( from, to, {
			cellSizeMeters: cellSize, radius: this.playerCapsule.radiusMeters, height: this.playerCapsule.heightMeters,
		} );
		const candidates = [];
		for ( let x = - LOCAL_REGION_PREFETCH_RADIUS_CELLS; x <= LOCAL_REGION_PREFETCH_RADIUS_CELLS; x ++ ) for ( let y = - LOCAL_REGION_PREFETCH_RADIUS_CELLS; y <= LOCAL_REGION_PREFETCH_RADIUS_CELLS; y ++ ) for ( let z = - LOCAL_REGION_PREFETCH_RADIUS_CELLS; z <= LOCAL_REGION_PREFETCH_RADIUS_CELLS; z ++ ) {
			if ( x * x + y * y + z * z > LOCAL_REGION_PREFETCH_RADIUS_CELLS ** 2 ) continue;
			candidates.push( [ centerCell[ 0 ] + x, centerCell[ 1 ] + y, centerCell[ 2 ] + z ] );
		}
		const distanceSquared = cell => ( cell[ 0 ] - centerCell[ 0 ] ) ** 2 + ( cell[ 1 ] - centerCell[ 1 ] ) ** 2 + ( cell[ 2 ] - centerCell[ 2 ] ) ** 2;
		candidates.sort( ( a, b ) => distanceSquared( a ) - distanceSquared( b ) );
		const requested = new Set( [ ...frontier, ...candidates.map( cell => cell.join( ',' ) ) ] );
		return this.ensureCells( [ ...requested ].map( cell => cell.split( ',' ).map( Number ) ) );
	}

	ensureCellsForCamera( camera, { signal } = {} ) {
		if ( ! this.cellSizeMeters || ! this.manifest ) return Promise.resolve( this.manifest );
		const cells = worldViewCellCoordinates( camera, this.cellSizeMeters, this.maxViewDistanceMeters );
		if ( cells.length === 0 ) return Promise.resolve( this.manifest );
		const previousKnownCells = this.knownCells.size;
		return this.ensureCells( cells, { signal } ).then( manifest => {
			const indexedCells = this.knownCells.size - previousKnownCells;
			if ( indexedCells > 0 && this.regionDiagnostics ) console.info( 'ElseMesh local-region camera cells indexed:', JSON.stringify( {
				frustumCells: cells.length, newlyIndexedCells: indexedCells,
				cellSizeMeters: this.cellSizeMeters, maxViewDistanceMeters: this.maxViewDistanceMeters,
			} ) );
			return manifest;
		} );
	}

	#installCellIndex( sourceRegion, cellIndex ) {
		const { baseURL: base, previewRegion } = this;
		const sourceURL = new URL( sourceRegion.asset, `${base}/` );
		const startupCellKeys = new Set( this.initialStartupCellKeys );
		let sourceInventory = cellIndex.collisionSourceInventory;
		if ( sourceInventory ) this.collisionSourceInventories.set( sourceRegion.id, sourceInventory );
		else sourceInventory = this.collisionSourceInventories.get( sourceRegion.id );
		requireValue( sourceInventory, 'Local provider omitted its initial collision source inventory' );
		requireValue( Number.isSafeInteger( sourceInventory?.staticMeshComponents ) && sourceInventory.staticMeshComponents >= 0 && Number.isSafeInteger( sourceInventory.otherPrimitiveComponents ) && sourceInventory.otherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.unclassifiedOtherPrimitiveComponents ) && sourceInventory.unclassifiedOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.explicitlyNonQueryOtherPrimitiveComponents ) && sourceInventory.explicitlyNonQueryOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.explicitlyNonBlockingForPawnOtherPrimitiveComponents ) && sourceInventory.explicitlyNonBlockingForPawnOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.userVerifiedNonBlockingForPawnOtherPrimitiveComponents ) && sourceInventory.userVerifiedNonBlockingForPawnOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.audioOnlyPolicyExcludedOtherPrimitiveComponents ) && sourceInventory.audioOnlyPolicyExcludedOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.noSkeletalCollisionGeometryComponents ) && sourceInventory.noSkeletalCollisionGeometryComponents >= 0 && sourceInventory.unclassifiedOtherPrimitiveComponents + sourceInventory.explicitlyNonQueryOtherPrimitiveComponents + sourceInventory.explicitlyNonBlockingForPawnOtherPrimitiveComponents + sourceInventory.userVerifiedNonBlockingForPawnOtherPrimitiveComponents + sourceInventory.audioOnlyPolicyExcludedOtherPrimitiveComponents + sourceInventory.noSkeletalCollisionGeometryComponents === sourceInventory.otherPrimitiveComponents && Number.isSafeInteger( sourceInventory.landscapeHeightfieldCollisionComponents ) && sourceInventory.landscapeHeightfieldCollisionComponents >= 0 && Number.isSafeInteger( sourceInventory.unresolvedInstancedMeshComponents ) && sourceInventory.unresolvedInstancedMeshComponents >= 0 && sourceInventory.otherPrimitiveStatuses && typeof sourceInventory.otherPrimitiveStatuses === 'object' && Object.values( sourceInventory.otherPrimitiveStatuses ).every( count => Number.isSafeInteger( count ) && count >= 0 ) && Object.values( sourceInventory.otherPrimitiveStatuses ).reduce( ( total, count ) => total + count, 0 ) === sourceInventory.otherPrimitiveComponents, 'Local provider returned invalid collision source inventory' );
		requireValue( Number.isSafeInteger( sourceInventory.unindexedOtherPrimitiveComponents ) && sourceInventory.unindexedOtherPrimitiveComponents >= 0 && sourceInventory.unindexedOtherPrimitiveComponents <= sourceInventory.unclassifiedOtherPrimitiveComponents, 'Local provider returned invalid unindexed collision source count' );
		requireValue( Number.isSafeInteger( sourceInventory.unindexedSpatialBoundsComponents ) && sourceInventory.unindexedSpatialBoundsComponents >= 0 && Array.isArray( sourceInventory.unindexedSpatialBoundsFailures ) && sourceInventory.unindexedSpatialBoundsFailures.length <= sourceInventory.unindexedSpatialBoundsComponents && sourceInventory.unindexedSpatialBoundsFailures.every( failure => typeof failure?.objectPath === 'string' && failure.objectPath.length > 0 && typeof failure.reason === 'string' && failure.reason.length > 0 ) && typeof sourceInventory.unindexedSpatialBoundsFailuresTruncated === 'boolean', 'Local provider returned invalid spatial-bounds indexing failures' );
		const allCollisionSourcesIndexed = sourceInventory.unindexedOtherPrimitiveComponents === 0 && sourceInventory.unindexedSpatialBoundsComponents === 0 && sourceInventory.landscapeHeightfieldCollisionComponents === 0 && sourceInventory.unresolvedInstancedMeshComponents === 0;
		this.allCollisionSourcesIndexed = this.allCollisionSourcesIndexed && allCollisionSourcesIndexed;
		this.emptyCollisionCellsAreVerified = this.emptyCollisionCellsAreVerified && allCollisionSourcesIndexed;
		const cells = new Map();
		for ( const cell of cellIndex.cells ) {
			requireValue( Number.isSafeInteger( cell?.x ) && Number.isSafeInteger( cell?.y ) && Number.isSafeInteger( cell?.z ), 'Local provider returned invalid cell coordinates' );
			const evidence = cell.collisionEvidence;
			requireValue( [ 'all-collision-sources', 'incomplete-collision-source-index' ].includes( evidence?.scope ) && Number.isSafeInteger( evidence.staticMeshComponentCount ) && evidence.staticMeshComponentCount >= 0 && Number.isSafeInteger( evidence.unknownComponents ) && evidence.unknownComponents >= 0 && Number.isSafeInteger( evidence.supportedSimpleShapeComponents ) && evidence.supportedSimpleShapeComponents >= 0 && Number.isSafeInteger( evidence.explicitlyNonQueryCollidableComponents ) && evidence.explicitlyNonQueryCollidableComponents >= 0 && Number.isSafeInteger( evidence.explicitlyNonBlockingForPawnComponents ) && evidence.explicitlyNonBlockingForPawnComponents >= 0 && evidence.supportedSimpleShapeComponents + evidence.explicitlyNonQueryCollidableComponents + evidence.explicitlyNonBlockingForPawnComponents + evidence.unknownComponents === evidence.staticMeshComponentCount && evidence.staticMeshComponentsClassified === ( evidence.unknownComponents === 0 ), 'Local provider returned invalid collision coverage evidence' );
			requireValue( Number.isSafeInteger( evidence.otherPrimitiveComponentCount ) && evidence.otherPrimitiveComponentCount >= 0 && Number.isSafeInteger( evidence.supportedOtherPrimitiveComponents ) && evidence.supportedOtherPrimitiveComponents >= 0 && Number.isSafeInteger( evidence.unknownOtherPrimitiveComponents ) && evidence.unknownOtherPrimitiveComponents >= 0 && evidence.supportedOtherPrimitiveComponents + evidence.unknownOtherPrimitiveComponents === evidence.otherPrimitiveComponentCount, 'Local provider returned invalid per-cell primitive collision evidence' );
			requireValue( Array.isArray( cell.unknownCollisionSources ) && cell.unknownCollisionSources.every( source => typeof source?.objectPath === 'string' && source.objectPath.length > 0 && typeof source.status === 'string' && ( source.instanceIndex === null || Number.isSafeInteger( source.instanceIndex ) && source.instanceIndex >= 0 ) && Array.isArray( source.bounds ) && source.bounds.length === 6 && source.bounds.every( Number.isFinite ) && source.bounds[ 0 ] <= source.bounds[ 3 ] && source.bounds[ 1 ] <= source.bounds[ 4 ] && source.bounds[ 2 ] <= source.bounds[ 5 ] ), 'Local provider returned invalid collision source bounds' );
			const expectedUnknownSources = evidence.unknownComponents + evidence.unknownOtherPrimitiveComponents;
			const cellKey = `${cell.x},${cell.y},${cell.z}`;
			const previousUnknownSources = this.unknownSourcesByCell.get( cellKey ) || [];
			this.unknownSourcesByCell.set( cellKey, [ ...previousUnknownSources, ...cell.unknownCollisionSources ] );
			const completeForLayer = allCollisionSourcesIndexed && evidence.scope === 'all-collision-sources' && cell.unknownCollisionSources.length === expectedUnknownSources;
			this.unknownSourcesCompleteByCell.set( cellKey, ( this.unknownSourcesCompleteByCell.get( cellKey ) ?? true ) && completeForLayer );
			cells.set( cellKey, { x: cell.x, y: cell.y, z: cell.z, evidence, source: cell } );
		}
		for ( const cell of cells.values() ) {
			const cellKey = `${cell.x},${cell.y},${cell.z}`;
			const assetId = `local-region:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}`;
			const center = [
				( cell.x + 0.5 ) * previewRegion.cellSizeMeters,
				( cell.y + 0.5 ) * previewRegion.cellSizeMeters,
				( cell.z + 0.5 ) * previewRegion.cellSizeMeters,
			];
			const cellObjectIDs = this.collisionObjectIDsByCell.get( cellKey ) || new Set();
			const collisionAssetId = `${assetId}:collision`;
			const collisionObjectId = `elsemesh-object:region-cell:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}:collision`;
			const visualAssetId = `${assetId}:visual`;
			const visualObjectId = `elsemesh-object:region-cell:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}:visual`;
			const cellCoordinates = [ cell.x, cell.y, cell.z ];
			const isStartupCell = startupCellKeys.has( cellKey );
			const priority = isStartupCell ? 'visible' : 'background';
			const staticModelSets = localRegionStaticModelSets( cell.source, {
				regionID: sourceRegion.id,
				cellSizeMeters: previewRegion.cellSizeMeters,
				coordinates: cellCoordinates,
				priority,
				maxDistanceMeters: previewRegion.maxViewDistanceMeters,
			} );
			const collisionURL = new URL( sourceRegion.asset, `${base}/` );
			collisionURL.searchParams.set( 'cell', `${cellKey},${previewRegion.cellSizeMeters}` );
			collisionURL.searchParams.set( 'payload', 'collision' );
			const visualURL = new URL( collisionURL );
			visualURL.searchParams.set( 'payload', 'visual' );
			this.regionAssets.set( collisionAssetId, collisionURL.href );
			if ( ! staticModelSets ) this.regionAssets.set( visualAssetId, visualURL.href );
			this.collisionAssetIDs.add( collisionAssetId );
			this.collisionObjectIDByAsset.set( collisionAssetId, collisionObjectId );
			if ( cell.evidence.supportedSimpleShapeComponents > 0 || cell.evidence.supportedOtherPrimitiveComponents > 0 ) this.collisionObjectIDsExpectShape.add( collisionObjectId );
			const collisionCoverageVerified = allCollisionSourcesIndexed && cell.evidence?.scope === 'all-collision-sources' && cell.evidence.staticMeshComponentsClassified && cell.evidence.unknownOtherPrimitiveComponents === 0;
			if ( ! collisionCoverageVerified ) this.unverifiedCollisionSourceObjectIDs.add( collisionObjectId );
			else if ( cell.evidence.supportedSimpleShapeComponents === 0 && cell.evidence.unknownComponents === 0 && cell.evidence.supportedOtherPrimitiveComponents === 0 ) this.verifiedEmptyCollisionObjectIDs.add( collisionObjectId );
			cellObjectIDs.add( collisionObjectId );
			this.collisionObjectIDsByCell.set( cellKey, cellObjectIDs );
			if ( isStartupCell ) this.initialRegionCellObjectIDs.add( collisionObjectId );
			this.manifest.assets.push(
				{ id: collisionAssetId, bytes: 0, kind: 'model/gltf-binary', priority },
			);
			this.manifest.objects.push( {
				id: collisionObjectId, label: `${sourceRegion.label} collision cell ${cellKey}`, kind: 'asset-instance', assetId: collisionAssetId,
				transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority,
				streamingBounds: { center, radius: previewRegion.cellSizeMeters * Math.sqrt( 3 ) / 2, maxDistanceMeters: previewRegion.maxViewDistanceMeters }, regionCell: true, collisionPayload: true,
			} );
			if ( staticModelSets ) {
				this.manifest.rules.requiredFeatures ||= [];
				if ( ! this.manifest.rules.requiredFeatures.includes( 'elsemesh.static-model-instance-set/1' ) ) this.manifest.rules.requiredFeatures.push( 'elsemesh.static-model-instance-set/1' );
				for ( const set of staticModelSets ) {
					const component = set.component;
					this.manifest.components.push( component );
					this.manifest.assets.push( { id: set.descriptorAssetID, bytes: 0, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND, priority } );
					this.syntheticAssetLoaders.set( set.descriptorAssetID, async signal => {
						const descriptorURL = new URL( `${sourceURL.pathname}/cells`, this.localProvider );
						descriptorURL.searchParams.set( 'size', String( previewRegion.cellSizeMeters ) );
						descriptorURL.searchParams.set( 'cell', cellKey );
						const latest = await fetchJSON( descriptorURL, signal );
						requireValue( latest.sourceRevision === this.sourceRevision && latest.cellSizeMeters === previewRegion.cellSizeMeters && Array.isArray( latest.cells ), 'Local provider returned stale static-mesh instance metadata' );
						const sourceCell = latest.cells.find( item => item.x === cell.x && item.y === cell.y && item.z === cell.z );
						const refreshedSets = localRegionStaticModelSets( sourceCell, {
							regionID: sourceRegion.id,
							cellSizeMeters: previewRegion.cellSizeMeters,
							coordinates: cellCoordinates,
							priority,
							maxDistanceMeters: previewRegion.maxViewDistanceMeters,
						} );
						const refreshed = refreshedSets?.find( item => item.descriptorAssetID === set.descriptorAssetID );
						requireValue( refreshed, 'Local provider no longer exposes the declared static-mesh instance set' );
						return new TextEncoder().encode( JSON.stringify( refreshed.document ) );
					} );
					for ( const modelAsset of set.modelAssets ) {
						if ( ! this.regionAssets.has( modelAsset.assetId ) ) {
							const modelURL = new URL( sourceRegion.asset, `${base}/` );
							modelURL.searchParams.set( 'cell', `${cellKey},${previewRegion.cellSizeMeters}` );
							modelURL.searchParams.set( 'payload', 'visual' );
							modelURL.searchParams.set( 'mesh', modelAsset.componentPath );
							modelURL.searchParams.set( 'lod', String( modelAsset.lodIndex ) );
							this.regionAssets.set( modelAsset.assetId, modelURL.href );
						}
						if ( ! this.manifest.assets.some( asset => asset.id === modelAsset.assetId ) ) this.manifest.assets.push( { id: modelAsset.assetId, bytes: 0, kind: 'glb', priority } );
					}
				}
			} else {
				this.regionAssets.set( visualAssetId, visualURL.href );
				this.manifest.assets.push( { id: visualAssetId, bytes: 0, kind: 'model/gltf-binary', priority } );
				this.manifest.objects.push( {
					id: visualObjectId, label: `${sourceRegion.label} visual cell ${cellKey}`, kind: 'asset-instance', assetId: visualAssetId,
					transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority,
					streamingBounds: localRegionVisualStreamingBounds( cell.source.visualInstances, { center, radius: previewRegion.cellSizeMeters * Math.sqrt( 3 ) / 2, maxDistanceMeters: previewRegion.maxViewDistanceMeters } ), regionCell: true,
				} );
			}
		}
	}

	isCollisionPathReady( from, to, { loadedObjects } = {} ) {
		this.lastCollisionPathStatus = collisionPathStatus( {
			from, to, cellSizeMeters: this.cellSizeMeters,
			radius: this.playerCapsule.radiusMeters, height: this.playerCapsule.heightMeters,
			objectIDsByCell: this.collisionObjectIDsByCell, loadedObjectIDs: loadedObjects,
			unknownObjectIDs: this.unknownCollisionObjectIDs, unknownSourcesByCell: this.unknownSourcesByCell,
			unknownSourcesCompleteByCell: this.unknownSourcesCompleteByCell, knownCells: this.knownCells, emptyCellsAreVerified: this.emptyCollisionCellsAreVerified,
			missingCollisionPayloadObjectIDs: this.missingCollisionPayloadObjectIDs,
			missingKnownShapeObjectIDs: this.collisionObjectIDsMissingKnownShape,
		} );
		if ( this.regionDiagnostics ) {
			const signature = this.lastCollisionPathStatus.ready ? 'ready' : JSON.stringify( this.lastCollisionPathStatus );
			if ( signature !== this.lastCollisionPathDiagnostic ) {
				console.info( 'ElseMesh local-region movement gate:', JSON.stringify( {
					from: from?.toArray?.() || from, to: to?.toArray?.() || to, ...this.lastCollisionPathStatus,
				} ) );
				this.lastCollisionPathDiagnostic = signature;
			}
		}
		return this.lastCollisionPathStatus.ready;
	}

	collisionObjectIDsAlongPath( from, to ) {
		const objectIDs = new Set();
		for ( const cellKey of sweptCollisionCellKeys( from, to, { cellSizeMeters: this.cellSizeMeters, radius: this.playerCapsule.radiusMeters, height: this.playerCapsule.heightMeters } ) ) {
			for ( const objectID of this.collisionObjectIDsByCell.get( cellKey ) || [] ) objectIDs.add( objectID );
		}
		return objectIDs;
	}

	#persistDiskEntries( entries, label ) {
		if ( ! this.diskCache || entries.length === 0 ) return;
		const queuedBytes = entries.reduce( ( total, entry ) => total + entry.bytes.byteLength, 0 );
		if ( ! Number.isSafeInteger( queuedBytes ) || queuedBytes > MAX_LOCAL_REGION_DISK_WRITE_QUEUE_BYTES || this.pendingDiskWriteBytes + queuedBytes > MAX_LOCAL_REGION_DISK_WRITE_QUEUE_BYTES ) {
			if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region disk cache batch skipped:', JSON.stringify( { label, queuedBytes, pendingBytes: this.pendingDiskWriteBytes, limitBytes: MAX_LOCAL_REGION_DISK_WRITE_QUEUE_BYTES } ) );
			return;
		}
		this.pendingDiskWriteBytes += queuedBytes;
		const queuedAt = performance.now();
		for ( const entry of entries ) this.pendingDiskWriteEntries.push( { ...entry, label, queuedAt } );
		if ( this.diskWriteFlushTimer === null ) {
			// A short provisional batching window collects sibling range writes without delaying delivery to the renderer.
			this.diskWriteFlushTimer = setTimeout( () => {
				this.diskWriteFlushTimer = null;
				void this.#flushDiskEntries();
			}, 16 );
		}
	}

	async #flushDiskEntries() {
		while ( this.pendingDiskWriteEntries.length ) {
			const entries = this.pendingDiskWriteEntries.splice( 0, MAX_LOCAL_REGION_DISK_WRITE_BATCH_ENTRIES );
			const batchBytes = entries.reduce( ( total, entry ) => total + entry.bytes.byteLength, 0 );
			try {
				const prepared = await Promise.all( entries.map( async entry => ( {
					assetId: entry.assetId,
					bytes: entry.bytes,
					digest: typeof entry.digest === 'function' ? await entry.digest() : await entry.digest,
				} ) ) );
				const stored = await this.diskCache.putMany( prepared );
				if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region disk cache batch:', JSON.stringify( {
					labels: [ ...new Set( entries.map( entry => entry.label ) ) ], entries: prepared.length, bytes: batchBytes, stored,
					elapsedMs: performance.now() - Math.min( ...entries.map( entry => entry.queuedAt ) ),
				} ) );
			} catch ( error ) {
				if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region disk-cache batch write failed:', error );
			} finally {
				this.pendingDiskWriteBytes = Math.max( 0, this.pendingDiskWriteBytes - batchBytes );
			}
		}
	}

	async getAsset( assetId, { signal } = {} ) {
		abortIfNeeded( signal );
		if ( this.assets.has( assetId ) ) {
			const bytes = this.assets.get( assetId );
			this.assets.delete( assetId );
			this.assets.set( assetId, bytes );
			void this.diskCache?.touch( assetId );
			return bytes;
		}
		const assetURL = this.regionAssets.get( assetId );
		const syntheticAssetLoader = this.syntheticAssetLoaders.get( assetId );
		requireValue( this.manifest && ( assetURL || syntheticAssetLoader ), 'Local region asset was not declared by the provider' );
		const startedAt = performance.now();
		const phaseMs = {};
		let phaseStartedAt = performance.now();
		let diskBytes = null;
		try { diskBytes = await this.diskCache?.get( assetId ) || null; } catch ( error ) {
			if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region disk cache read failed:', error );
		}
		phaseMs.browserDiskCacheRead = performance.now() - phaseStartedAt;
		if ( diskBytes && syntheticAssetLoader ) {
			try {
				const cached = JSON.parse( new TextDecoder().decode( diskBytes ) );
				const declared = new Set( ( cached.models || [] ).flatMap( model => ( model.lods || [] ).map( lod => lod.assetId ) ).filter( id => this.regionAssets.has( id ) ) );
				const document = decodeStaticModelInstanceSet( diskBytes, { availableAssetIDs: declared } );
				if ( document.instances.some( instance => ! instance.placementId ) ) diskBytes = null;
			} catch {
				diskBytes = null;
			}
		}
		if ( diskBytes ) {
			phaseStartedAt = performance.now();
			this.#registerExternalTextureAssets( assetId, diskBytes );
			this.#updateCollisionCoverage( assetId, diskBytes );
			phaseMs.collisionCoverage = performance.now() - phaseStartedAt;
			if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region disk cache hit:', JSON.stringify( { assetId, bytes: diskBytes.byteLength, elapsedMs: performance.now() - startedAt, phaseMs } ) );
			return this.#cacheAsset( assetId, diskBytes );
		}
		if ( syntheticAssetLoader ) {
			const bytes = await syntheticAssetLoader( signal );
			requireValue( bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= MAX_STATIC_MODEL_INSTANCE_SET_BYTES, 'Generated local static-model descriptor exceeds its size limit' );
			this.#persistDiskEntries( [ { assetId, bytes, digest: null } ], 'local static-model descriptor' );
			if ( this.regionDiagnostics ) console.info( 'ElseMesh local static-model descriptor generated:', JSON.stringify( { assetId, bytes: bytes.byteLength, elapsedMs: performance.now() - startedAt } ) );
			return this.#cacheAsset( assetId, bytes );
		}
		const bytes = await this.#withRegionLease( assetURL, signal, async ( response, leaseSignal ) => {
			if ( response.status === 404 ) {
				const collisionObjectID = this.collisionObjectIDByAsset.get( assetId );
				if ( collisionObjectID ) {
					this.unknownCollisionObjectIDs.add( collisionObjectID );
					this.missingCollisionPayloadObjectIDs.add( collisionObjectID );
					if ( this.collisionObjectIDsExpectShape.has( collisionObjectID ) ) this.collisionObjectIDsMissingKnownShape.add( collisionObjectID );
					return EMPTY_GLB;
				}
				return this.#cacheAsset( assetId, EMPTY_GLB );
			}
			if ( ! response.ok ) throw new Error( `Local region request failed (${response.status})` );
			const declaredLength = Number( response.headers.get( 'Content-Length' ) );
			requireValue( Number.isSafeInteger( declaredLength ) && declaredLength > 0 && declaredLength <= MAX_LOCAL_REGION_BYTES, 'Local region exceeds the browser memory limit' );
			const bodyStartedAt = performance.now();
			const bytes = new Uint8Array( await response.arrayBuffer() );
			phaseMs.responseBodyRead = performance.now() - bodyStartedAt;
			abortIfNeeded( leaseSignal );
			requireValue( bytes.byteLength === declaredLength && bytes.byteLength <= MAX_LOCAL_REGION_BYTES, 'Local region length is invalid' );
			let digestHex = null;
			const sourceETag = textureAssetETag( assetId );
			if ( sourceETag ) {
				requireValue( response.headers.get( 'ETag' ) === sourceETag, 'Local texture ETag does not match its source-derived asset id' );
			} else {
				const digestStartedAt = performance.now();
				const digest = await crypto.subtle.digest( 'SHA-256', bytes );
				phaseMs.responseDigest = performance.now() - digestStartedAt;
				digestHex = [ ...new Uint8Array( digest ) ].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
				requireValue( response.headers.get( 'ETag' ) === `"sha256-${digestHex}"`, 'Local region ETag does not match its content digest' );
			}
			this.#registerExternalTextureAssets( assetId, bytes );
			phaseStartedAt = performance.now();
			this.#updateCollisionCoverage( assetId, bytes );
			phaseMs.collisionCoverage = performance.now() - phaseStartedAt;
			this.#persistDiskEntries( [ { assetId, bytes, digest: digestHex } ], 'local-region asset' );
			return this.#cacheAsset( assetId, bytes );
		}, phaseMs ).catch( error => {
			if ( this.regionDiagnostics ) {
				const log = error?.name === 'AbortError' ? console.debug : console.error;
				log( error?.name === 'AbortError' ? 'ElseMesh local-region fetch cancelled:' : 'ElseMesh local-region fetch failed:', JSON.stringify( { assetId, elapsedMs: Math.round( performance.now() - startedAt ), error: error?.stack || String( error ) } ) );
			}
			throw error;
		} );
		if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region fetched:', JSON.stringify( { assetId, bytes: bytes.byteLength, elapsedMs: performance.now() - startedAt, phaseMs } ) );
		if ( this.collisionAssetIDs.has( assetId ) ) {
			const elapsedMs = Math.min( 30000, Math.max( 100, performance.now() - startedAt ) );
			this.collisionLoadLatencyMs = Math.round( this.collisionLoadLatencyMs * 0.75 + elapsedMs * 0.25 );
		}
		return bytes;
	}

	registerExternalTextureAsset( parentAssetId, textureAssetId ) {
		requireValue( EXTERNAL_TEXTURE_ID.test( textureAssetId || '' ), 'External texture asset id is invalid' );
		const parentAssetURL = this.regionAssets.get( parentAssetId );
		requireValue( parentAssetURL, 'External texture source asset was not declared by the provider' );
		const textureURL = new URL( parentAssetURL, this.localProvider );
		textureURL.searchParams.set( 'texture', textureAssetId );
		this.regionAssets.set( textureAssetId, textureURL.href );
	}

	#registerExternalTextureAssets( parentAssetId, bytes ) {
		if ( ! this.regionAssets.has( parentAssetId ) ) return;
		for ( const textureAssetId of externalTextureAssetIDs( bytes ) ) this.registerExternalTextureAsset( parentAssetId, textureAssetId );
	}

	async getAssetRange( assetId, { start, end, etag, sha256, totalLength, signal } = {} ) {
		abortIfNeeded( signal );
		requireValue( this.manifest && this.regionAssets.has( assetId ), 'Local region asset was not declared by the provider' );
		requireValue( Number.isSafeInteger( start ) && start >= 0 && Number.isSafeInteger( end ) && end >= start && end - start + 1 <= MAX_LOCAL_REGION_BYTES, 'Local region byte range is invalid' );
		if ( etag !== undefined ) requireValue( LOCAL_REGION_ETAG.test( etag ), 'Local region range ETag is invalid' );
		if ( sha256 !== undefined ) requireValue( /^[0-9a-f]{64}$/.test( sha256 ), 'Local region range digest is invalid' );
		if ( totalLength !== undefined ) requireValue( Number.isSafeInteger( totalLength ) && totalLength > end, 'Local region range total length is invalid' );
		const rangeKey = `${assetId}\n${etag || ''}\n${start}-${end}`;
		const cached = this.assetRanges.get( rangeKey );
		if ( cached ) {
			this.assetRanges.delete( rangeKey );
			this.assetRanges.set( rangeKey, cached );
			if ( etag && totalLength !== undefined ) void this.diskCache?.touch( `${assetId}\0range\0${etag}\0${start}-${end}` );
			if ( sha256 ) requireValue( await this.#matchesSHA256( cached.bytes, sha256 ), 'Cached local region range does not match its digest' );
			return cached;
		}
		const diskKey = etag ? `${assetId}\0range\0${etag}\0${start}-${end}` : null;
		if ( diskKey && totalLength !== undefined && this.diskCache ) {
			try {
				const bytes = await this.diskCache.get( diskKey );
				if ( bytes && bytes.byteLength === end - start + 1 && ( ! sha256 || await this.#matchesSHA256( bytes, sha256 ) ) ) {
					const result = { bytes, etag, start, end, totalLength };
					this.#cacheAssetRange( rangeKey, result, assetId );
					if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region range disk cache hit:', JSON.stringify( { assetId, start, end, bytes: bytes.byteLength } ) );
					return result;
				}
			} catch ( error ) {
				if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region range disk cache read failed:', error );
			}
		}
		const fullAsset = this.assets.get( assetId );
		if ( fullAsset ) {
			this.assets.delete( assetId );
			this.assets.set( assetId, fullAsset );
			void this.diskCache?.touch( assetId );
			let fullETag = textureAssetETag( assetId );
			if ( ! fullETag ) {
				const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', fullAsset ) );
				fullETag = `"sha256-${[ ...digest ].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' )}"`;
			}
			requireValue( etag === undefined || etag === fullETag, 'Cached local region asset changed since its range metadata was read' );
			requireValue( start < fullAsset.byteLength, 'Local region byte range starts beyond the cached asset' );
			const rangeEnd = Math.min( end, fullAsset.byteLength - 1 );
			const result = { bytes: fullAsset.slice( start, rangeEnd + 1 ), etag: fullETag, start, end: rangeEnd, totalLength: fullAsset.byteLength };
			if ( sha256 ) requireValue( await this.#matchesSHA256( result.bytes, sha256 ), 'Cached local region range does not match its digest' );
			this.#cacheAssetRange( rangeKey, result, assetId );
			if ( diskKey && totalLength !== undefined && rangeEnd === end ) {
				this.#persistDiskEntries( [ { assetId: diskKey, bytes: result.bytes, digest: () => this.#rangeCacheDigest( assetId, result.bytes ) } ], 'local-region range' );
			}
			return result;
		}
		const assetURL = this.regionAssets.get( assetId );
		return this.#withRegionLease( assetURL, signal, async ( response, leaseSignal ) => {
			if ( response.status !== 206 ) throw new Error( `Local region byte-range request returned HTTP ${response.status}; restart from fresh range metadata` );
			const returnedETag = response.headers.get( 'ETag' );
			requireValue( LOCAL_REGION_ETAG.test( returnedETag || '' ) && ( etag === undefined || returnedETag === etag ), 'Local region byte-range ETag is missing or changed' );
			const contentRange = response.headers.get( 'Content-Range' )?.match( /^bytes (\d+)-(\d+)\/(\d+)$/ );
			requireValue( contentRange, 'Local region byte-range response has no valid Content-Range' );
			const rangeStart = Number( contentRange[ 1 ] ), rangeEnd = Number( contentRange[ 2 ] ), returnedTotalLength = Number( contentRange[ 3 ] );
			requireValue( rangeStart === start && rangeEnd >= start && rangeEnd <= end && Number.isSafeInteger( returnedTotalLength ) && returnedTotalLength > rangeEnd && ( totalLength === undefined || totalLength === returnedTotalLength ), 'Local region byte-range response does not match the request' );
			const declaredLength = Number( response.headers.get( 'Content-Length' ) );
			requireValue( Number.isSafeInteger( declaredLength ) && declaredLength === rangeEnd - rangeStart + 1 && declaredLength <= MAX_LOCAL_REGION_BYTES, 'Local region byte-range length is invalid' );
			const bytes = new Uint8Array( await response.arrayBuffer() );
			abortIfNeeded( leaseSignal );
			requireValue( bytes.byteLength === declaredLength, 'Local region byte-range body length is invalid' );
			if ( sha256 ) requireValue( await this.#matchesSHA256( bytes, sha256 ), 'Local region byte-range digest does not match' );
			const result = { bytes, etag: returnedETag, start: rangeStart, end: rangeEnd, totalLength: returnedTotalLength };
			this.#cacheAssetRange( rangeKey, result, assetId );
			if ( diskKey && rangeStart === start && rangeEnd === end ) {
				this.#persistDiskEntries( [ { assetId: diskKey, bytes, digest: () => this.#rangeCacheDigest( assetId, bytes ) } ], 'local-region range' );
			}
			return result;
		}, {}, { Range: `bytes=${start}-${end}` } );
	}

	async getAssetRanges( assetId, ranges, { etag, totalLength, signal } = {} ) {
		abortIfNeeded( signal );
		requireValue( this.manifest && this.regionAssets.has( assetId ), 'Local region asset was not declared by the provider' );
		requireValue( Array.isArray( ranges ) && ranges.length >= 1 && ranges.length <= 64 && ranges.every( range => Number.isSafeInteger( range?.start ) && range.start >= 0 && Number.isSafeInteger( range?.end ) && range.end >= range.start && range.end - range.start + 1 <= MAX_LOCAL_REGION_BYTES ), 'Local region byte-range set is invalid' );
		if ( etag !== undefined ) requireValue( LOCAL_REGION_ETAG.test( etag ), 'Local region range ETag is invalid' );
		if ( totalLength !== undefined ) requireValue( Number.isSafeInteger( totalLength ) && ranges.every( range => range.end < totalLength ), 'Local region range total length is invalid' );
		const requested = ranges.map( ( range, index ) => ( { ...range, index } ) ).sort( ( a, b ) => a.start - b.start || a.end - b.end );
		for ( let index = 1; index < requested.length; index ++ ) requireValue( requested[ index ].start > requested[ index - 1 ].end, 'Local region byte ranges overlap' );
		const results = new Array( ranges.length );
		const missing = [];
		for ( const range of requested ) {
			const key = `${assetId}\n${etag || ''}\n${range.start}-${range.end}`;
			const cached = this.assetRanges.get( key );
			if ( cached ) {
				this.assetRanges.delete( key );
				this.assetRanges.set( key, cached );
				if ( etag && totalLength !== undefined ) void this.diskCache?.touch( `${assetId}\0range\0${etag}\0${range.start}-${range.end}` );
				results[ range.index ] = cached;
				continue;
			}
			const diskKey = etag && totalLength !== undefined ? `${assetId}\0range\0${etag}\0${range.start}-${range.end}` : null;
			if ( diskKey && this.diskCache ) {
				try {
					const bytes = await this.diskCache.get( diskKey );
					if ( bytes?.byteLength === range.end - range.start + 1 ) {
						const value = { bytes, etag, start: range.start, end: range.end, totalLength };
						this.#cacheAssetRange( key, value, assetId );
						results[ range.index ] = value;
						continue;
					}
				} catch ( error ) {
					if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region range disk cache read failed:', error );
				}
			}
			missing.push( { ...range, key, diskKey } );
		}
		if ( missing.length === 0 ) return results;
		if ( missing.length === 1 ) {
			const range = missing[ 0 ];
			results[ range.index ] = await this.getAssetRange( assetId, { ...range, etag, totalLength, signal } );
			return results;
		}
		const assetURL = this.regionAssets.get( assetId );
		return this.#withRegionLease( assetURL, signal, async response => {
			if ( response.status !== 206 ) throw new Error( `Local region multi-range request returned HTTP ${response.status}; restart from fresh range metadata` );
			const returnedETag = response.headers.get( 'ETag' );
			requireValue( LOCAL_REGION_ETAG.test( returnedETag || '' ) && ( etag === undefined || returnedETag === etag ), 'Local region multi-range ETag is missing or changed' );
			const parts = await parseByteRangeResponse( response );
			for ( const part of parts ) requireValue( Number.isSafeInteger( part.totalLength ) && part.totalLength > part.end && part.bytes.byteLength === part.end - part.start + 1 && ( totalLength === undefined || totalLength === part.totalLength ), 'Local region multi-range part is invalid' );
			const diskEntries = [];
			for ( const range of missing ) {
				const part = parts.find( candidate => candidate.start <= range.start && candidate.end >= range.end );
				requireValue( part, 'Local region multi-range response omitted a requested interval' );
				const bytes = part.bytes.slice( range.start - part.start, range.end - part.start + 1 );
				const value = { bytes, etag: returnedETag, start: range.start, end: range.end, totalLength: part.totalLength };
				this.#cacheAssetRange( range.key, value, assetId );
				results[ range.index ] = value;
				if ( range.diskKey ) {
					diskEntries.push( { assetId: range.diskKey, bytes, digest: () => this.#rangeCacheDigest( assetId, bytes ) } );
				}
			}
			this.#persistDiskEntries( diskEntries, 'local-region range batch' );
			return results;
		}, {}, { Range: `bytes=${missing.map( range => `${range.start}-${range.end}` ).join( ',' )}` } );
	}

	async #matchesSHA256( bytes, expected ) {
		return await this.#digestSHA256( bytes ) === expected;
	}

	async #digestSHA256( bytes ) {
		const digest = new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) );
		return [ ...digest ].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	}

	async #rangeCacheDigest( assetId, bytes ) {
		return isSourceTextureID( assetId ) ? null : this.#digestSHA256( bytes );
	}

	#cacheAssetRange( key, value, assetId ) {
		if ( value.bytes.byteLength > this.assetRangeCacheBudgetBytes ) return;
		const existing = this.assetRanges.get( key );
		if ( existing ) this.assetRangeBytes -= existing.bytes.byteLength;
		this.assetRanges.set( key, { ...value, assetId } );
		this.assetRangeBytes += value.bytes.byteLength;
		while ( this.assetRangeBytes > this.assetRangeCacheBudgetBytes && this.assetRanges.size ) {
			const oldest = this.assetRanges.keys().next().value;
			const evicted = this.assetRanges.get( oldest );
			this.assetRanges.delete( oldest );
			this.assetRangeBytes -= evicted.bytes.byteLength;
		}
	}

	#updateCollisionCoverage( assetId, bytes ) {
		const collisionObjectID = this.collisionObjectIDByAsset.get( assetId );
		if ( ! collisionObjectID ) return;
		// A parsed empty GLB is coverage only when provider evidence proves every source is classified and non-blocking.
		const hasCollisionShape = hasEmbeddedCollisionShape( bytes );
		this.missingCollisionPayloadObjectIDs.delete( collisionObjectID );
		if ( this.collisionObjectIDsExpectShape.has( collisionObjectID ) && ! hasCollisionShape ) this.collisionObjectIDsMissingKnownShape.add( collisionObjectID );
		else this.collisionObjectIDsMissingKnownShape.delete( collisionObjectID );
		const verifiedEmpty = this.verifiedEmptyCollisionObjectIDs.has( collisionObjectID ) && ! hasCollisionShape;
		if ( ( hasCollisionShape || verifiedEmpty ) && ! this.unverifiedCollisionSourceObjectIDs.has( collisionObjectID ) ) this.unknownCollisionObjectIDs.delete( collisionObjectID );
		else this.unknownCollisionObjectIDs.add( collisionObjectID );
	}

	async #withRegionLease( assetURL, signal, consumeResponse, phaseMs = {}, requestHeaders = {} ) {
		const url = new URL( assetURL, this.localProvider );
		const priority = url.searchParams.get( 'payload' ) === 'collision' ? 0 : url.searchParams.has( 'texture' ) ? 2 : 1;
		return this.regionRequestQueue.run( signal, priority, () => this.#fetchWithRegionLease( assetURL, signal, consumeResponse, phaseMs, requestHeaders ) );
	}

	async #fetchWithRegionLease( assetURL, signal, consumeResponse, phaseMs, requestHeaders ) {
		abortIfNeeded( signal );
		const regionURL = new URL( assetURL, this.localProvider );
		const leaseURL = new URL( `${regionURL.pathname}/leases`, this.localProvider );
		leaseURL.searchParams.set( 'cell', regionURL.searchParams.get( 'cell' ) || '' );
		leaseURL.searchParams.set( 'payload', regionURL.searchParams.get( 'payload' ) || 'visual' );
		for ( const parameter of [ 'mesh', 'lod' ] ) {
			if ( regionURL.searchParams.has( parameter ) ) leaseURL.searchParams.set( parameter, regionURL.searchParams.get( parameter ) );
		}
		let phaseStartedAt = performance.now();
		const leaseResponse = await fetch( leaseURL, { method: 'POST', credentials: 'omit', cache: 'no-store', signal } );
		phaseMs.providerLeaseRequest = performance.now() - phaseStartedAt;
		if ( ! leaseResponse.ok ) throw new Error( `Local region lease request failed (${leaseResponse.status})` );
		phaseStartedAt = performance.now();
		const lease = await leaseResponse.json();
		phaseMs.providerLeaseResponseParse = performance.now() - phaseStartedAt;
		requireValue( /^[a-f0-9]{32}$/.test( lease?.leaseId || '' ) && lease.expiresInSeconds === 30, 'Local region provider returned an invalid lease' );
		const controller = new AbortController();
		const abort = () => controller.abort( signal?.reason || new DOMException( 'Aborted', 'AbortError' ) );
		if ( signal?.aborted ) abort();
		else signal?.addEventListener( 'abort', abort, { once: true } );
		const controlURL = new URL( `/v1/leases/${lease.leaseId}`, this.localProvider );
		let renewalTimer;
		let released = false;
		const renew = async () => {
			if ( released || controller.signal.aborted ) return;
			try {
				const response = await fetch( controlURL, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal } );
				if ( ! response.ok ) throw new Error( `Local region lease renewal failed (${response.status})` );
				if ( ! released && ! controller.signal.aborted ) renewalTimer = setTimeout( () => { renew(); }, REGION_LEASE_RENEW_MS );
			} catch ( error ) {
				if ( ! released && ! controller.signal.aborted ) controller.abort( error );
			}
		};
		renewalTimer = setTimeout( () => { renew(); }, REGION_LEASE_RENEW_MS );
		const leasedURL = new URL( regionURL );
		leasedURL.searchParams.set( 'lease', lease.leaseId );
		try {
			phaseStartedAt = performance.now();
			const response = await fetch( leasedURL, { credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: requestHeaders } );
			phaseMs.providerRegionResponse = performance.now() - phaseStartedAt;
			return await consumeResponse( response, controller.signal );
		} finally {
			released = true;
			clearTimeout( renewalTimer );
			signal?.removeEventListener( 'abort', abort );
			phaseStartedAt = performance.now();
			try {
				const releaseURL = new URL( `${controlURL.pathname}/release`, this.localProvider );
				await fetch( releaseURL, { method: 'POST', credentials: 'omit', cache: 'no-store', keepalive: true } );
			} catch { /* Lease expiry reclaims interest if the browser has gone away. */ }
			phaseMs.providerLeaseRelease = performance.now() - phaseStartedAt;
		}
	}

	#cacheAsset( assetId, bytes ) {
		if ( bytes.byteLength > this.assetCacheBudgetBytes ) return bytes;
		this.assets.set( assetId, bytes );
		this.assetBytes += bytes.byteLength;
		while ( this.assetBytes > this.assetCacheBudgetBytes && this.assets.size > 1 ) {
			const oldest = this.assets.keys().next().value;
			const evicted = this.assets.get( oldest );
			this.assets.delete( oldest );
			this.assetBytes -= evicted.byteLength;
		}
		return bytes;
	}

	releaseAsset( assetId ) {
		const bytes = this.assets.get( assetId );
		if ( bytes ) {
			this.assets.delete( assetId );
			this.assetBytes -= bytes.byteLength;
		}
		let releasedRange = false;
		for ( const [ key, entry ] of this.assetRanges ) {
			if ( entry.assetId !== assetId ) continue;
			this.assetRanges.delete( key );
			this.assetRangeBytes -= entry.bytes.byteLength;
			releasedRange = true;
		}
		return Boolean( bytes ) || releasedRange;
	}

	async preload( { assetIDs, position, viewPriorityByAsset = new Map(), signal, onProgress = () => {}, onAsset, retainAssets = true, retainAssetIDs = new Set() } = {} ) {
		requireValue( this.manifest, 'Load the local world descriptor first' );
		requireValue( typeof onProgress === 'function', 'Local region preload progress callback must be a function' );
		requireValue( onAsset === undefined || typeof onAsset === 'function', 'Local region asset callback must be a function' );
		requireValue( typeof retainAssets === 'boolean', 'Local region retention option must be a boolean' );
		requireValue( retainAssetIDs instanceof Set, 'Local region retained asset IDs must be a Set' );
		requireValue( viewPriorityByAsset instanceof Map && [ ...viewPriorityByAsset.values() ].every( value => typeof value === 'number' && ! Number.isNaN( value ) && value >= 0 ), 'Local region visual priority map is invalid' );
		const selected = assetIDs ? [ ...new Set( assetIDs ) ] : [ ...new Set( [
			...( this.manifest.objects || [] ).map( object => object.assetId ).filter( Boolean ),
			...( this.manifest.components || [] ).flatMap( worldComponentAssetIDs ),
		] ) ];
		const selectedSet = new Set( selected );
		const assetKinds = new Map( this.manifest.assets.map( asset => [ asset.id, asset.kind ] ) );
		const originalOrder = new Map( selected.map( ( assetId, index ) => [ assetId, index ] ) );
		const distanceByAsset = new Map();
		if ( position !== undefined ) {
			requireValue( Array.isArray( position ) && position.length === 3 && position.every( Number.isFinite ), 'Local region preload position is invalid' );
			for ( const object of this.manifest.objects ) {
				if ( ! object.regionCell || ! object.assetId || ! selectedSet.has( object.assetId ) || ! object.streamingBounds?.center ) continue;
				const center = object.streamingBounds.center;
				const dx = center[ 0 ] - position[ 0 ], dy = center[ 1 ] - position[ 1 ], dz = center[ 2 ] - position[ 2 ];
				const distance = Math.max( 0, Math.hypot( dx, dy, dz ) - ( object.streamingBounds.radius || 0 ) );
				distanceByAsset.set( object.assetId, Math.min( distanceByAsset.get( object.assetId ) ?? Infinity, distance ) );
			}
			for ( const component of this.manifest.components || [] ) {
				const bounds = component.streamingBounds;
				if ( ! bounds?.center ) continue;
				const dx = bounds.center[ 0 ] - position[ 0 ], dy = bounds.center[ 1 ] - position[ 1 ], dz = bounds.center[ 2 ] - position[ 2 ];
				const distance = Math.max( 0, Math.hypot( dx, dy, dz ) - ( bounds.radius || 0 ) );
				for ( const assetId of worldComponentAssetIDs( component ) ) {
					if ( selectedSet.has( assetId ) ) distanceByAsset.set( assetId, Math.min( distanceByAsset.get( assetId ) ?? Infinity, distance ) );
				}
			}
		}
		selected.sort( ( a, b ) => {
			const collisionOrder = Number( ! this.collisionAssetIDs.has( a ) ) - Number( ! this.collisionAssetIDs.has( b ) );
			if ( collisionOrder ) return collisionOrder;
			const distanceA = distanceByAsset.get( a ) ?? Infinity, distanceB = distanceByAsset.get( b ) ?? Infinity;
			if ( distanceA !== distanceB ) return distanceA - distanceB;
			const priorityA = viewPriorityByAsset.get( a ) ?? 0, priorityB = viewPriorityByAsset.get( b ) ?? 0;
			if ( priorityA !== priorityB ) return priorityA > priorityB ? -1 : 1;
			return originalOrder.get( a ) - originalOrder.get( b );
		} );
		const loaded = new Map();
		for ( const [ index, assetId ] of selected.entries() ) {
			const kind = assetKinds.get( assetId );
			const isGLB = kind === 'glb' || kind === 'model/gltf-binary';
			const progressive = this.collisionAssetIDs.has( assetId ) || ! isGLB ? null : await fetchGLBWithCoarseKTX2( this, assetId, { signal } );
			const bytes = progressive?.bytes || await this.getAsset( assetId, { signal } );
			const retain = retainAssets || retainAssetIDs.has( assetId );
			const installStartedAt = performance.now();
			try {
				if ( onAsset ) await onAsset( assetId, bytes, progressive );
				if ( retain ) loaded.set( assetId, bytes );
				if ( this.regionDiagnostics && onAsset ) console.info( 'ElseMesh local-region installed:', JSON.stringify( { assetId, bytes: bytes.byteLength, elapsedMs: Math.round( performance.now() - installStartedAt ) } ) );
			} catch ( error ) {
				if ( this.regionDiagnostics ) {
					const log = error?.name === 'AbortError' ? console.debug : console.error;
					log( error?.name === 'AbortError' ? 'ElseMesh local-region install cancelled:' : 'ElseMesh local-region install failed:', JSON.stringify( { assetId, bytes: bytes.byteLength, elapsedMs: Math.round( performance.now() - installStartedAt ), error: error?.stack || String( error ) } ) );
				}
				throw error;
			} finally {
				if ( ! retain ) this.releaseAsset( assetId );
			}
			onProgress( index + 1, selected.length );
		}
		return loaded;
	}

	close() {
		this.closed = true;
		this.assets.clear();
		this.assetBytes = 0;
		this.assetRanges.clear();
		this.assetRangeBytes = 0;
		this.regionAssets.clear();
		this.initialRegionCellObjectIDs.clear();
		this.collisionAssetIDs.clear();
		this.collisionObjectIDByAsset.clear();
		this.unknownCollisionObjectIDs.clear();
		this.missingCollisionPayloadObjectIDs.clear();
		this.unverifiedCollisionSourceObjectIDs.clear();
		this.verifiedEmptyCollisionObjectIDs.clear();
		this.collisionObjectIDsExpectShape.clear();
		this.collisionObjectIDsMissingKnownShape.clear();
		this.collisionObjectIDsByCell.clear();
		this.unknownSourcesByCell.clear();
		this.unknownSourcesCompleteByCell.clear();
		this.allCollisionSourcesIndexed = false;
		this.emptyCollisionCellsAreVerified = false;
		this.collisionLoadLatencyMs = 2000;
		this.cellSizeMeters = 0;
	}
}
