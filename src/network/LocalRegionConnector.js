import { validateWorldExperience } from './WorldExperience.js';
import { collisionPathReady, sweptCollisionCellKeys } from './CollisionFrontier.js';
import { parseGLB } from '../engine/loaders/GLTF.js';
import { isWorldID } from './WorldIdentity.js';
import { LocalRegionDiskCache } from './LocalRegionDiskCache.js';

const MAX_LOCAL_REGION_BYTES = 768 * 1024 * 1024;
const MAX_LOCAL_REGION_CACHE_BYTES = 256 * 1024 * 1024;
const REGION_LEASE_RENEW_MS = 10000;
// Provisional render-prefetch radius; tune it from streamed-cell latency and cache telemetry.
const LOCAL_REGION_PREFETCH_RADIUS_CELLS = 4;
const EMPTY_GLB = createEmptyGlb();

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

function cellCoordinate( position, sizeMeters ) {
	const coordinate = Math.floor( position / sizeMeters );
	requireValue( Number.isSafeInteger( coordinate ), 'Local provider has a preview spawn outside the supported cell range' );
	return coordinate;
}

function deriveStartupCells( position, previewRegion ) {
	const { cellSizeMeters, startupCellOffsetBounds } = previewRegion;
	const origin = position.map( coordinate => cellCoordinate( coordinate, cellSizeMeters ) );
	const { min, max } = startupCellOffsetBounds || {};
	requireValue( Array.isArray( min ) && Array.isArray( max ) && min.length === 3 && max.length === 3 && min.every( Number.isSafeInteger ) && max.every( Number.isSafeInteger ) && min.every( ( value, axis ) => value <= max[ axis ] ), 'Local provider has invalid startup cell offset bounds' );
	const count = min.reduce( ( total, value, axis ) => total * ( max[ axis ] - value + 1 ), 1 );
	requireValue( count >= 1 && count <= 64, 'Local provider startup cell footprint exceeds its limit' );
	const cells = new Map();
	for ( let x = min[ 0 ]; x <= max[ 0 ]; x ++ ) {
		for ( let y = min[ 1 ]; y <= max[ 1 ]; y ++ ) {
			for ( let z = min[ 2 ]; z <= max[ 2 ]; z ++ ) {
				const cell = [ origin[ 0 ] + x, origin[ 1 ] + y, origin[ 2 ] + z ];
				cells.set( cell.join( ',' ), cell );
			}
		}
	}
	for ( const offset of previewRegion.startupCellOffsets || [] ) {
		const cell = origin.map( ( value, axis ) => value + offset[ axis ] );
		cells.set( cell.join( ',' ), cell );
	}
	requireValue( cells.size <= 64, 'Local provider startup cell footprint exceeds its limit' );
	return [ ...cells.values() ];
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
		this.assets = new Map();
		this.assetBytes = 0;
		this.regionAssets = new Map();
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
		this.collisionLoadLatencyMs = 2000;
		this.cellSizeMeters = 0;
		this.maxViewDistanceMeters = 0;
		this.manifest = null;
		this.closed = false;
		this.diskCache = null;
	}

	async getManifest( { signal } = {} ) {
		abortIfNeeded( signal );
		const base = `${this.localProvider}/v1`;
		const descriptor = await fetchJSON( `${base}/descriptor`, signal );
		requireValue( descriptor.schema === 'elsemesh.dynamic-region-provider/1' && descriptor.readOnly === true && typeof descriptor.sourceRevision === 'string' && isWorldID( descriptor.worldId ) && ( descriptor.title === undefined || typeof descriptor.title === 'string' && descriptor.title.trim() && descriptor.title.length <= 160 ), 'Local provider returned an unsupported descriptor' );
		const selection = descriptor.entrySelection;
		requireValue( selection && ( selection.schema === undefined || selection.schema === 'elsemesh.world-entry-selection/1' ) && typeof selection.entryPointActionLabel === 'string' && selection.entryPointActionLabel.trim() && selection.entryPointActionLabel.length <= 80 && typeof selection.entryPointPrompt === 'string' && selection.entryPointPrompt.trim() && Array.isArray( selection.choices ) && selection.choices.length <= 16 && new Set( selection.choices.map( choice => choice?.id ) ).size === selection.choices.length && selection.choices.every( choice => /^[a-z0-9][a-z0-9.-]{0,63}$/.test( choice?.id || '' ) && typeof choice.label === 'string' && choice.label.trim() && choice.label.length <= 80 ) && selection.previewSpawn && Array.isArray( selection.previewSpawn.position ) && selection.previewSpawn.position.length === 3 && selection.previewSpawn.position.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) && Number.isFinite( selection.previewSpawn.yaw ) && Math.abs( selection.previewSpawn.yaw ) <= 360 && ( selection.previewSpawn.pitch === undefined || Number.isFinite( selection.previewSpawn.pitch ) && Math.abs( selection.previewSpawn.pitch ) <= 1.5 ), 'Local provider has no valid world-authored entry selection or preview pose' );
		const previewRegion = selection.previewRegion;
		requireValue( previewRegion && Number.isInteger( previewRegion.cellSizeMeters ) && previewRegion.cellSizeMeters >= 8 && previewRegion.cellSizeMeters <= 256, 'Local provider has no valid preview cell size' );
		requireValue( Number.isFinite( previewRegion.maxViewDistanceMeters ) && previewRegion.maxViewDistanceMeters > 0 && previewRegion.maxViewDistanceMeters <= 10000, 'Local provider has no valid world-authored cell view distance' );
		const startupCellOffsets = previewRegion.startupCellOffsets ?? [];
		requireValue( Array.isArray( startupCellOffsets ) && startupCellOffsets.length <= 40 && startupCellOffsets.every( offset => Array.isArray( offset ) && offset.length === 3 && offset.every( value => Number.isSafeInteger( value ) && Math.abs( value ) <= 128 ) ), 'Local provider has invalid startup cell offsets' );
		const startupCells = deriveStartupCells( selection.previewSpawn.position, previewRegion );
		if ( selection.previewSupport !== undefined ) {
			const support = selection.previewSupport;
			requireValue( support?.status === 'provisional' && typeof support.basis === 'string' && support.basis.length <= 500 && Array.isArray( support.position ) && support.position.length === 3 && support.position.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) && Array.isArray( support.halfExtents ) && support.halfExtents.length === 3 && support.halfExtents.every( value => Number.isFinite( value ) && value > 0 && value <= 1000 ) && ( support.yaw === undefined || Number.isFinite( support.yaw ) && Math.abs( support.yaw ) <= 360 ), 'Local provider has invalid provisional preview support' );
		}
		const experience = selection.experience ? structuredClone( validateWorldExperience( selection.experience ) ) : null;
		if ( experience?.theme?.logo?.src.startsWith( '/' ) ) experience.theme.logo.src = new URL( experience.theme.logo.src, `${base}/` ).href;
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
		this.diskCache = await LocalRegionDiskCache.open( {
			worldId: this.worldId,
			sourceRevision: this.sourceRevision,
			onError: error => { if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region disk cache unavailable:', error ); },
		} );
		const startupCellKeys = new Set( startupCells.map( cell => cell.join( ',' ) ) );
		const spawnCell = selection.previewSpawn.position.map( coordinate => cellCoordinate( coordinate, previewRegion.cellSizeMeters ) );
		const explicitStartupCellKeys = new Set( startupCellOffsets.map( offset => spawnCell.map( ( value, axis ) => value + offset[ axis ] ).join( ',' ) ) );
		this.allCollisionSourcesIndexed = true;
		this.emptyCollisionCellsAreVerified = true;
		this.initialRegionCellObjectIDs = new Set();
		this.explicitStartupCellVisualObjectIDs = new Set();
		this.initialStartupCellKeys = startupCellKeys;
		const spawn = selection.previewSpawn;
		this.manifest = {
			protocol: 'elsemesh.world/3', worldId: this.worldId, title: descriptor.title ? `${descriptor.title} · ${region.label}` : region.label,
			experience, ownerPeerId: '', authorityEpoch: 1, assets: [], objects: [], components: [], portals: [],
			// Shared ElseMesh movement defaults are provisional and are not game-derived or parity evidence.
			rules: { gravity: 1, avatarComplexity: 20000, physicsProfile: 'default', maxVisitors: 128, spawnRadius: 0 },
			spawn,
			entryPointActionLabel: selection.entryPointActionLabel,
			entryPoints: selection.choices.map( choice => ( { id: choice.id, label: choice.label, ...( choice.uniform ? { uniform: choice.uniform } : {} ) } ) ),
			entryPointPrompt: selection.entryPointPrompt, sourceRevision: this.sourceRevision,
		};
		this.baseURL = base;
		this.previewRegion = previewRegion;
		this.sourceRegions = regions;
		this.queriedCellsByRegion = new Map( regions.map( item => [ item.id, new Set() ] ) );
		this.knownCells = new Set();
		this.cellQueryQueue = Promise.resolve();
		this.explicitStartupCellKeys = explicitStartupCellKeys;
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
		requireValue( requested.length > 0 && requested.length <= 512, 'Local provider cell request exceeds the 512-coordinate limit' );
		const cellSize = this.previewRegion.cellSizeMeters;
		for ( const sourceRegion of this.sourceRegions ) {
			const queried = this.queriedCellsByRegion.get( sourceRegion.id );
			const pending = requested.filter( key => ! queried.has( key ) );
			if ( pending.length === 0 ) continue;
			const sourceURL = new URL( sourceRegion.asset, `${this.baseURL}/` );
			requireValue( sourceURL.origin === this.localProvider && sourceURL.pathname.startsWith( '/v1/regions/' ), 'Local provider returned an unsafe region URL' );
			const cellIndexURL = new URL( `${sourceURL.pathname}/cells`, this.localProvider );
			cellIndexURL.searchParams.set( 'size', String( cellSize ) );
			for ( const cell of pending ) cellIndexURL.searchParams.append( 'cell', cell );
			const cellIndex = await fetchJSON( cellIndexURL, signal );
			requireValue( cellIndex.sourceRevision === this.sourceRevision && cellIndex.cellSizeMeters === cellSize && Array.isArray( cellIndex.cells ) && cellIndex.cells.length <= pending.length, 'Local provider returned an invalid bounded cell response' );
			const requestedSet = new Set( pending );
			for ( const cell of cellIndex.cells ) requireValue( requestedSet.has( `${cell?.x},${cell?.y},${cell?.z}` ), 'Local provider returned an unrequested cell' );
			this.#installCellIndex( sourceRegion, cellIndex );
			for ( const cell of pending ) queried.add( cell );
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
		const frontier = sweptCollisionCellKeys( from, to, { cellSizeMeters: cellSize } );
		const candidates = [];
		for ( let x = - LOCAL_REGION_PREFETCH_RADIUS_CELLS; x <= LOCAL_REGION_PREFETCH_RADIUS_CELLS; x ++ ) for ( let y = - LOCAL_REGION_PREFETCH_RADIUS_CELLS; y <= LOCAL_REGION_PREFETCH_RADIUS_CELLS; y ++ ) for ( let z = - LOCAL_REGION_PREFETCH_RADIUS_CELLS; z <= LOCAL_REGION_PREFETCH_RADIUS_CELLS; z ++ ) {
			if ( x * x + y * y + z * z > LOCAL_REGION_PREFETCH_RADIUS_CELLS ** 2 ) continue;
			candidates.push( [ centerCell[ 0 ] + x, centerCell[ 1 ] + y, centerCell[ 2 ] + z ] );
		}
		const distanceSquared = cell => ( cell[ 0 ] - centerCell[ 0 ] ) ** 2 + ( cell[ 1 ] - centerCell[ 1 ] ) ** 2 + ( cell[ 2 ] - centerCell[ 2 ] ) ** 2;
		candidates.sort( ( a, b ) => distanceSquared( a ) - distanceSquared( b ) );
		const requested = new Set( [ ...frontier, ...candidates.map( cell => cell.join( ',' ) ) ] );
		return this.ensureCells( [ ...requested ].slice( 0, 512 ).map( cell => cell.split( ',' ).map( Number ) ) );
	}

	#installCellIndex( sourceRegion, cellIndex ) {
		const { baseURL: base, previewRegion, explicitStartupCellKeys } = this;
		const startupCellKeys = new Set( this.initialStartupCellKeys );
		const sourceInventory = cellIndex.collisionSourceInventory;
		requireValue( Number.isSafeInteger( sourceInventory?.staticMeshComponents ) && sourceInventory.staticMeshComponents >= 0 && Number.isSafeInteger( sourceInventory.otherPrimitiveComponents ) && sourceInventory.otherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.unclassifiedOtherPrimitiveComponents ) && sourceInventory.unclassifiedOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.explicitlyNonQueryOtherPrimitiveComponents ) && sourceInventory.explicitlyNonQueryOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.explicitlyNonBlockingForPawnOtherPrimitiveComponents ) && sourceInventory.explicitlyNonBlockingForPawnOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.audioOnlyPolicyExcludedOtherPrimitiveComponents ) && sourceInventory.audioOnlyPolicyExcludedOtherPrimitiveComponents >= 0 && Number.isSafeInteger( sourceInventory.noSkeletalCollisionGeometryComponents ) && sourceInventory.noSkeletalCollisionGeometryComponents >= 0 && sourceInventory.unclassifiedOtherPrimitiveComponents + sourceInventory.explicitlyNonQueryOtherPrimitiveComponents + sourceInventory.explicitlyNonBlockingForPawnOtherPrimitiveComponents + sourceInventory.audioOnlyPolicyExcludedOtherPrimitiveComponents + sourceInventory.noSkeletalCollisionGeometryComponents === sourceInventory.otherPrimitiveComponents && Number.isSafeInteger( sourceInventory.landscapeHeightfieldCollisionComponents ) && sourceInventory.landscapeHeightfieldCollisionComponents >= 0 && Number.isSafeInteger( sourceInventory.unresolvedInstancedMeshComponents ) && sourceInventory.unresolvedInstancedMeshComponents >= 0 && sourceInventory.otherPrimitiveStatuses && typeof sourceInventory.otherPrimitiveStatuses === 'object' && Object.values( sourceInventory.otherPrimitiveStatuses ).every( count => Number.isSafeInteger( count ) && count >= 0 ) && Object.values( sourceInventory.otherPrimitiveStatuses ).reduce( ( total, count ) => total + count, 0 ) === sourceInventory.otherPrimitiveComponents, 'Local provider returned invalid collision source inventory' );
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
			cells.set( cellKey, { x: cell.x, y: cell.y, z: cell.z, evidence } );
		}
		for ( const cell of cells.values() ) {
			const cellKey = `${cell.x},${cell.y},${cell.z}`;
			const assetId = `local-region:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}`;
			const center = [
				( cell.x + 0.5 ) * previewRegion.cellSizeMeters,
				( cell.y + 0.5 ) * previewRegion.cellSizeMeters,
				( cell.z + 0.5 ) * previewRegion.cellSizeMeters,
			];
			const isStartupCell = startupCellKeys.has( cellKey );
			const cellObjectIDs = this.collisionObjectIDsByCell.get( cellKey ) || new Set();
			const collisionAssetId = `${assetId}:collision`;
			const collisionObjectId = `elsemesh-object:region-cell:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}:collision`;
			const visualAssetId = `${assetId}:visual`;
			const visualObjectId = `elsemesh-object:region-cell:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}:visual`;
			const collisionURL = new URL( sourceRegion.asset, `${base}/` );
			collisionURL.searchParams.set( 'cell', `${cellKey},${previewRegion.cellSizeMeters}` );
			collisionURL.searchParams.set( 'payload', 'collision' );
			const visualURL = new URL( collisionURL );
			visualURL.searchParams.set( 'payload', 'visual' );
			this.regionAssets.set( collisionAssetId, collisionURL.href );
			this.regionAssets.set( visualAssetId, visualURL.href );
			this.collisionAssetIDs.add( collisionAssetId );
			this.collisionObjectIDByAsset.set( collisionAssetId, collisionObjectId );
			if ( cell.evidence.supportedSimpleShapeComponents > 0 || cell.evidence.supportedOtherPrimitiveComponents > 0 ) this.collisionObjectIDsExpectShape.add( collisionObjectId );
			const collisionCoverageVerified = allCollisionSourcesIndexed && cell.evidence?.scope === 'all-collision-sources' && cell.evidence.staticMeshComponentsClassified && cell.evidence.unknownOtherPrimitiveComponents === 0;
			if ( ! collisionCoverageVerified ) this.unverifiedCollisionSourceObjectIDs.add( collisionObjectId );
			else if ( cell.evidence.supportedSimpleShapeComponents === 0 && cell.evidence.unknownComponents === 0 && cell.evidence.supportedOtherPrimitiveComponents === 0 ) this.verifiedEmptyCollisionObjectIDs.add( collisionObjectId );
			cellObjectIDs.add( collisionObjectId );
			this.collisionObjectIDsByCell.set( cellKey, cellObjectIDs );
			if ( isStartupCell ) this.initialRegionCellObjectIDs.add( collisionObjectId );
			if ( explicitStartupCellKeys.has( cellKey ) ) this.explicitStartupCellVisualObjectIDs.add( visualObjectId );
			this.manifest.assets.push(
				{ id: collisionAssetId, bytes: 0, kind: 'model/gltf-binary', priority: isStartupCell ? 'visible' : 'background' },
				{ id: visualAssetId, bytes: 0, kind: 'model/gltf-binary', priority: isStartupCell ? 'visible' : 'background' },
			);
			this.manifest.objects.push(
				{
					id: collisionObjectId, label: `${sourceRegion.label} collision cell ${cellKey}`, kind: 'asset-instance', assetId: collisionAssetId,
					transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority: isStartupCell ? 'visible' : 'background',
					streamingBounds: { center, radius: previewRegion.cellSizeMeters * Math.sqrt( 3 ) / 2, maxDistanceMeters: previewRegion.maxViewDistanceMeters }, regionCell: true, collisionPayload: true,
				},
				{
					id: visualObjectId, label: `${sourceRegion.label} visual cell ${cellKey}`, kind: 'asset-instance', assetId: visualAssetId,
					transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority: isStartupCell ? 'visible' : 'background',
					streamingBounds: { center, radius: previewRegion.cellSizeMeters * Math.sqrt( 3 ) / 2, maxDistanceMeters: previewRegion.maxViewDistanceMeters }, regionCell: true,
				},
			);
		}
	}

	isCollisionPathReady( from, to, { loadedObjects } = {} ) {
		return collisionPathReady( {
			from, to, cellSizeMeters: this.cellSizeMeters,
			objectIDsByCell: this.collisionObjectIDsByCell, loadedObjectIDs: loadedObjects,
			unknownObjectIDs: this.unknownCollisionObjectIDs, unknownSourcesByCell: this.unknownSourcesByCell,
			unknownSourcesCompleteByCell: this.unknownSourcesCompleteByCell, knownCells: this.knownCells, emptyCellsAreVerified: this.emptyCollisionCellsAreVerified,
			missingCollisionPayloadObjectIDs: this.missingCollisionPayloadObjectIDs,
			missingKnownShapeObjectIDs: this.collisionObjectIDsMissingKnownShape,
		} );
	}

	collisionObjectIDsAlongPath( from, to ) {
		const objectIDs = new Set();
		for ( const cellKey of sweptCollisionCellKeys( from, to, { cellSizeMeters: this.cellSizeMeters } ) ) {
			for ( const objectID of this.collisionObjectIDsByCell.get( cellKey ) || [] ) objectIDs.add( objectID );
		}
		return objectIDs;
	}

	async getAsset( assetId, { signal } = {} ) {
		abortIfNeeded( signal );
		if ( this.assets.has( assetId ) ) {
			const bytes = this.assets.get( assetId );
			this.assets.delete( assetId );
			this.assets.set( assetId, bytes );
			return bytes;
		}
		const assetURL = this.regionAssets.get( assetId );
		requireValue( this.manifest && assetURL, 'Local region asset was not declared by the provider' );
		const startedAt = performance.now();
		let diskBytes = null;
		try { diskBytes = await this.diskCache?.get( assetId ) || null; } catch ( error ) {
			if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region disk cache read failed:', error );
		}
		if ( diskBytes ) {
			this.#updateCollisionCoverage( assetId, diskBytes );
			if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region disk cache hit:', JSON.stringify( { assetId, bytes: diskBytes.byteLength } ) );
			return this.#cacheAsset( assetId, diskBytes );
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
			const bytes = new Uint8Array( await response.arrayBuffer() );
			abortIfNeeded( leaseSignal );
			requireValue( bytes.byteLength === declaredLength && bytes.byteLength <= MAX_LOCAL_REGION_BYTES, 'Local region length is invalid' );
			const digest = await crypto.subtle.digest( 'SHA-256', bytes );
			const digestHex = [ ...new Uint8Array( digest ) ].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			requireValue( response.headers.get( 'ETag' ) === `"sha256-${digestHex}"`, 'Local region ETag does not match its content digest' );
			this.#updateCollisionCoverage( assetId, bytes );
			try { await this.diskCache?.put( assetId, bytes, digestHex ); } catch ( error ) {
				if ( this.regionDiagnostics ) console.warn( 'ElseMesh local-region disk cache write failed:', error );
			}
			return this.#cacheAsset( assetId, bytes );
		} ).catch( error => {
			if ( this.regionDiagnostics ) {
				const log = error?.name === 'AbortError' ? console.debug : console.error;
				log( error?.name === 'AbortError' ? 'ElseMesh local-region fetch cancelled:' : 'ElseMesh local-region fetch failed:', JSON.stringify( { assetId, elapsedMs: Math.round( performance.now() - startedAt ), error: error?.stack || String( error ) } ) );
			}
			throw error;
		} );
		if ( this.regionDiagnostics ) console.info( 'ElseMesh local-region fetched:', JSON.stringify( { assetId, bytes: bytes.byteLength, elapsedMs: Math.round( performance.now() - startedAt ) } ) );
		if ( this.collisionAssetIDs.has( assetId ) ) {
			const elapsedMs = Math.min( 30000, Math.max( 100, performance.now() - startedAt ) );
			this.collisionLoadLatencyMs = Math.round( this.collisionLoadLatencyMs * 0.75 + elapsedMs * 0.25 );
		}
		return bytes;
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

	async #withRegionLease( assetURL, signal, consumeResponse ) {
		abortIfNeeded( signal );
		const regionURL = new URL( assetURL, this.localProvider );
		const leaseURL = new URL( `${regionURL.pathname}/leases`, this.localProvider );
		leaseURL.searchParams.set( 'cell', regionURL.searchParams.get( 'cell' ) || '' );
		leaseURL.searchParams.set( 'payload', regionURL.searchParams.get( 'payload' ) || 'visual' );
		const leaseResponse = await fetch( leaseURL, { method: 'POST', credentials: 'omit', cache: 'no-store', signal } );
		if ( ! leaseResponse.ok ) throw new Error( `Local region lease request failed (${leaseResponse.status})` );
		const lease = await leaseResponse.json();
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
			const response = await fetch( leasedURL, { credentials: 'omit', cache: 'no-store', signal: controller.signal } );
			return await consumeResponse( response, controller.signal );
		} finally {
			released = true;
			clearTimeout( renewalTimer );
			signal?.removeEventListener( 'abort', abort );
			try {
				await fetch( controlURL, { method: 'DELETE', credentials: 'omit', cache: 'no-store', keepalive: true } );
			} catch { /* Lease expiry reclaims interest if the browser has gone away. */ }
		}
	}

	#cacheAsset( assetId, bytes ) {
		if ( bytes.byteLength > MAX_LOCAL_REGION_CACHE_BYTES ) return bytes;
		this.assets.set( assetId, bytes );
		this.assetBytes += bytes.byteLength;
		while ( this.assetBytes > MAX_LOCAL_REGION_CACHE_BYTES && this.assets.size > 1 ) {
			const oldest = this.assets.keys().next().value;
			const evicted = this.assets.get( oldest );
			this.assets.delete( oldest );
			this.assetBytes -= evicted.byteLength;
		}
		return bytes;
	}

	releaseAsset( assetId ) {
		const bytes = this.assets.get( assetId );
		if ( ! bytes ) return false;
		this.assets.delete( assetId );
		this.assetBytes -= bytes.byteLength;
		return true;
	}

	async preload( { assetIDs, signal, onProgress = () => {}, onAsset, retainAssets = true, retainAssetIDs = new Set() } = {} ) {
		requireValue( this.manifest, 'Load the local world descriptor first' );
		requireValue( typeof onProgress === 'function', 'Local region preload progress callback must be a function' );
		requireValue( onAsset === undefined || typeof onAsset === 'function', 'Local region asset callback must be a function' );
		requireValue( typeof retainAssets === 'boolean', 'Local region retention option must be a boolean' );
		requireValue( retainAssetIDs instanceof Set, 'Local region retained asset IDs must be a Set' );
		const selected = assetIDs ? [ ...new Set( assetIDs ) ] : [ ...this.regionAssets.keys() ];
		selected.sort( ( a, b ) => Number( ! this.collisionAssetIDs.has( a ) ) - Number( ! this.collisionAssetIDs.has( b ) ) );
		const loaded = new Map();
		for ( const [ index, assetId ] of selected.entries() ) {
			const bytes = await this.getAsset( assetId, { signal } );
			const retain = retainAssets || retainAssetIDs.has( assetId );
			const installStartedAt = performance.now();
			try {
				if ( onAsset ) await onAsset( assetId, bytes );
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
		this.regionAssets.clear();
		this.initialRegionCellObjectIDs.clear();
		this.explicitStartupCellVisualObjectIDs.clear();
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
