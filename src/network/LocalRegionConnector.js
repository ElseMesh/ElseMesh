import { validateWorldExperience } from './WorldExperience.js';
import { collisionPathReady, sweptCollisionCellKeys } from './CollisionFrontier.js';
import { parseGLB } from '../engine/loaders/GLTF.js';

const MAX_LOCAL_REGION_BYTES = 768 * 1024 * 1024;
const MAX_LOCAL_REGION_CACHE_BYTES = 256 * 1024 * 1024;
const REGION_LEASE_RENEW_MS = 10000;
const DEFAULT_WORLD_ID = 'world:hogwarts-legacy-local';
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
	constructor( { localProvider, localMap } ) {
		this.localOnly = true;
		this.localProvider = new URL( localProvider ).origin;
		this.localMap = localMap;
		this.worldId = DEFAULT_WORLD_ID;
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
		this.unverifiedCollisionSourceObjectIDs = new Set();
		this.collisionObjectIDsByCell = new Map();
		this.collisionLoadLatencyMs = 2000;
		this.cellSizeMeters = 0;
		this.manifest = null;
		this.closed = false;
	}

	async getManifest( { signal } = {} ) {
		abortIfNeeded( signal );
		const base = `${this.localProvider}/v1`;
		const descriptor = await fetchJSON( `${base}/descriptor`, signal );
		requireValue( descriptor.schema === 'elsemesh.dynamic-region-provider/1' && descriptor.readOnly === true && typeof descriptor.sourceRevision === 'string', 'Local provider returned an unsupported descriptor' );
		const selection = descriptor.entrySelection;
		requireValue( selection?.schema === 'elsemesh.hogwarts-entry-selection/1' && typeof selection.entryPointActionLabel === 'string' && selection.entryPointActionLabel.trim() && selection.entryPointActionLabel.length <= 80 && typeof selection.entryPointPrompt === 'string' && selection.entryPointPrompt.trim() && Array.isArray( selection.choices ) && selection.choices.length >= 1 && selection.choices.length <= 16 && new Set( selection.choices.map( choice => choice?.id ) ).size === selection.choices.length && selection.choices.every( choice => /^[a-z0-9][a-z0-9.-]{0,63}$/.test( choice?.id || '' ) && typeof choice.label === 'string' && choice.label.trim() && choice.label.length <= 80 ) && selection.previewSpawn && Array.isArray( selection.previewSpawn.position ) && selection.previewSpawn.position.length === 3 && selection.previewSpawn.position.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) && Number.isFinite( selection.previewSpawn.yaw ) && Math.abs( selection.previewSpawn.yaw ) <= 360 && ( selection.previewSpawn.pitch === undefined || Number.isFinite( selection.previewSpawn.pitch ) && Math.abs( selection.previewSpawn.pitch ) <= 1.5 ), 'Local provider has no valid world-authored entry selection or preview pose' );
		const previewRegion = selection.previewRegion;
		requireValue( previewRegion && Array.isArray( previewRegion.cell ) && previewRegion.cell.length === 3 && previewRegion.cell.every( Number.isSafeInteger ) && Number.isInteger( previewRegion.cellSizeMeters ) && previewRegion.cellSizeMeters >= 8 && previewRegion.cellSizeMeters <= 256, 'Local provider has no valid preview cell' );
		const startupCells = previewRegion.startupCells || [ previewRegion.cell ];
		requireValue( Array.isArray( startupCells ) && startupCells.length >= 1 && startupCells.length <= 64 && startupCells.every( cell => Array.isArray( cell ) && cell.length === 3 && cell.every( Number.isSafeInteger ) ), 'Local provider has invalid startup cells' );
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
		const assetURL = new URL( region.asset, `${base}/` );
		requireValue( assetURL.origin === this.localProvider && assetURL.pathname.startsWith( '/v1/regions/' ), 'Local provider returned an unsafe region URL' );
		this.region = region;
		this.worldId = descriptor.worldId || DEFAULT_WORLD_ID;
		this.sourceRevision = descriptor.sourceRevision;
		const startupCellKeys = new Set( startupCells.map( cell => cell.join( ',' ) ) );
		this.initialRegionCellObjectIDs = new Set();
		this.initialRegionVisualObjectIDs = new Set();
		const spawn = selection.previewSpawn;
		this.manifest = {
			protocol: 'elsemesh.world/1', worldId: this.worldId, title: `Hogwarts Legacy · ${region.label}`,
			experience, ownerPeerId: '', authorityEpoch: 1, assets: [], objects: [], components: [], portals: [],
			rules: { gravity: 1, avatarComplexity: 20000, physicsProfile: 'default', maxVisitors: 128, spawnRadius: 0, movement: { walkSpeed: 3, sprintSpeed: 6.2, jumpSpeed: 4.6 } },
			spawn,
			entryPointActionLabel: selection.entryPointActionLabel,
			entryPoints: selection.choices.map( choice => ( { id: choice.id, label: choice.label, ...( choice.uniform ? { uniform: choice.uniform } : {} ) } ) ),
			entryPointPrompt: selection.entryPointPrompt, sourceRevision: this.sourceRevision,
		};
		for ( const sourceRegion of regions ) {
			const sourceURL = new URL( sourceRegion.asset, `${base}/` );
			requireValue( sourceURL.origin === this.localProvider && sourceURL.pathname.startsWith( '/v1/regions/' ), 'Local provider returned an unsafe region URL' );
			const cellIndexURL = new URL( `${sourceURL.pathname}/cells`, this.localProvider );
			cellIndexURL.searchParams.set( 'size', String( previewRegion.cellSizeMeters ) );
			const cellIndex = await fetchJSON( cellIndexURL, signal );
			requireValue( cellIndex.sourceRevision === this.sourceRevision && cellIndex.cellSizeMeters === previewRegion.cellSizeMeters && Array.isArray( cellIndex.cells ) && cellIndex.cells.length <= 50000, 'Local provider returned an invalid occupied-cell index' );
			const cells = new Map();
			for ( const cell of cellIndex.cells ) {
				requireValue( Number.isSafeInteger( cell?.x ) && Number.isSafeInteger( cell?.y ) && Number.isSafeInteger( cell?.z ), 'Local provider returned invalid cell coordinates' );
				const evidence = cell.collisionEvidence;
				requireValue( [ 'all-collision-sources', 'static-mesh-components-only' ].includes( evidence?.scope ) && Number.isSafeInteger( evidence.staticMeshComponentCount ) && evidence.staticMeshComponentCount >= 0 && Number.isSafeInteger( evidence.unknownComponents ) && evidence.unknownComponents >= 0 && Number.isSafeInteger( evidence.supportedSimpleShapeComponents ) && evidence.supportedSimpleShapeComponents >= 0 && Number.isSafeInteger( evidence.explicitlyNonQueryCollidableComponents ) && evidence.explicitlyNonQueryCollidableComponents >= 0 && evidence.supportedSimpleShapeComponents + evidence.explicitlyNonQueryCollidableComponents + evidence.unknownComponents === evidence.staticMeshComponentCount && evidence.staticMeshComponentsClassified === ( evidence.unknownComponents === 0 ), 'Local provider returned invalid collision coverage evidence' );
				cells.set( `${cell.x},${cell.y},${cell.z}`, { x: cell.x, y: cell.y, z: cell.z, evidence } );
			}
			const isPrimaryRegion = sourceRegion.id === region.id;
			for ( const startupCell of startupCells ) {
				const cellKey = startupCell.join( ',' );
				if ( isPrimaryRegion || cells.has( cellKey ) ) {
					const existing = cells.get( cellKey );
					cells.set( cellKey, { x: startupCell[ 0 ], y: startupCell[ 1 ], z: startupCell[ 2 ], evidence: existing?.evidence } );
				}
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
				const collisionObjectId = `elsemesh-object:hogwarts-cell:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}:collision`;
				const visualAssetId = `${assetId}:visual`;
				const visualObjectId = `elsemesh-object:hogwarts-cell:${sourceRegion.id}:${previewRegion.cellSizeMeters}:${cellKey}:visual`;
				const collisionURL = new URL( sourceRegion.asset, `${base}/` );
				collisionURL.searchParams.set( 'cell', `${cellKey},${previewRegion.cellSizeMeters}` );
				collisionURL.searchParams.set( 'payload', 'collision' );
				const visualURL = new URL( collisionURL );
				visualURL.searchParams.set( 'payload', 'visual' );
				this.regionAssets.set( collisionAssetId, collisionURL.href );
				this.regionAssets.set( visualAssetId, visualURL.href );
				this.collisionAssetIDs.add( collisionAssetId );
				this.collisionObjectIDByAsset.set( collisionAssetId, collisionObjectId );
				if ( cell.evidence?.scope !== 'all-collision-sources' || ! cell.evidence.staticMeshComponentsClassified ) this.unverifiedCollisionSourceObjectIDs.add( collisionObjectId );
				cellObjectIDs.add( collisionObjectId );
				this.collisionObjectIDsByCell.set( cellKey, cellObjectIDs );
				if ( isStartupCell ) this.initialRegionCellObjectIDs.add( collisionObjectId );
				if ( isStartupCell ) this.initialRegionVisualObjectIDs.add( visualObjectId );
				this.manifest.assets.push(
					{ id: collisionAssetId, bytes: 0, kind: 'model/gltf-binary', priority: isStartupCell ? 'visible' : 'nearby' },
					{ id: visualAssetId, bytes: 0, kind: 'model/gltf-binary', priority: isStartupCell ? 'visible' : 'nearby' },
				);
				this.manifest.objects.push(
					{
						id: collisionObjectId, label: `${sourceRegion.label} collision cell ${cellKey}`, kind: 'asset-instance', assetId: collisionAssetId,
						transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority: isStartupCell ? 'visible' : 'nearby',
						streamingBounds: { center, radius: previewRegion.cellSizeMeters * Math.sqrt( 3 ) / 2 }, regionCell: true, collisionPayload: true,
					},
					{
						id: visualObjectId, label: `${sourceRegion.label} visual cell ${cellKey}`, kind: 'asset-instance', assetId: visualAssetId,
						transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority: isStartupCell ? 'visible' : 'nearby',
						streamingBounds: { center, radius: previewRegion.cellSizeMeters * Math.sqrt( 3 ) / 2 }, regionCell: true,
					},
				);
			}
		}
		const support = selection.previewSupport;
		if ( support ) {
			this.manifest.objects.push( {
				id: 'elsemesh-object:hogwarts-preview-floor-support', label: 'Provisional preview floor support', kind: 'asset-instance', assetId: null,
				transform: { position: support.position, yaw: support.yaw || 0 }, scale: [ 1, 1, 1 ], priority: 'visible',
				collision: { enabled: true, shape: 'box', center: [ 0, 0, 0 ], halfExtents: support.halfExtents, walkable: true, solid: true },
			} );
		}
		return this.manifest;
	}

	isCollisionPathReady( from, to, { loadedObjects } = {} ) {
		return collisionPathReady( {
			from, to, cellSizeMeters: this.cellSizeMeters,
			objectIDsByCell: this.collisionObjectIDsByCell, loadedObjectIDs: loadedObjects,
			unknownObjectIDs: this.unknownCollisionObjectIDs,
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
		const bytes = await this.#withRegionLease( assetURL, signal, async ( response, leaseSignal ) => {
			if ( response.status === 404 ) {
				const collisionObjectID = this.collisionObjectIDByAsset.get( assetId );
				if ( collisionObjectID ) {
					this.unknownCollisionObjectIDs.add( collisionObjectID );
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
			const collisionObjectID = this.collisionObjectIDByAsset.get( assetId );
			if ( collisionObjectID ) {
				// This distinguishes absent payloads from shape-bearing data; the provider still needs a full-cell coverage proof.
				if ( hasEmbeddedCollisionShape( bytes ) && ! this.unverifiedCollisionSourceObjectIDs.has( collisionObjectID ) ) this.unknownCollisionObjectIDs.delete( collisionObjectID );
				else this.unknownCollisionObjectIDs.add( collisionObjectID );
			}
			return this.#cacheAsset( assetId, bytes );
		} );
		if ( this.collisionAssetIDs.has( assetId ) ) {
			const elapsedMs = Math.min( 30000, Math.max( 100, performance.now() - startedAt ) );
			this.collisionLoadLatencyMs = Math.round( this.collisionLoadLatencyMs * 0.75 + elapsedMs * 0.25 );
		}
		return bytes;
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

	async preload( { assetIDs, signal } = {} ) {
		requireValue( this.manifest, 'Load the local world descriptor first' );
		const selected = assetIDs ? [ ...new Set( assetIDs ) ] : [ ...this.regionAssets.keys() ];
		selected.sort( ( a, b ) => Number( ! this.collisionAssetIDs.has( a ) ) - Number( ! this.collisionAssetIDs.has( b ) ) );
		const loaded = new Map();
		for ( const assetId of selected ) loaded.set( assetId, await this.getAsset( assetId, { signal } ) );
		return loaded;
	}

	close() {
		this.closed = true;
		this.assets.clear();
		this.assetBytes = 0;
		this.regionAssets.clear();
		this.initialRegionCellObjectIDs.clear();
		this.initialRegionVisualObjectIDs.clear();
		this.collisionAssetIDs.clear();
		this.collisionObjectIDByAsset.clear();
		this.unknownCollisionObjectIDs.clear();
		this.unverifiedCollisionSourceObjectIDs.clear();
		this.collisionObjectIDsByCell.clear();
		this.collisionLoadLatencyMs = 2000;
		this.cellSizeMeters = 0;
	}
}
