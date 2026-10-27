const MAX_LOCAL_REGION_BYTES = 768 * 1024 * 1024;
const MAX_LOCAL_REGION_CACHE_BYTES = 256 * 1024 * 1024;
const REGION_LEASE_RENEW_MS = 10000;
const DEFAULT_WORLD_ID = 'tw-world:hogwarts-legacy-local';
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
		if ( selection.previewSupport !== undefined ) {
			const support = selection.previewSupport;
			requireValue( support?.status === 'provisional' && typeof support.basis === 'string' && support.basis.length <= 500 && Array.isArray( support.position ) && support.position.length === 3 && support.position.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) && Array.isArray( support.halfExtents ) && support.halfExtents.length === 3 && support.halfExtents.every( value => Number.isFinite( value ) && value > 0 && value <= 1000 ) && ( support.yaw === undefined || Number.isFinite( support.yaw ) && Math.abs( support.yaw ) <= 360 ), 'Local provider has invalid provisional preview support' );
		}
		const catalog = await fetchJSON( new URL( descriptor.regions, `${base}/descriptor` ), signal );
		requireValue( Array.isArray( catalog.regions ) && catalog.regions.length <= 10000, 'Local provider returned an invalid region catalog' );
		const region = catalog.regions.find( item => item.id === this.localMap || item.label === this.localMap );
		requireValue( region && typeof region.id === 'string' && typeof region.asset === 'string', `No local map matches “${this.localMap}”` );
		const assetURL = new URL( region.asset, `${base}/` );
		requireValue( assetURL.origin === this.localProvider && assetURL.pathname.startsWith( '/v1/regions/' ), 'Local provider returned an unsafe region URL' );
		this.region = region;
		this.worldId = descriptor.worldId || DEFAULT_WORLD_ID;
		this.sourceRevision = descriptor.sourceRevision;
		const cellIndexURL = new URL( `${assetURL.pathname}/cells`, this.localProvider );
		cellIndexURL.searchParams.set( 'size', String( previewRegion.cellSizeMeters ) );
		const cellIndex = await fetchJSON( cellIndexURL, signal );
		requireValue( cellIndex.sourceRevision === this.sourceRevision && cellIndex.cellSizeMeters === previewRegion.cellSizeMeters && Array.isArray( cellIndex.cells ) && cellIndex.cells.length <= 50000, 'Local provider returned an invalid occupied-cell index' );
		const cells = new Map();
		for ( const cell of cellIndex.cells ) {
			requireValue( Number.isSafeInteger( cell?.x ) && Number.isSafeInteger( cell?.y ) && Number.isSafeInteger( cell?.z ), 'Local provider returned invalid cell coordinates' );
			cells.set( `${cell.x},${cell.y},${cell.z}`, { x: cell.x, y: cell.y, z: cell.z } );
		}
		const spawnCellKey = previewRegion.cell.join( ',' );
		cells.set( spawnCellKey, { x: previewRegion.cell[ 0 ], y: previewRegion.cell[ 1 ], z: previewRegion.cell[ 2 ] } );
		const spawn = selection.previewSpawn;
		this.manifest = {
			protocol: 'tidewater.world/2', worldId: this.worldId, title: `Hogwarts Legacy · ${region.label}`,
			experience: null, ownerPeerId: '', authorityEpoch: 1, assets: [], objects: [], components: [], portals: [],
			rules: { gravity: 1, avatarComplexity: 20000, physicsProfile: 'default', maxVisitors: 128, spawnRadius: 0, movement: { walkSpeed: 3, sprintSpeed: 6.2, jumpSpeed: 4.6 } },
			spawn,
			entryPointActionLabel: selection.entryPointActionLabel,
			entryPoints: selection.choices.map( choice => ( { id: choice.id, label: choice.label, ...( choice.uniform ? { uniform: choice.uniform } : {} ) } ) ),
			entryPointPrompt: selection.entryPointPrompt, sourceRevision: this.sourceRevision,
		};
		for ( const cell of cells.values() ) {
			const cellKey = `${cell.x},${cell.y},${cell.z}`;
			const assetId = `local-region:${region.id}:${previewRegion.cellSizeMeters}:${cellKey}`;
			const assetURL = new URL( region.asset, `${base}/` );
			assetURL.searchParams.set( 'cell', `${cellKey},${previewRegion.cellSizeMeters}` );
			this.regionAssets.set( assetId, assetURL.href );
			const center = [
				( cell.x + 0.5 ) * previewRegion.cellSizeMeters,
				( cell.y + 0.5 ) * previewRegion.cellSizeMeters,
				( cell.z + 0.5 ) * previewRegion.cellSizeMeters,
			];
			const isSpawnCell = cellKey === spawnCellKey;
			this.manifest.assets.push( { id: assetId, bytes: 0, kind: 'model/gltf-binary', priority: isSpawnCell ? 'visible' : 'nearby' } );
			this.manifest.objects.push( {
				id: `tw-object:hogwarts-cell:${region.id}:${previewRegion.cellSizeMeters}:${cellKey}`,
				label: `${region.label} cell ${cellKey}`, kind: 'asset-instance', assetId,
				transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority: isSpawnCell ? 'visible' : 'nearby',
				streamingBounds: { center, radius: previewRegion.cellSizeMeters * Math.sqrt( 3 ) / 2 },
				regionCell: true,
			} );
		}
		const support = selection.previewSupport;
		if ( support ) {
			this.manifest.objects.push( {
				id: 'tw-object:hogwarts-preview-floor-support', label: 'Provisional preview floor support', kind: 'asset-instance', assetId: null,
				transform: { position: support.position, yaw: support.yaw || 0 }, scale: [ 1, 1, 1 ], priority: 'visible',
				collision: { enabled: true, shape: 'box', center: [ 0, 0, 0 ], halfExtents: support.halfExtents, walkable: true, solid: true },
			} );
		}
		return this.manifest;
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
		return this.#withRegionLease( assetURL, signal, async ( response, leaseSignal ) => {
			if ( response.status === 404 ) return this.#cacheAsset( assetId, EMPTY_GLB );
			if ( ! response.ok ) throw new Error( `Local region request failed (${response.status})` );
			const declaredLength = Number( response.headers.get( 'Content-Length' ) );
			requireValue( Number.isSafeInteger( declaredLength ) && declaredLength > 0 && declaredLength <= MAX_LOCAL_REGION_BYTES, 'Local region exceeds the browser memory limit' );
			const bytes = new Uint8Array( await response.arrayBuffer() );
			abortIfNeeded( leaseSignal );
			requireValue( bytes.byteLength === declaredLength && bytes.byteLength <= MAX_LOCAL_REGION_BYTES, 'Local region length is invalid' );
			const digest = await crypto.subtle.digest( 'SHA-256', bytes );
			const digestHex = [ ...new Uint8Array( digest ) ].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			requireValue( response.headers.get( 'ETag' ) === `"sha256-${digestHex}"`, 'Local region ETag does not match its content digest' );
			return this.#cacheAsset( assetId, bytes );
		} );
	}

	async #withRegionLease( assetURL, signal, consumeResponse ) {
		abortIfNeeded( signal );
		const regionURL = new URL( assetURL, this.localProvider );
		const leaseURL = new URL( `${regionURL.pathname}/leases`, this.localProvider );
		leaseURL.searchParams.set( 'cell', regionURL.searchParams.get( 'cell' ) || '' );
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
		const selected = assetIDs ? new Set( assetIDs ) : new Set( this.regionAssets.keys() );
		const loaded = new Map();
		for ( const assetId of selected ) loaded.set( assetId, await this.getAsset( assetId, { signal } ) );
		return loaded;
	}

	close() {
		this.closed = true;
		this.assets.clear();
		this.assetBytes = 0;
		this.regionAssets.clear();
	}
}
