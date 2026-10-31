import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assetConcurrencyForConnection, WorldConnector } from '../src/network/WorldConnector.js';
import { isVegetationWorldComponent, selectWorldComponentsForView, selectWorldObjectsForView } from '../src/network/WorldStreaming.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
await import( '../worlds/tidewater/register-components.js' );

const connector = new WorldConnector( { worldId: 'elsemesh:stream-test', nodeId: '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ', gateway: 'https://example.test' } );
const alreadyAborted = new AbortController();
alreadyAborted.abort( new DOMException( 'Portal is no longer in view', 'AbortError' ) );
await assert.rejects( connector.preparePortal( { enabled: true, destinationWorldId: 'elsemesh:destination' }, { signal: alreadyAborted.signal } ), { name: 'AbortError' }, 'a world-ID portal honors cancellation before provider discovery starts' );
const priorities = [ 'portal-preview', 'visible', 'nearby', 'background' ];
assert.equal( assetConcurrencyForConnection( null ), 3, 'unknown connection capability keeps the default bounded concurrency' );
assert.equal( assetConcurrencyForConnection( { effectiveType: '4g', downlink: 12 } ), 3, 'fast links keep three parallel asset downloads' );
assert.equal( assetConcurrencyForConnection( { effectiveType: '3g', downlink: 2 } ), 2, 'moderate links limit parallel downloads' );
assert.equal( assetConcurrencyForConnection( { effectiveType: '2g', downlink: 0.4 } ), 1, 'slow links serialize asset downloads' );
assert.equal( assetConcurrencyForConnection( { effectiveType: '4g', downlink: 20, saveData: true } ), 1, 'the browser data-saver preference takes precedence over link speed' );
assert.equal( assetConcurrencyForConnection( null, 200 * 1024 ), 1, 'measured slow transfer rate reduces concurrency without browser hints' );
assert.equal( assetConcurrencyForConnection( null, 2 * 1024 * 1024 ), 2, 'measured moderate transfer rate selects two concurrent downloads' );
assert.equal( assetConcurrencyForConnection( null, 8 * 1024 * 1024 ), 3, 'measured fast transfer rate restores the three-request cap' );
connector.manifest = { assets: priorities.flatMap( ( priority, index ) => [ { id: `sha256:${String( index * 2 + 1 ).padStart( 64, '0' )}`, priority }, { id: `sha256:${String( index * 2 + 2 ).padStart( 64, '0' )}`, priority } ] ) };
const requested = [];
let active = 0, maxActive = 0;
connector.getAsset = async ( id ) => {
	active ++;
	maxActive = Math.max( maxActive, active );
	requested.push( id );
	await new Promise( ( resolve ) => setTimeout( resolve, 1 ) );
	active --;
	return new Uint8Array( [ 1 ] );
};

const visible = await connector.preload( { through: 'visible', concurrency: 3 } );
assert.equal( visible.size, 4, 'initial load includes preview and visible tiers only' );
assert.deepEqual( requested.map( ( id ) => connector.manifest.assets.find( ( asset ) => asset.id === id ).priority ), [ 'portal-preview', 'portal-preview', 'visible', 'visible' ], 'lower-priority tiers wait for higher-priority assets' );
assert.ok( maxActive <= 3 && maxActive > 1, 'same-tier requests run concurrently with the configured bound' );

requested.length = 0;
await connector.preload( { through: 'background', assetIDs: new Set( [ connector.manifest.assets[ 6 ].id ] ) } );
assert.deepEqual( requested, [ connector.manifest.assets[ 6 ].id ], 'view-driven asset selection can request one asset without fetching unrelated tiers' );

const getAssetMock = connector.getAsset;
connector.getAsset = ( id, { signal } ) => new Promise( ( resolve, reject ) => signal.addEventListener( 'abort', () => reject( signal.reason ), { once: true } ) );
const abortController = new AbortController();
const abortedPreload = connector.preload( { assetIDs: [ connector.manifest.assets[ 0 ].id ], signal: abortController.signal } );
abortController.abort( new DOMException( 'View changed', 'AbortError' ) );
await assert.rejects( abortedPreload, { name: 'AbortError' }, 'view changes can cancel pending asset requests' );
connector.getAsset = getAssetMock;

requested.length = 0;
const remainder = await connector.preload( { after: 'visible', concurrency: 2 } );
assert.equal( remainder.size, 4, 'background load contains nearby and background tiers only' );
assert.deepEqual( requested.map( ( id ) => connector.manifest.assets.find( ( asset ) => asset.id === id ).priority ), [ 'nearby', 'nearby', 'background', 'background' ], 'remainder tiers preserve priority order' );

requested.length = 0;
maxActive = 0;
connector.transferRateBytesPerSecond = 200 * 1024;
await connector.preload( { after: 'visible' } );
assert.equal( maxActive, 1, 'measured throughput controls the next preload batch concurrency' );
requested.length = 0;
maxActive = 0;
connector.transferRateBytesPerSecond = 2 * 1024 * 1024;
await connector.preload( { assetIDs: [ connector.manifest.assets[ 4 ].id, connector.manifest.assets[ 5 ].id ] } );
assert.equal( maxActive, 2, 'moderate measured throughput permits two parallel downloads in a same-priority batch' );

const camera = new PerspectiveCamera( 60, 1, 0.1, 100 );
camera.position.set( 0, 0, 0 ); camera.lookAt( 0, 0, -1 ); camera.updateMatrixWorld( true );
const objects = [
	{ id: 'front', assetId: 'front', priority: 'visible', transform: { position: [ 0, 0, -10 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 1 } },
	{ id: 'behind', assetId: 'behind', priority: 'visible', transform: { position: [ 0, 0, 10 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 1 } },
	{ id: 'side', assetId: 'side', priority: 'visible', transform: { position: [ 20, 0, -10 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 1 } },
	{ id: 'distance-capped', assetId: 'distance-capped', priority: 'visible', transform: { position: [ 0, 0, -40 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 1, maxDistanceMeters: 20 } },
	{ id: 'near', assetId: 'near', priority: 'nearby', transform: { position: [ 0, 0, 3 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 0.5 } },
	{ id: 'legacy', assetId: 'legacy', priority: 'background', transform: { position: [ 0, 0, 10 ], yaw: 0 }, scale: [ 1, 1, 1 ] },
	{ id: 'preview-only', assetId: 'preview-only', priority: 'portal-preview', transform: { position: [ 0, 0, -8 ], yaw: 0 }, scale: [ 1, 1, 1 ] },
	{ id: 'preview-placeholder', assetId: 'preview-placeholder', priority: 'portal-preview', transform: { position: [ 0, 0, -8 ], yaw: 0 }, scale: [ 1, 1, 1 ] },
	{ id: 'full-detail', assetId: 'full-detail', priority: 'visible', replacesObjectId: 'preview-placeholder', transform: { position: [ 0, 0, -8 ], yaw: 0 }, scale: [ 1, 1, 1 ] },
];
const viewIDs = selectWorldObjectsForView( { assets: [], objects }, camera, { nearbyDistance: 5 } ).map( ( object ) => object.id );
assert.deepEqual( viewIDs, [ 'preview-only', 'front', 'full-detail', 'near', 'legacy' ], 'active worlds load standalone portal-preview content, skip replaceable preview placeholders, include in-view visible content, and preserve legacy unbounded objects' );
const startupViewIDs = selectWorldObjectsForView( { assets: [], objects }, camera, { nearbyDistance: 5, maxPriority: 'nearby' } ).map( ( object ) => object.id );
assert.deepEqual( startupViewIDs, [ 'preview-only', 'front', 'full-detail', 'near' ], 'startup selection excludes unbounded background objects while retaining immediate visible and nearby content' );
const components = [
	{ id: 'elsemesh-component:front', type: 'elsemesh.static-vegetation/1', assets: [ { assetId: 'front', kind: 'vegetation-placement/1' } ], priority: 'visible', streamingBounds: { center: [ 0, 0, -10 ], radius: 1 } },
	{ id: 'elsemesh-component:behind', type: 'elsemesh.static-vegetation/1', assets: [ { assetId: 'behind', kind: 'vegetation-placement/1' } ], priority: 'nearby', streamingBounds: { center: [ 0, 0, 10 ], radius: 1 } },
	{ id: 'elsemesh-component:near', type: 'elsemesh.static-vegetation/1', assets: [ { assetId: 'near', kind: 'vegetation-placement/1' } ], priority: 'nearby', streamingBounds: { center: [ 0, 0, 3 ], radius: 0.5 } },
	{ id: 'elsemesh-component:distance-capped', type: 'elsemesh.static-vegetation/1', assets: [ { assetId: 'distance-capped', kind: 'vegetation-placement/1' } ], priority: 'visible', streamingBounds: { center: [ 0, 0, -40 ], radius: 1, maxDistanceMeters: 20 } },
	{ id: 'elsemesh-component:legacy', type: 'elsemesh.island-ocean/1', priority: 'portal-preview' },
	{ id: 'elsemesh-component:ambience', type: 'elsemesh.ambient-audio/1', assets: [ { assetId: 'ambient-loop', kind: 'audio/ogg' } ] },
	{ id: 'elsemesh-component:whale', type: 'elsemesh.humpback-whale/1', assets: [ { assetId: 'whale-model', kind: 'model/gltf-binary' } ], streamingBounds: { center: [ 0, 0, -10 ], radius: 1 } },
];
const componentIDs = selectWorldComponentsForView( { assets: [ { id: 'ambient-loop', priority: 'portal-preview' }, { id: 'whale-model', priority: 'nearby' } ], components }, camera, { nearbyDistance: 5 } ).map( ( component ) => component.id );
assert.deepEqual( componentIDs, [ 'elsemesh-component:legacy', 'elsemesh-component:ambience', 'elsemesh-component:front', 'elsemesh-component:near', 'elsemesh-component:whale' ], 'component selection uses world-space bounds and uses the whale manifest asset priority when the component has none' );
assert.equal( isVegetationWorldComponent( components[ 0 ] ), true, 'vegetation filtering reads the package registered capability instead of component type names' );
const startupComponentIDs = selectWorldComponentsForView( { assets: [ { id: 'ambient-loop', priority: 'portal-preview' }, { id: 'whale-model', priority: 'nearby' } ], components }, camera, { nearbyDistance: 5, maxPriority: 'nearby' } ).map( ( component ) => component.id );
assert.deepEqual( startupComponentIDs, [ 'elsemesh-component:legacy', 'elsemesh-component:ambience', 'elsemesh-component:front', 'elsemesh-component:near', 'elsemesh-component:whale' ], 'startup component selection excludes records above the entry priority while retaining required visible and nearby systems' );

const originalWebTransport = globalThis.WebTransport;
const originalWebSocket = globalThis.WebSocket;
const bytes = new Uint8Array( [ 11, 22, 33, 44, 55, 66 ] );
const assetId = `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const webTransportRequests = [];
const webSocketRequests = [];
let transportMode = 'interrupted-chunk';
let releaseSharedChunk;
const jsonReadable = ( value ) => new ReadableStream( { start( controller ) { controller.enqueue( new TextEncoder().encode( JSON.stringify( value ) ) ); controller.close(); } } );
let transportStream = 0;
class FakeWebTransport {
	static instances = [];
	constructor() { this.state = 'connected'; this.ready = transportMode === 'blocked-ready' ? new Promise( () => {} ) : Promise.resolve(); this.closed = new Promise( () => {} ); FakeWebTransport.instances.push( this ); }
	close() { this.state = 'closed'; }
	async createBidirectionalStream() {
		const index = transportStream ++;
		let written = '';
		let readableController;
		const readable = new ReadableStream( { start( controller ) { readableController = controller; } } );
		const writable = new WritableStream( { write( chunk ) { written += new TextDecoder().decode( chunk ); }, async close() {
			const request = JSON.parse( written );
			if ( index > 0 ) webTransportRequests.push( request );
			if ( index === 1 && transportMode === 'blocked-manifest' ) return;
			if ( index === 1 && transportMode === 'shared-download' ) await new Promise( ( resolve ) => { releaseSharedChunk = resolve; } );
			if ( index === 2 && transportMode === 'interrupted-chunk' ) readableController.error( new Error( 'stream reset' ) );
			else if ( index === 0 ) readableController.enqueue( new TextEncoder().encode( JSON.stringify( { type: 'connected', worldId: request.worldId } ) ) );
			else if ( index === 1 && transportMode === 'gateway-error' ) readableController.enqueue( new TextEncoder().encode( JSON.stringify( { type: 'error', requestId: request.requestId, error: 'asset is not available' } ) ) );
			else {
				const chunk = bytes.slice( request.offset, request.offset + request.length );
				const response = { type: 'asset.chunk', requestId: request.requestId, assetId, offset: request.offset, total: bytes.length, chunk: btoa( String.fromCharCode( ...chunk ) ) };
				readableController.enqueue( new TextEncoder().encode( JSON.stringify( response ) ) );
			}
			if ( index !== 2 || transportMode !== 'interrupted-chunk' ) readableController.close();
		} } );
		return { writable, readable };
	}
}
class FakeWebSocket {
	static OPEN = 1;
	static instances = [];
	constructor() { this.readyState = FakeWebSocket.OPEN; this.listeners = new Map(); FakeWebSocket.instances.push( this ); if ( transportMode !== 'blocked-socket-connect' ) queueMicrotask( () => this.#dispatch( 'open' ) ); }
	addEventListener( type, callback ) { const listeners = this.listeners.get( type ) || []; listeners.push( callback ); this.listeners.set( type, listeners ); }
	send( message ) {
		const request = JSON.parse( message );
		if ( request.type === 'connect' ) { queueMicrotask( () => this.#dispatch( 'message', { data: JSON.stringify( { type: 'connected', worldId: request.worldId } ) } ) ); return; }
		webSocketRequests.push( request );
		const chunk = bytes.slice( request.offset, request.offset + request.length );
		queueMicrotask( () => this.#dispatch( 'message', { data: JSON.stringify( { type: 'asset.chunk', requestId: request.requestId, assetId, offset: request.offset, total: bytes.length, chunk: btoa( String.fromCharCode( ...chunk ) ) } ) } ) );
	}
	close() { this.readyState = 3; this.#dispatch( 'close' ); }
	#dispatch( type, event = {} ) { for ( const callback of this.listeners.get( type ) || [] ) callback( event ); }
}
try {
	globalThis.WebTransport = FakeWebTransport;
	globalThis.WebSocket = FakeWebSocket;
	const retryConnector = new WorldConnector( { worldId: 'elsemesh:retry-test', nodeId: '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ', gateway: 'https://example.test', chunkBytes: 3 } );
	retryConnector.manifest = { assets: [ { id: assetId, bytes: bytes.length } ] };
	const downloaded = await retryConnector.getAsset( assetId );
	assert.deepEqual( downloaded, bytes, 'interrupted WebTransport asset chunks recover over WebSocket' );
	assert.deepEqual( webTransportRequests.filter( ( request ) => request.type === 'asset.get' ).map( ( request ) => request.offset ), [ 0, 3 ], 'WebTransport delivered the first chunk before failing on the second' );
	assert.deepEqual( webSocketRequests.map( ( request ) => request.offset ), [ 3 ], 'WebSocket retries only the interrupted chunk' );
	assert.equal( webSocketRequests[ 0 ].requestId, webTransportRequests[ 1 ].requestId, 'transport fallback preserves the original idempotent request id' );
	retryConnector.close();
	transportStream = 0;
	webTransportRequests.length = 0;
	transportMode = 'shared-download';
	const sharedConnector = new WorldConnector( { worldId: 'elsemesh:retry-test', nodeId: '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ', gateway: 'https://example.test', chunkBytes: 3 } );
	sharedConnector.manifest = { assets: [ { id: assetId, bytes: bytes.length } ] };
	const firstCallerAbort = new AbortController();
	const firstCaller = sharedConnector.getAsset( assetId, { signal: firstCallerAbort.signal } );
	const secondCaller = sharedConnector.getAsset( assetId );
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	assert.equal( webTransportRequests.filter( ( request ) => request.type === 'asset.get' ).length, 1, 'overlapping consumers share one in-flight asset request' );
	firstCallerAbort.abort( new DOMException( 'View changed', 'AbortError' ) );
	await assert.rejects( firstCaller, { name: 'AbortError' }, 'a canceled consumer stops waiting for the shared asset' );
	releaseSharedChunk();
	assert.deepEqual( await secondCaller, bytes, 'remaining consumers keep the shared transfer alive to completion' );
	assert.equal( webTransportRequests.filter( ( request ) => request.type === 'asset.get' ).length, 2, 'the shared transfer requests each asset chunk once' );
	assert.equal( webSocketRequests.length, 1, 'a remaining consumer completes over the shared WebTransport session' );
	sharedConnector.close();
	transportStream = 0;
	transportMode = 'gateway-error';
	const requestCount = webSocketRequests.length;
	const errorConnector = new WorldConnector( { worldId: 'elsemesh:retry-test', nodeId: '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ', gateway: 'https://example.test', chunkBytes: 3 } );
	errorConnector.manifest = { assets: [ { id: assetId, bytes: bytes.length } ] };
	await assert.rejects( errorConnector.getAsset( assetId ), /asset is not available/, 'a gateway error response remains an application error' );
	assert.equal( webSocketRequests.length, requestCount, 'gateway errors do not trigger transport fallback' );
	errorConnector.close();
	transportStream = 0;
	transportMode = 'blocked-manifest';
	const portalConnector = new WorldConnector( { worldId: 'elsemesh:retry-test', nodeId: '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ', gateway: 'https://example.test' } );
	const portalAbort = new AbortController();
	const portalPreparation = portalConnector.preparePortal( { enabled: true, destinationWorldId: 'elsemesh:pending', destinationPeerId: '12D3KooW12345678901234567890' }, { signal: portalAbort.signal } );
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
	assert.ok( webTransportRequests.some( ( request ) => request.type === 'manifest.get' ), 'portal begins the destination manifest request before cancellation' );
	const destinationTransport = FakeWebTransport.instances.at( -1 );
	portalAbort.abort( new DOMException( 'Portal left view', 'AbortError' ) );
	await assert.rejects( portalPreparation, { name: 'AbortError' }, 'portal preparation rejects when its manifest request is canceled' );
	assert.equal( destinationTransport.state, 'closed', 'canceling portal preparation closes its destination transport' );
	portalConnector.close();
	transportStream = 0;
	transportMode = 'blocked-ready';
	const readyConnector = new WorldConnector( { worldId: 'elsemesh:retry-test', nodeId: '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ', gateway: 'https://example.test' } );
	const readyAbort = new AbortController();
	const readyPreparation = readyConnector.preparePortal( { enabled: true, destinationWorldId: 'elsemesh:waiting', destinationPeerId: '12D3KooW12345678901234567890' }, { signal: readyAbort.signal } );
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	const waitingTransport = FakeWebTransport.instances.at( -1 );
	readyAbort.abort( new DOMException( 'Portal left view', 'AbortError' ) );
	await assert.rejects( readyPreparation, { name: 'AbortError' }, 'portal preparation aborts during WebTransport setup' );
	assert.equal( waitingTransport.state, 'closed', 'canceling WebTransport setup closes the pending session' );
	readyConnector.close();
	delete globalThis.WebTransport;
	transportMode = 'blocked-socket-connect';
	const socketConnector = new WorldConnector( { worldId: 'elsemesh:retry-test', nodeId: '12D3KooW9fPds2JtYVx5aY6kWqRg9m9M1P2Q3R4S5T6U7V8W9XYZ', gateway: 'https://example.test' } );
	const socketAbort = new AbortController();
	const socketPreparation = socketConnector.preparePortal( { enabled: true, destinationWorldId: 'elsemesh:socket-wait', destinationPeerId: '12D3KooW1234567890123456' }, { signal: socketAbort.signal } );
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	const pendingSocket = FakeWebSocket.instances.at( -1 );
	socketAbort.abort( new DOMException( 'Portal left view', 'AbortError' ) );
	await assert.rejects( socketPreparation, { name: 'AbortError' }, 'portal preparation aborts during WebSocket setup' );
	assert.equal( pendingSocket.readyState, 3, 'canceling WebSocket setup closes the pending socket' );
	socketConnector.close();
} finally {
	if ( originalWebTransport === undefined ) delete globalThis.WebTransport; else globalThis.WebTransport = originalWebTransport;
	if ( originalWebSocket === undefined ) delete globalThis.WebSocket; else globalThis.WebSocket = originalWebSocket;
}
console.log( 'ok   view-driven streaming priorities and interrupted WebTransport recovery' );
