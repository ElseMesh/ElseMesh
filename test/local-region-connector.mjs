import assert from 'node:assert/strict';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { worldLinkFromLocation } from '../src/network/WorldConnector.js';
import { defaultHomeWorldURL, discoverLocalWorldURL } from '../src/network/WorldLauncher.js';
import { chooseWorldEntryPoint } from '../src/ui/WorldEntryPointPicker.js';

function makeGlb() {
	const document = {
		asset: { version: '2.0' },
		nodes: [ { translation: [ 10, 0, 20 ], extras: { elsemeshCollision: {
			coordinateSystem: 'elsemesh-y-up-meters/1',
			boxes: [ { center: [ 0, 0, 0 ], halfExtents: [ 10, 0, 10 ], rotation: [ 0, 0, 0, 1 ] } ],
		} } } ],
	};
	const json = new TextEncoder().encode( JSON.stringify( document ) );
	const jsonLength = ( json.byteLength + 3 ) & ~3;
	const bytes = new Uint8Array( 28 + jsonLength );
	const view = new DataView( bytes.buffer );
	view.setUint32( 0, 0x46546c67, true );
	view.setUint32( 4, 2, true );
	view.setUint32( 8, bytes.byteLength, true );
	view.setUint32( 12, jsonLength, true );
	view.setUint32( 16, 0x4e4f534a, true );
	bytes.fill( 0x20, 20, 20 + jsonLength );
	bytes.set( json, 20 );
	view.setUint32( 20 + jsonLength, 0, true );
	view.setUint32( 24 + jsonLength, 0x004e4942, true );
	return bytes;
}

function makeEmptyGlb() {
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

function makeExternalTextureGlb( assetId ) {
	const json = new TextEncoder().encode( JSON.stringify( { asset: { version: '2.0' }, images: [ {
		mimeType: 'image/ktx2', extensions: { EXT_elsemesh_asset_reference: { assetId } },
	} ] } ) );
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

const opfsFiles = new Map();
class TestOPFSFileHandle {
	constructor( name ) { this.name = name; }
	async getFile() {
		if ( ! opfsFiles.has( this.name ) ) throw new DOMException( 'Not found', 'NotFoundError' );
		return new Blob( [ opfsFiles.get( this.name ) ] );
	}
	async createWritable() {
		let pending;
		return {
			write: async contents => { pending = typeof contents === 'string' ? new TextEncoder().encode( contents ) : new Uint8Array( contents ); },
			close: async () => opfsFiles.set( this.name, pending ),
			abort: async () => {},
		};
	}
}
class TestOPFSDirectoryHandle {
	async getDirectoryHandle() { return this; }
	async getFileHandle( name ) { return new TestOPFSFileHandle( name ); }
	async removeEntry( name ) { opfsFiles.delete( name ); }
	async * entries() { for ( const name of opfsFiles.keys() ) yield [ name, new TestOPFSFileHandle( name ) ]; }
}

const bytes = makeGlb();
const hash = Buffer.from( await crypto.subtle.digest( 'SHA-256', bytes ) ).toString( 'hex' );
const emptyBytes = makeEmptyGlb();
const emptyHash = Buffer.from( await crypto.subtle.digest( 'SHA-256', emptyBytes ) ).toString( 'hex' );
const externalTextureBytes = Uint8Array.from( { length: 96 }, ( _, index ) => ( index * 7 ) & 0xff );
const externalTextureHash = Buffer.from( await crypto.subtle.digest( 'SHA-256', externalTextureBytes ) ).toString( 'hex' );
const externalTextureAssetID = `sha256:${externalTextureHash}`;
const externalMeshBytes = makeExternalTextureGlb( externalTextureAssetID );
const externalMeshHash = Buffer.from( await crypto.subtle.digest( 'SHA-256', externalMeshBytes ) ).toString( 'hex' );
let serveExternalMesh = false;
const externalTextureRangeRequests = [];
const originalFetch = globalThis.fetch;
const originalNavigator = Object.getOwnPropertyDescriptor( globalThis, 'navigator' );
let cellFetches = 0;
let rangeFetches = 0;
let leaseReleases = 0;
let descriptorWorldId = 'elsemesh:hogwarts-legacy-local';
let descriptorChoices = [ { id: 'gryffindor', label: 'Gryffindor' }, { id: 'hufflepuff', label: 'Hufflepuff' } ];
const payloadFetchOrder = [];
const cellIndexRequests = [];
const cellIndexRequestQueryLengths = [];
const cellInventoryRequests = [];
let secondCellCollisionMissing = true;
let knownEmptyCellCollisionMissing = true;
let includeUnknownPrimitiveCell = false;
let includeSupportedPrimitiveCell = false;
let unresolvedInstancedMeshComponents = 0;
let unindexedSpatialBoundsComponents = 0;
let abortNextCellFetch = false;
let abortableFetchStarted;
let createdRegionLeaseQuery = null;
let requestedRegionMeshLodQuery = null;

async function waitForDiskWriteQueue( connector ) {
	const deadline = Date.now() + 5000;
	while ( connector.pendingDiskWriteBytes > 0 || connector.pendingDiskWriteEntries.length > 0 || connector.diskWriteFlushTimer !== null ) {
		if ( Date.now() >= deadline ) throw new Error( 'Browser disk-cache writes did not drain before the test deadline' );
		await new Promise( resolve => setTimeout( resolve, 1 ) );
	}
}

const staticVisualInstance = {
	componentPath: '/Game/GreatHall/SM_Table.Component0',
	staticMeshPath: '/Game/GreatHall/SM_Table',
	isSplineMesh: false,
	instanceIndex: null,
	instanceTransformCount: 1,
	transform: { position: [ 8, 1, 8 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] },
	boundsMeters: { min: [ 7, 0, 7 ], max: [ 9, 2, 9 ] },
};
const staticMeshLODs = [
	{ index: 0, usable: true, screenSize: 0.1794, vertices: 2440, triangles: 2440 },
	{ index: 1, usable: true, screenSize: 0.05985, vertices: 976, triangles: 610 },
	{ index: 2, usable: true, screenSize: 0.02498, vertices: 120, triangles: 76 },
];
globalThis.fetch = async ( input, options = {} ) => {
	const url = new URL( input );
	if ( url.pathname === '/v1/regions/great-hall/leases' && options.method === 'POST' ) {
		createdRegionLeaseQuery = new URLSearchParams( url.searchParams );
		return Response.json( { leaseId: 'a'.repeat( 32 ), expiresInSeconds: 30 } );
	}
	if ( url.pathname === `/v1/leases/${ 'a'.repeat( 32 ) }` && options.method === 'DELETE' ) {
		leaseReleases++;
		return new Response( null, { status: 204 } );
	}
	if ( url.pathname === '/v1/regions/great-hall' && ( options.method === undefined || options.method === 'GET' ) && url.searchParams.has( 'lease' ) ) {
		if ( url.searchParams.has( 'mesh' ) ) {
			requestedRegionMeshLodQuery = new URLSearchParams( url.searchParams );
		}
		else payloadFetchOrder.push( url.searchParams.get( 'payload' ) );
	}
	if ( url.pathname === '/v1/descriptor' ) return Response.json( {
		schema: 'elsemesh.dynamic-region-provider/1', worldId: descriptorWorldId, title: 'Hogwarts Legacy',
		sourceRevision: 'test-revision', cacheRevision: 'test-revision:converter-1', readOnly: true, regions: '/v1/regions',
		entrySelection: {
			schema: 'elsemesh.world-entry-selection/1', entryPointActionLabel: 'Choose your house',
			entryPointPrompt: 'Which Hogwarts house will you join?',
			previewSpawn: { position: [ 1, 8.62, 9 ], yaw: 0, pitch: - 0.1 },
			previewRegion: { cellSizeMeters: 16, maxViewDistanceMeters: 32 },
			previewSupport: { status: 'provisional', position: [ 0, 6.75, 8 ], halfExtents: [ 2, 0.25, 3 ], basis: 'synthetic rendered floor bounds' },
			choices: descriptorChoices,
		},
	} );
	if ( url.pathname === '/v1/regions' ) return Response.json( { regions: [ { id: 'great-hall', label: 'Great Hall', asset: '/v1/regions/great-hall' } ] } );
	if ( url.pathname === '/v1/regions/great-hall/cells' ) {
		cellIndexRequests.push( url.searchParams.getAll( 'cell' ) );
		cellIndexRequestQueryLengths.push( url.search.slice( 1 ).length );
		cellInventoryRequests.push( url.searchParams.get( 'sourceInventory' ) );
		return Response.json( {
			sourceRevision: 'test-revision', cellSizeMeters: Number( url.searchParams.get( 'size' ) ), collisionSourceInventory: url.searchParams.get( 'sourceInventory' ) === '0' ? null : { staticMeshComponents: 3, otherPrimitiveComponents: Number( includeUnknownPrimitiveCell ) + Number( includeSupportedPrimitiveCell ), unclassifiedOtherPrimitiveComponents: Number( includeUnknownPrimitiveCell ) + Number( includeSupportedPrimitiveCell ), explicitlyNonQueryOtherPrimitiveComponents: 0, explicitlyNonBlockingForPawnOtherPrimitiveComponents: 0, userVerifiedNonBlockingForPawnOtherPrimitiveComponents: 0, audioOnlyPolicyExcludedOtherPrimitiveComponents: 0, noSkeletalCollisionGeometryComponents: 0, unindexedOtherPrimitiveComponents: 0, unindexedSpatialBoundsComponents, unindexedSpatialBoundsFailures: unindexedSpatialBoundsComponents ? [ { objectPath: '/test/oversized-volume', reason: 'bounds exceed index limit' } ] : [], unindexedSpatialBoundsFailuresTruncated: false, landscapeHeightfieldCollisionComponents: 0, unresolvedInstancedMeshComponents, otherPrimitiveStatuses: includeUnknownPrimitiveCell || includeSupportedPrimitiveCell ? { 'BoxComponent/query-collidable-unconverted': Number( includeUnknownPrimitiveCell ) + Number( includeSupportedPrimitiveCell ) } : {} }, cells: [
			{ x: 0, y: 0, z: 0, collisionEvidence: { scope: 'all-collision-sources', staticMeshComponentCount: 1, supportedSimpleShapeComponents: 1, explicitlyNonQueryCollidableComponents: 0, explicitlyNonBlockingForPawnComponents: 0, unknownComponents: 0, staticMeshComponentsClassified: true, otherPrimitiveComponentCount: 0, supportedOtherPrimitiveComponents: 0, unknownOtherPrimitiveComponents: 0 }, unknownCollisionSources: [], visualInstances: [ staticVisualInstance ], meshLods: [ { staticMeshPath: '/Game/GreatHall/SM_Table', lods: staticMeshLODs } ] },
			{ x: 1, y: 0, z: 0, collisionEvidence: { scope: 'incomplete-collision-source-index', staticMeshComponentCount: 1, supportedSimpleShapeComponents: 0, explicitlyNonQueryCollidableComponents: 0, explicitlyNonBlockingForPawnComponents: 0, unknownComponents: 1, staticMeshComponentsClassified: false, otherPrimitiveComponentCount: 0, supportedOtherPrimitiveComponents: 0, unknownOtherPrimitiveComponents: 0 }, unknownCollisionSources: [ { objectPath: '/test/unknown', instanceIndex: null, status: 'unknown', bounds: [ 8, 0, 0, 9, 1, 1 ] } ] },
			{ x: 2, y: 0, z: 0, collisionEvidence: { scope: 'all-collision-sources', staticMeshComponentCount: 1, supportedSimpleShapeComponents: 0, explicitlyNonQueryCollidableComponents: 1, explicitlyNonBlockingForPawnComponents: 0, unknownComponents: 0, staticMeshComponentsClassified: true, otherPrimitiveComponentCount: 0, supportedOtherPrimitiveComponents: 0, unknownOtherPrimitiveComponents: 0 }, unknownCollisionSources: [] },
			...( includeUnknownPrimitiveCell ? [ { x: 3, y: 0, z: 0, collisionEvidence: { scope: 'all-collision-sources', staticMeshComponentCount: 0, supportedSimpleShapeComponents: 0, explicitlyNonQueryCollidableComponents: 0, explicitlyNonBlockingForPawnComponents: 0, unknownComponents: 0, staticMeshComponentsClassified: true, otherPrimitiveComponentCount: 1, supportedOtherPrimitiveComponents: 0, unknownOtherPrimitiveComponents: 1 }, unknownCollisionSources: [ { objectPath: '/test/unknown-primitive', instanceIndex: null, status: 'unknown', bounds: [ 49, 0, 0, 50, 1, 1 ] } ] } ] : [] ),
			...( includeSupportedPrimitiveCell ? [ { x: 4, y: 0, z: 0, collisionEvidence: { scope: 'all-collision-sources', staticMeshComponentCount: 0, supportedSimpleShapeComponents: 0, explicitlyNonQueryCollidableComponents: 0, explicitlyNonBlockingForPawnComponents: 0, unknownComponents: 0, staticMeshComponentsClassified: true, otherPrimitiveComponentCount: 1, supportedOtherPrimitiveComponents: 1, unknownOtherPrimitiveComponents: 0 }, unknownCollisionSources: [] } ] : [] ),
		].filter( cell => url.searchParams.getAll( 'cell' ).includes( `${cell.x},${cell.y},${cell.z}` ) ),
		} );
	}
	if ( url.pathname === '/v1/regions/great-hall' && url.searchParams.has( 'lease' ) && options.headers?.Range ) {
		const rangeHeader = new Headers( options.headers ).get( 'Range' );
		const ranges = rangeHeader.match( /^bytes=(\d+-\d+(?:,\d+-\d+)*)$/ )?.[ 1 ].split( ',' ).map( value => value.split( '-' ).map( Number ) );
		assert.ok( ranges?.length, 'range requests use closed byte ranges' );
		if ( url.searchParams.has( 'texture' ) ) {
			assert.equal( url.searchParams.get( 'texture' ), externalTextureAssetID, 'external KTX2 range requests use the content hash declared by the mesh GLB' );
			externalTextureRangeRequests.push( new URLSearchParams( url.searchParams ) );
			const [ start, requestedEnd ] = ranges[ 0 ], end = Math.min( requestedEnd, externalTextureBytes.byteLength - 1 );
			const body = externalTextureBytes.slice( start, end + 1 );
			return new Response( body, { status: 206, headers: {
				'Content-Length': String( body.byteLength ), 'Content-Range': `bytes ${start}-${end}/${externalTextureBytes.byteLength}`,
				'Accept-Ranges': 'bytes', ETag: `"sha256-${externalTextureHash}"`,
			} } );
		}
		rangeFetches++;
		if ( ranges.length === 1 ) {
			const [ start, requestedEnd ] = ranges[ 0 ], end = Math.min( requestedEnd, bytes.byteLength - 1 );
			const body = bytes.slice( start, end + 1 );
			return new Response( body, { status: 206, headers: {
				'Content-Length': String( body.byteLength ), 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
				'Accept-Ranges': 'bytes', ETag: `"sha256-${hash}"`,
			} } );
		}
		const boundary = 'elsemesh-test-range';
		const parts = [];
		for ( const [ start, requestedEnd ] of ranges ) {
			const end = Math.min( requestedEnd, bytes.byteLength - 1 );
			parts.push( `--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes ${start}-${end}/${bytes.byteLength}\r\n\r\n` );
			parts.push( bytes.slice( start, end + 1 ) );
			parts.push( '\r\n' );
		}
		parts.push( `--${boundary}--\r\n` );
		return new Response( new Blob( parts ), { status: 206, headers: {
			'Content-Type': `multipart/byteranges; boundary=${boundary}`, 'Accept-Ranges': 'bytes', ETag: `"sha256-${hash}"`,
		} } );
	}
	if ( url.pathname === '/v1/regions/great-hall' && url.searchParams.get( 'cell' ) === '0,0,0,16' && url.searchParams.get( 'lease' ) === 'a'.repeat( 32 ) ) {
		if ( ! url.searchParams.has( 'mesh' ) ) cellFetches++;
		if ( abortNextCellFetch ) {
			abortNextCellFetch = false;
			abortableFetchStarted();
			return new Promise( ( resolve, reject ) => options.signal.addEventListener( 'abort', () => reject( options.signal.reason ), { once: true } ) );
		}
		const body = serveExternalMesh && url.searchParams.has( 'mesh' ) ? externalMeshBytes : bytes;
		const bodyHash = serveExternalMesh && url.searchParams.has( 'mesh' ) ? externalMeshHash : hash;
		return new Response( body, { headers: {
			'Content-Length': String( body.byteLength ), ETag: `"sha256-${bodyHash}"`,
		} } );
	}
	if ( url.pathname === '/v1/regions/great-hall' && url.searchParams.get( 'cell' ) === '1,0,0,16' && url.searchParams.get( 'payload' ) === 'collision' && url.searchParams.get( 'lease' ) === 'a'.repeat( 32 ) ) {
		if ( secondCellCollisionMissing ) return new Response( 'not found', { status: 404 } );
		return new Response( bytes, { headers: {
			'Content-Length': String( bytes.byteLength ), ETag: `"sha256-${hash}"`,
		} } );
	}
	if ( url.pathname === '/v1/regions/great-hall' && url.searchParams.get( 'cell' ) === '2,0,0,16' && url.searchParams.get( 'payload' ) === 'collision' && url.searchParams.get( 'lease' ) === 'a'.repeat( 32 ) ) {
		if ( knownEmptyCellCollisionMissing ) return new Response( 'not found', { status: 404 } );
		return new Response( emptyBytes, { headers: {
			'Content-Length': String( emptyBytes.byteLength ), ETag: `"sha256-${emptyHash}"`,
		} } );
	}
	if ( url.pathname === '/v1/regions/great-hall' && url.searchParams.has( 'cell' ) && url.searchParams.has( 'lease' ) ) return new Response( bytes, { headers: { 'Content-Length': String( bytes.byteLength ), ETag: `"sha256-${hash}"` } } );
	return new Response( 'not found', { status: 404 } );
};

try {
	const link = worldLinkFromLocation( {
		search: '?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall',
		href: 'http://127.0.0.1:5189/?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall',
	} );
	assert.deepEqual( link, { localProvider: 'http://127.0.0.1:4179', localMap: 'Great Hall', regionDiagnostics: false } );
	const localPage = 'http://127.0.0.1:5189/?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall';
	assert.equal( await discoverLocalWorldURL( { pageURL: localPage, fetchImpl: () => { throw new Error( 'must not query the default world for a local bridge link' ); } } ), null );
	assert.equal( defaultHomeWorldURL( { pageURL: localPage, storage: { getItem: () => '{"worldId":"elsemesh:example-island"}' } } ), null );
	assert.throws( () => worldLinkFromLocation( {
		search: '?localProvider=http%3A%2F%2Fexample.com&localMap=Great%20Hall',
		href: 'http://127.0.0.1:5189/',
	} ), /loopback/ );
	assert.throws( () => worldLinkFromLocation( {
		search: '?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall&worldId=elsemesh%3Atidewater',
		href: 'http://127.0.0.1:5189/',
	} ), /cannot be combined/ );
	const invalidIDConnector = new LocalRegionConnector( link );
	assert.equal( invalidIDConnector.assetCacheBudgetBytes + invalidIDConnector.assetRangeCacheBudgetBytes, 128 * 1024 * 1024, 'browsers without a reported RAM hint use the conservative default cache budget' );
	const visualPriorityConnector = new LocalRegionConnector( link );
	visualPriorityConnector.manifest = {
		assets: [ 'near-prop', 'far-wall', 'collision' ].map( id => ( { id, kind: 'application/json' } ) ),
		objects: [
			{ id: 'near-prop-object', assetId: 'near-prop', regionCell: true, streamingBounds: { center: [ 2, 0, 0 ], radius: 0 } },
			{ id: 'far-wall-object', assetId: 'far-wall', regionCell: true, streamingBounds: { center: [ 0, 0, 20 ], radius: 0 } },
			{ id: 'collision-object', assetId: 'collision', regionCell: true, streamingBounds: { center: [ 1, 0, 0 ], radius: 0 } },
		],
		components: [],
	};
	visualPriorityConnector.collisionAssetIDs.add( 'collision' );
	const visualPriorityFetches = [];
	visualPriorityConnector.getAsset = async id => { visualPriorityFetches.push( id ); return new Uint8Array( [ 1 ] ); };
	await visualPriorityConnector.preload( {
		assetIDs: [ 'near-prop', 'far-wall', 'collision' ], position: [ 0, 0, 0 ],
		viewPriorityByAsset: new Map( [ [ 'near-prop', 0.05 ], [ 'far-wall', 0.4 ] ] ),
	} );
	assert.deepEqual( visualPriorityFetches, [ 'collision', 'far-wall', 'near-prop' ], 'collision remains first, then larger on-screen content can outrank a closer prop' );
	await assert.rejects( visualPriorityConnector.preload( { assetIDs: [], viewPriorityByAsset: new Map( [ [ 'invalid', Number.NaN ] ] ) } ), /priority map is invalid/ );
	for ( const worldId of [ 'world:legacy', 'elsemesh-world:legacy', 'em-world:legacy' ] ) {
		descriptorWorldId = worldId;
		await assert.rejects( invalidIDConnector.getManifest(), /unsupported descriptor/, `dynamic world providers must reject ${worldId}` );
	}
	descriptorWorldId = 'elsemesh:hogwarts-legacy-local';

	const connector = new LocalRegionConnector( link );
	const manifest = await connector.getManifest();
	assert.equal( connector.sourceRevision, 'test-revision', 'source-derived texture IDs retain the game content revision' );
	assert.equal( connector.cacheRevision, 'test-revision:converter-1', 'browser disk cache uses the provider conversion revision separately' );
	assert.equal( cellInventoryRequests[ 0 ], '1', 'the first bounded cell-index batch requests the global collision inventory' );
	assert.ok( cellInventoryRequests.slice( 1 ).every( value => value === '0' ), 'later cell-index batches omit the already received global inventory' );
	assert.equal( manifest.components.length, 1, 'complete provider placements and LOD profiles publish a static-model instance-set component' );
	const staticSet = manifest.components[ 0 ];
	assert.equal( staticSet.type, 'elsemesh.static-model-instance-set/1' );
	assert.equal( staticSet.assets.length, 4, 'the component declares one descriptor and three independently addressable mesh LODs' );
	assert.equal( manifest.rules.requiredFeatures.includes( 'elsemesh.static-model-instance-set/1' ), true );
	const setDescriptorID = staticSet.assets[ 0 ].assetId;
	const descriptorBytes = await connector.getAsset( setDescriptorID );
	const descriptor = JSON.parse( new TextDecoder().decode( descriptorBytes ) );
	assert.deepEqual( descriptor.models[ 0 ].lodThresholds, [ 0.05985, 0.1794 ], 'the provider descriptor retains authored coarse-to-fine thresholds' );
	const priorDiskCache = connector.diskCache;
	let storedDescriptor = new TextEncoder().encode( JSON.stringify( { ...descriptor, instances: descriptor.instances.map( ( { placementId, ...instance } ) => instance ) } ) );
	let generatedDescriptors = 0;
	const originalDescriptorLoader = connector.syntheticAssetLoaders.get( setDescriptorID );
	connector.syntheticAssetLoaders.set( setDescriptorID, async signal => { generatedDescriptors ++; return originalDescriptorLoader( signal ); } );
	connector.diskCache = {
		get: async id => id === setDescriptorID ? storedDescriptor : null,
		touch: async () => {},
		putMany: async entries => { for ( const entry of entries ) if ( entry.assetId === setDescriptorID ) storedDescriptor = entry.bytes; return true; },
	};
	connector.releaseAsset( setDescriptorID );
	const refreshedDescriptor = await connector.getAsset( setDescriptorID );
	assert.equal( generatedDescriptors, 1, 'a cached descriptor without placement IDs is regenerated' );
	assert.ok( JSON.parse( new TextDecoder().decode( refreshedDescriptor ) ).instances.every( instance => instance.placementId ) );
	await waitForDiskWriteQueue( connector );
	connector.releaseAsset( setDescriptorID );
	assert.deepEqual( await connector.getAsset( setDescriptorID ), refreshedDescriptor );
	assert.equal( generatedDescriptors, 1, 'a valid regenerated descriptor is reused from disk' );
	connector.diskCache = priorDiskCache;
	const meshLodAssetID = staticSet.assets[ 1 ].assetId;
	const meshLodURL = new URL( connector.regionAssets.get( meshLodAssetID ) );
	assert.equal( meshLodURL.searchParams.get( 'mesh' ), staticVisualInstance.componentPath );
	assert.equal( meshLodURL.searchParams.get( 'lod' ), '2', 'the initial asset is the coarsest usable source LOD' );
	createdRegionLeaseQuery = null;
	assert.deepEqual( await connector.getAsset( meshLodAssetID ), bytes, 'a standalone mesh LOD is fetched as a provider asset' );
	assert.equal( createdRegionLeaseQuery?.get( 'mesh' ), staticVisualInstance.componentPath, 'the region lease is scoped to the requested static-mesh component' );
	assert.equal( createdRegionLeaseQuery?.get( 'lod' ), '2', 'the region lease is scoped to the requested authored LOD' );
	assert.equal( requestedRegionMeshLodQuery?.get( 'mesh' ), createdRegionLeaseQuery?.get( 'mesh' ), 'the leased region request keeps the component path from its lease key' );
	assert.equal( requestedRegionMeshLodQuery?.get( 'lod' ), createdRegionLeaseQuery?.get( 'lod' ), 'the leased region request keeps the authored LOD from its lease key' );
	assert.equal( leaseReleases, 1, 'a fetched standalone mesh LOD releases its temporary visitor lease' );
	connector.releaseAsset( meshLodAssetID );
	const externalTextureConnector = new LocalRegionConnector( link );
	const externalTextureManifest = await externalTextureConnector.getManifest();
	const externalMeshAssetID = externalTextureManifest.components[ 0 ].assets.find( reference => reference.kind === 'glb' ).assetId;
	serveExternalMesh = true;
	assert.deepEqual( await externalTextureConnector.getAsset( externalMeshAssetID ), externalMeshBytes, 'the mesh GLB is loaded before registering its external KTX2 asset' );
	const externalTextureRange = await externalTextureConnector.getAssetRange( externalTextureAssetID, {
		start: 0, end: 31, etag: `"sha256-${externalTextureHash}"`, totalLength: externalTextureBytes.byteLength,
	} );
	assert.deepEqual( externalTextureRange.bytes, externalTextureBytes.slice( 0, 32 ), 'an independently addressed texture range is fetched after the GLB declares it' );
	assert.equal( externalTextureRangeRequests.length, 1, 'the connector sends the texture hash on a parent mesh and LOD lease URL' );
	assert.equal( externalTextureRangeRequests[ 0 ].get( 'mesh' ), createdRegionLeaseQuery?.get( 'mesh' ), 'the texture byte-range request remains bounded by the declared mesh LOD lease' );
	assert.equal( externalTextureRangeRequests[ 0 ].get( 'lod' ), createdRegionLeaseQuery?.get( 'lod' ), 'the texture byte-range request remains bounded by the declared LOD lease' );
	serveExternalMesh = false;
	externalTextureConnector.close();
	leaseReleases = 0;
	assert.ok( cellIndexRequests.length > 0 && cellIndexRequests.every( cells => cells.length > 0 && cells.length <= 512 ), 'startup and view cells use bounded coordinate requests' );
	assert.ok( cellIndexRequestQueryLengths.every( length => length <= 4096 ), 'cell index URLs fit worldd dynamic-provider query limit' );
	await connector.ensureCellsForView( [ 1, 0, 1 ], [ 100, 0, 1 ] );
	assert.ok( connector.knownCells.has( '6,0,0' ), 'the projected movement frontier is queried before its cell can be entered' );
	assert.ok( cellIndexRequests.every( cells => cells.length <= 512 ) && cellIndexRequestQueryLengths.every( length => length <= 4096 ), 'movement-frontier batches remain within provider count and URL limits' );
	cellIndexRequests.length = 0;
	cellIndexRequestQueryLengths.length = 0;
	const largeCellQuery = Array.from( { length: 513 }, ( _, index ) => [ index + 1000, 0, 0 ] );
	await connector.ensureCells( largeCellQuery );
	assert.ok( cellIndexRequests.length >= 2 && cellIndexRequests.reduce( ( total, cells ) => total + cells.length, 0 ) === 513 && cellIndexRequests.every( cells => cells.length <= 512 ) && cellIndexRequestQueryLengths.every( length => length <= 4096 ), 'large cell queries split by encoded URL size without dropping cells' );
	assert.equal( connector.knownCells.has( '1512,0,0' ), true, 'the last cell in a multi-batch query is recorded' );
	assert.equal( manifest.title, 'Hogwarts Legacy · Great Hall' );
	assert.deepEqual( manifest.spawn.position, [ 1, 8.62, 9 ] );
	assert.equal( manifest.entryPointActionLabel, 'Choose your house' );
	assert.equal( manifest.entryPointPrompt, 'Which Hogwarts house will you join?' );
	assert.deepEqual( manifest.entryPoints.map( entry => entry.id ), [ 'gryffindor', 'hufflepuff' ] );
	assert.equal( manifest.rules.physicsProfile, 'default' );
	assert.equal( 'seaLevel' in manifest.rules, false, 'local Hogwarts preview does not activate a default waterline' );
	assert.equal( manifest.assets.length, 9, 'the complete Great Hall cell replaces its visual GLB with independently addressable mesh LOD assets' );
	assert.equal( manifest.objects.length, 6, 'the instance-set cell has no duplicate whole-cell visual GLB object' );
	assert.equal( manifest.assets[ 0 ].id, 'local-region:great-hall:16:0,0,0:collision' );
	assert.equal( manifest.objects[ 0 ].assetId, manifest.assets[ 0 ].id );
	assert.equal( manifest.objects[ 0 ].regionCell, true );
	assert.equal( manifest.objects[ 0 ].collisionPayload, true );
	assert.equal( connector.initialRegionCellObjectIDs.has( manifest.objects[ 0 ].id ), true, 'startup preloads collision objects before visuals' );
	assert.equal( connector.initialRegionCellObjectIDs.size, 1, 'only indexed cells in the authored startup footprint are preloaded' );
	assert.equal( manifest.objects.some( object => object.id.endsWith( '-1,0,0:collision' ) ), false, 'empty startup cells do not create synthetic collision assets' );
	assert.equal( connector.emptyCollisionCellsAreVerified, true, 'complete source inventory verifies absent spatial cells as empty' );
	assert.deepEqual( manifest.objects[ 0 ].streamingBounds.center, [ 8, 8, 8 ] );
	const previewSupport = manifest.objects.find( object => object.id === 'elsemesh-object:region-preview-floor-support' );
	assert.equal( previewSupport.assetId, null );
	assert.equal( previewSupport.collision.enabled, true );
	const loaded = await connector.preload();
	assert.equal( loaded.get( manifest.assets[ 0 ].id ).byteLength, bytes.byteLength );
	assert.equal( parseGLB( loaded.get( manifest.assets[ 0 ].id ) ).nodes[ 0 ].extras.elsemeshCollision.coordinateSystem, 'elsemesh-y-up-meters/1', 'collision-only GLB metadata is readable by the ElseMesh loader' );
	const emptyCollisionAssetID = manifest.objects.find( object => object.id.endsWith( '2,0,0:collision' ) ).assetId;
	assert.deepEqual( parseGLB( loaded.get( emptyCollisionAssetID ) ).nodes, [], 'missing collision bytes remain representable to the package loader' );
	assert.equal( loaded.has( meshLodAssetID ), false, 'component startup loads only its descriptor and leaves all geometry variants lazy' );
	assert.deepEqual( payloadFetchOrder.slice( 0, 3 ), [ 'collision', 'collision', 'collision' ], 'collision requests must be fetched before visual requests' );
	assert( payloadFetchOrder.slice( 3 ).every( payload => payload === 'visual' ), 'range-based visual requests follow collision priority' );
	assert.equal( connector.assetBytes, [ ...connector.assets.values() ].reduce( ( sum, value ) => sum + value.byteLength, 0 ), 'unknown collision placeholders are not cached as provider data' );
	assert.equal( leaseReleases, payloadFetchOrder.length, 'each full or ranged fetch should release its temporary visitor lease' );
	const collisionIDs = [ ...connector.collisionObjectIDsByCell.get( '0,0,0' ), ...connector.collisionObjectIDsByCell.get( '1,0,0' ) ];
	const emptyCollisionID = [ ...connector.collisionObjectIDsByCell.get( '2,0,0' ) ][ 0 ];
	assert.equal( connector.isCollisionPathReady( [ 1, 0, 1 ], [ 2, 0, 1 ], { loadedObjects: new Set( [ collisionIDs[ 0 ] ] ) } ), true, 'loaded collision with complete source coverage permits a local path' );
	const originalConsoleInfo = console.info;
	let movementDiagnostic;
	connector.regionDiagnostics = true;
	console.info = ( ...args ) => { if ( args[ 0 ] === 'ElseMesh local-region movement gate:' ) movementDiagnostic = args; };
	try {
		assert.equal( connector.isCollisionPathReady( [ 1, 0, 1 ], [ 2, 0, 1 ], { loadedObjects: new Set( [ collisionIDs[ 0 ] ] ) } ), true, 'collision diagnostics preserve a ready path' );
	} finally {
		console.info = originalConsoleInfo;
		connector.regionDiagnostics = false;
	}
	assert.deepEqual( JSON.parse( movementDiagnostic[ 1 ] ).from, [ 1, 0, 1 ], 'movement diagnostics serialize array positions without requiring private helpers' );
	assert.equal( connector.isCollisionPathReady( [ 49, 0, 1 ], [ 50, 0, 1 ], { loadedObjects: new Set() } ), true, 'a path through a cell absent from every complete layer remains open' );
	assert.equal( connector.isCollisionPathReady( [ 15, 0, 1 ], [ 17, 0, 1 ], { loadedObjects: new Set( [ collisionIDs[ 0 ] ] ) } ), false, 'movement stops until collision data for every crossed cell has loaded' );
	assert.equal( connector.isCollisionPathReady( [ 15, 0, 1 ], [ 17, 0, 1 ], { loadedObjects: new Set( collisionIDs ) } ), false, 'a missing collision response remains unknown and blocks the swept path even if the loader has an empty placeholder' );
	secondCellCollisionMissing = false;
	const secondCellCollisionAssetID = manifest.assets.find( asset => asset.id === 'local-region:great-hall:16:1,0,0:collision' ).id;
	await connector.getAsset( secondCellCollisionAssetID );
	assert.equal( connector.isCollisionPathReady( [ 15, 0, 1 ], [ 17, 0, 1 ], { loadedObjects: new Set( collisionIDs ) } ), false, 'a shape-bearing response cannot clear source coverage that the provider marked unknown' );
	const emptyCellCollisionAsset = manifest.assets.find( asset => asset.id === 'local-region:great-hall:16:2,0,0:collision' );
	assert.ok( emptyCellCollisionAsset );
	assert.equal( connector.isCollisionPathReady( [ 33, 0, 1 ], [ 34, 0, 1 ], { loadedObjects: new Set( [ emptyCollisionID ] ) } ), false, 'an absent payload remains unknown even when index evidence predicts a collision-empty cell' );
	knownEmptyCellCollisionMissing = false;
	const emptyCollisionPayload = await connector.getAsset( emptyCellCollisionAsset.id );
	assert.deepEqual( parseGLB( emptyCollisionPayload ).nodes, [] );
	assert.equal( connector.isCollisionPathReady( [ 33, 0, 1 ], [ 34, 0, 1 ], { loadedObjects: new Set( [ emptyCollisionID ] ) } ), true, 'a valid empty payload plus complete all-source evidence proves the cell has no blocking collision' );
	assert.equal( connector.releaseAsset( manifest.assets[ 0 ].id ), true );
	assert.equal( connector.assetBytes, [ ...connector.assets.values() ].reduce( ( sum, value ) => sum + value.byteLength, 0 ), 'unloaded cells should release cached browser bytes' );
	const cellFetchesBeforeReleasedCellRefetch = cellFetches;
	assert.equal( await connector.getAsset( manifest.assets[ 0 ].id ).then( value => value.byteLength ), bytes.byteLength );
	assert.equal( cellFetches, cellFetchesBeforeReleasedCellRefetch + 1, 'a released cell should be fetched again on demand' );
	assert.equal( leaseReleases, payloadFetchOrder.length, 'collision retries and a refetched cell should release their leases' );
	connector.releaseAsset( manifest.assets[ 0 ].id );
	abortNextCellFetch = true;
	const requestStarted = new Promise( resolve => { abortableFetchStarted = resolve; } );
	const abortController = new AbortController();
	const abortedRequest = connector.getAsset( manifest.assets[ 0 ].id, { signal: abortController.signal } );
	await requestStarted;
	abortController.abort();
	await assert.rejects( abortedRequest, { name: 'AbortError' } );
	assert.equal( leaseReleases, payloadFetchOrder.length, 'aborting a visitor fetch should release its server lease' );
	const retainedAssetId = manifest.assets[ 0 ].id;
	const streamedAssetId = manifest.assets[ 1 ].id;
	connector.releaseAsset( retainedAssetId );
	connector.releaseAsset( streamedAssetId );
	const streamedAssetIDs = [];
	const retainedAssets = await connector.preload( {
		assetIDs: new Set( [ retainedAssetId, streamedAssetId ] ), retainAssets: false,
		retainAssetIDs: new Set( [ retainedAssetId ] ),
		onAsset: async assetId => streamedAssetIDs.push( assetId ),
	} );
	assert.deepEqual( streamedAssetIDs, [ retainedAssetId, streamedAssetId ], 'streamed asset callback receives collision then visual payloads' );
	assert.deepEqual( [ ...retainedAssets.keys() ], [ retainedAssetId ], 'only explicitly retained asset IDs stay in the returned preload map' );
	assert.equal( connector.assets.has( retainedAssetId ), true, 'retained component data remains cached for installation' );
	assert.equal( connector.assets.has( streamedAssetId ), false, 'streamed visuals release their browser byte cache after processing' );
	connector.close();
	assert.equal( connector.assets.size, 0 );
	includeUnknownPrimitiveCell = true;
	const primitiveCoverageConnector = new LocalRegionConnector( link );
	const primitiveCoverageManifest = await primitiveCoverageConnector.getManifest();
	const unknownPrimitiveCollisionID = [ ...primitiveCoverageConnector.collisionObjectIDsByCell.get( '3,0,0' ) ][ 0 ];
	assert.equal( primitiveCoverageConnector.emptyCollisionCellsAreVerified, true, 'bounded unclassified primitives preserve coverage for absent cells elsewhere' );
	const unknownPrimitiveCollisionAsset = primitiveCoverageManifest.assets.find( asset => asset.id === 'local-region:great-hall:16:3,0,0:collision' );
	await primitiveCoverageConnector.getAsset( unknownPrimitiveCollisionAsset.id );
	assert.equal( primitiveCoverageConnector.isCollisionPathReady( [ 49, 0, 1 ], [ 50, 0, 1 ], { loadedObjects: new Set( [ unknownPrimitiveCollisionID ] ) } ), false, 'a bounded but unconverted primitive blocks only its indexed cell' );
	assert.equal( primitiveCoverageConnector.isCollisionPathReady( [ 65, 0, 1 ], [ 66, 0, 1 ], { loadedObjects: new Set() } ), true, 'a bounded unknown primitive does not block unrelated verified empty cells' );
	primitiveCoverageConnector.close();
	includeUnknownPrimitiveCell = false;
	includeSupportedPrimitiveCell = true;
	const supportedPrimitiveConnector = new LocalRegionConnector( link );
	await supportedPrimitiveConnector.getManifest();
	const supportedPrimitiveCollisionID = [ ...supportedPrimitiveConnector.collisionObjectIDsByCell.get( '4,0,0' ) ][ 0 ];
	const supportedPrimitiveCollisionAsset = supportedPrimitiveConnector.manifest.assets.find( asset => asset.id === 'local-region:great-hall:16:4,0,0:collision' );
	await supportedPrimitiveConnector.getAsset( supportedPrimitiveCollisionAsset.id );
	assert.equal( supportedPrimitiveConnector.isCollisionPathReady( [ 65, 0, 1 ], [ 66, 0, 1 ], { loadedObjects: new Set( [ supportedPrimitiveCollisionID ] ) } ), true, 'a query-enabled Pawn-blocking primitive with converted geometry permits movement after its collision cell loads' );
	supportedPrimitiveConnector.close();
	includeSupportedPrimitiveCell = false;
	unresolvedInstancedMeshComponents = 1;
	const incompleteCoverageConnector = new LocalRegionConnector( link );
	await incompleteCoverageConnector.getManifest();
	assert.equal( incompleteCoverageConnector.emptyCollisionCellsAreVerified, false, 'unresolved instance bounds prevent treating absent cells as empty' );
	assert.equal( incompleteCoverageConnector.isCollisionPathReady( [ 49, 0, 1 ], [ 50, 0, 1 ], { loadedObjects: new Set() } ), false, 'absent cells remain blocked when the source inventory is incomplete' );
	incompleteCoverageConnector.close();
	unresolvedInstancedMeshComponents = 0;
	unindexedSpatialBoundsComponents = 1;
	const unindexedBoundsConnector = new LocalRegionConnector( link );
	await unindexedBoundsConnector.getManifest();
	assert.equal( unindexedBoundsConnector.emptyCollisionCellsAreVerified, false, 'unindexable broad bounds keep absent cells unverified' );
	assert.equal( unindexedBoundsConnector.isCollisionPathReady( [ 65, 0, 1 ], [ 66, 0, 1 ], { loadedObjects: new Set() } ), false, 'unindexable source bounds keep movement fail-closed across the layer' );
	unindexedBoundsConnector.close();
	unindexedSpatialBoundsComponents = 0;
	descriptorChoices = [];
	const singleSpawnConnector = new LocalRegionConnector( link );
	const singleSpawnManifest = await singleSpawnConnector.getManifest();
	assert.deepEqual( singleSpawnManifest.entryPoints, [], 'a world may temporarily disable optional entry-point choices' );
	assert.equal( await chooseWorldEntryPoint( singleSpawnManifest, { documentRef: null } ), null, 'no choices means entry directly at the world spawn without opening a prompt' );
	singleSpawnConnector.close();
	Object.defineProperty( globalThis, 'navigator', { configurable: true, value: { deviceMemory: 2, storage: {
		getDirectory: async () => new TestOPFSDirectoryHandle(),
		estimate: async () => ( { quota: 4 * 1024 ** 3, usage: [ ...opfsFiles.values() ].reduce( ( total, value ) => total + value.byteLength, 0 ) } ),
	} } } );
	const diskCacheConnector = new LocalRegionConnector( link );
	assert.equal( diskCacheConnector.assetCacheBudgetBytes + diskCacheConnector.assetRangeCacheBudgetBytes, 128 * 1024 * 1024, 'the encoded RAM cache scales down on a low-memory device hint' );
	const diskCacheManifest = await diskCacheConnector.getManifest();
	const visualAssetID = diskCacheManifest.assets.find( asset => asset.id === 'local-region:great-hall:16:0,0,0:collision' ).id;
	const providerFetchesBeforeDiskCache = cellFetches;
	assert.deepEqual( await diskCacheConnector.getAsset( visualAssetID ), bytes );
	assert.equal( cellFetches, providerFetchesBeforeDiskCache + 1, 'first request gets bytes from the local provider' );
	await waitForDiskWriteQueue( diskCacheConnector );
	assert.equal( diskCacheConnector.releaseAsset( visualAssetID ), true, 'unloading evicts the response from browser RAM' );
	assert.equal( diskCacheConnector.assets.has( visualAssetID ), false, 'unloaded response is no longer held in the connector memory cache' );
	assert.deepEqual( await diskCacheConnector.getAsset( visualAssetID ), bytes, 'the unloaded response is promoted back from the persistent browser disk cache' );
	assert.equal( cellFetches, providerFetchesBeforeDiskCache + 1, 'demotion to disk avoids another provider request' );
	let memoryHitDiskTouches = 0;
	const touchDiskCache = diskCacheConnector.diskCache.touch.bind( diskCacheConnector.diskCache );
	diskCacheConnector.diskCache.touch = async assetID => { memoryHitDiskTouches ++; return touchDiskCache( assetID ); };
	await diskCacheConnector.getAsset( visualAssetID );
	assert.equal( memoryHitDiskTouches, 1, 'a browser RAM hit refreshes the matching disk LRU recency' );
	diskCacheConnector.close();
	const diskCacheReloadedConnector = new LocalRegionConnector( link );
	const diskCacheReloadedManifest = await diskCacheReloadedConnector.getManifest();
	const reloadedVisualAssetID = diskCacheReloadedManifest.assets.find( asset => asset.id === visualAssetID ).id;
	assert.deepEqual( await diskCacheReloadedConnector.getAsset( reloadedVisualAssetID ), bytes );
	assert.equal( cellFetches, providerFetchesBeforeDiskCache + 1, 'a new connector reuses the persistent cache without a provider request' );
	diskCacheReloadedConnector.close();
	const rangeCacheConnector = new LocalRegionConnector( link );
	const rangeCacheManifest = await rangeCacheConnector.getManifest();
	const rangeAssetID = rangeCacheManifest.components[ 0 ].assets.find( reference => reference.kind === 'glb' ).assetId;
	const rangeRequest = { start: 0, end: 31, etag: `"sha256-${hash}"`, totalLength: bytes.byteLength };
	const rangeFetchesBefore = rangeFetches;
	const firstRange = await rangeCacheConnector.getAssetRange( rangeAssetID, rangeRequest );
	assert.deepEqual( firstRange.bytes, bytes.slice( 0, 32 ) );
	assert.equal( firstRange.totalLength, bytes.byteLength );
	assert.equal( rangeFetches, rangeFetchesBefore + 1, 'an uncached level range is fetched on demand' );
	assert.deepEqual( ( await rangeCacheConnector.getAssetRange( rangeAssetID, rangeRequest ) ).bytes, firstRange.bytes );
	assert.equal( rangeFetches, rangeFetchesBefore + 1, 'a requested level range is reused from the browser RAM LRU' );
	const multiRanges = [ { start: 0, end: 11 }, { start: 20, end: 27 } ];
	const multiRangeFetchesBefore = rangeFetches;
	const multiRangeResult = await rangeCacheConnector.getAssetRanges( rangeAssetID, multiRanges, { etag: rangeRequest.etag, totalLength: bytes.byteLength } );
	assert.deepEqual( multiRangeResult.map( range => range.bytes ), multiRanges.map( range => bytes.slice( range.start, range.end + 1 ) ) );
	assert.equal( rangeFetches, multiRangeFetchesBefore + 1, 'disjoint ranges share one leased multipart request' );
	await rangeCacheConnector.getAssetRanges( rangeAssetID, multiRanges, { etag: rangeRequest.etag, totalLength: bytes.byteLength } );
	assert.equal( rangeFetches, multiRangeFetchesBefore + 1, 'multipart ranges are independently reused from browser RAM' );
	await waitForDiskWriteQueue( rangeCacheConnector );
	rangeCacheConnector.close();
	const rangeDiskReloadedConnector = new LocalRegionConnector( link );
	const rangeDiskReloadedManifest = await rangeDiskReloadedConnector.getManifest();
	const rangeDiskAssetID = rangeDiskReloadedManifest.components[ 0 ].assets.find( reference => reference.kind === 'glb' ).assetId;
	assert.deepEqual( ( await rangeDiskReloadedConnector.getAssetRange( rangeDiskAssetID, rangeRequest ) ).bytes, firstRange.bytes );
	assert.equal( rangeFetches, multiRangeFetchesBefore + 1, 'a requested level range is reused from OPFS after connector restart' );
	assert.deepEqual( ( await rangeDiskReloadedConnector.getAssetRanges( rangeDiskAssetID, multiRanges, { etag: rangeRequest.etag, totalLength: bytes.byteLength } ) ).map( range => range.bytes ), multiRangeResult.map( range => range.bytes ) );
	assert.equal( rangeFetches, multiRangeFetchesBefore + 1, 'multipart level ranges are independently reused from OPFS after connector restart' );
	rangeDiskReloadedConnector.close();
	console.log( 'local region connector tests passed' );
} finally {
	globalThis.fetch = originalFetch;
	if ( originalNavigator ) Object.defineProperty( globalThis, 'navigator', originalNavigator );
	else delete globalThis.navigator;
}
