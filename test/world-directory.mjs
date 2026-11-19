import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { WorldConnector } from '../src/network/WorldConnector.js';

globalThis.crypto ||= webcrypto;

function canonical( value ) {
	if ( Array.isArray( value ) ) return `[${value.map( canonical ).join( ',' )}]`;
	if ( value && typeof value === 'object' ) return `{${Object.keys( value ).sort().map( ( key ) => `${JSON.stringify( key )}:${canonical( value[ key ] )}` ).join( ',' )}}`;
	return JSON.stringify( value );
}

function base58( bytes ) {
	const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	let value = 0n;
	for ( const byte of bytes ) value = value * 256n + BigInt( byte );
	let encoded = '';
	while ( value > 0n ) { encoded = alphabet[ Number( value % 58n ) ] + encoded; value /= 58n; }
	for ( const byte of bytes ) { if ( byte !== 0 ) break; encoded = `1${encoded}`; }
	return encoded;
}

async function identity() {
	const pair = await crypto.subtle.generateKey( { name: 'Ed25519' }, true, [ 'sign', 'verify' ] );
	const raw = new Uint8Array( await crypto.subtle.exportKey( 'raw', pair.publicKey ) );
	const protobuf = Uint8Array.from( [ 8, 1, 18, 32, ...raw ] );
	const peerHash = Uint8Array.from( [ 0, protobuf.length, ...protobuf ] );
	return { pair, protobuf, peerId: base58( peerHash ) };
}

async function signedDocument( protocol, payload, id ) {
	const unsigned = { protocol, signer: id.peerId, publicKey: Buffer.from( id.protobuf ).toString( 'base64' ), payload };
	const signature = new Uint8Array( await crypto.subtle.sign( 'Ed25519', id.pair.privateKey, new TextEncoder().encode( canonical( unsigned ) ) ) );
	return { ...unsigned, signature: Buffer.from( signature ).toString( 'base64' ) };
}

function emit( socket, type, data ) {
	const event = new Event( type );
	Object.defineProperty( event, 'data', { value: data } );
	socket.dispatchEvent( event );
}

const first = await identity();
const second = await identity();
const third = await identity();
const now = Math.floor( Date.now() / 1000 );
const grantEpoch = 4;
const failoverAfter = now - 30;
const failoverSeconds = 120;
const expiresAt = now + 3600;
const providers = [];
for ( const [ id, gateway ] of [ [ first, 'https://offline.example' ], [ second, 'https://online.example' ], [ third, 'https://cache.example' ] ] ) {
	providers.push( await signedDocument( 'elsemesh.node/1', {
		protocol: 'elsemesh.node/1', nodeId: id.peerId, gateway,
		worldIds: [ 'elsemesh:directory-test' ], issuedAt: now, expiresAt: now + 3600,
	}, id ) );
}
const zeroTierProvider = await signedDocument( 'elsemesh.node/1', {
	protocol: 'elsemesh.node/1', nodeId: second.peerId, gateway: 'https://online.example',
	worldIds: [ 'elsemesh:directory-test' ], zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
	zeroTierGateway: 'http://10.147.20.4:43127', issuedAt: now, expiresAt: now + 600,
}, second );
const assetBytes = new Map( [ [ 'mesh', new Uint8Array( [ 17, 29, 43, 61 ] ) ], [ 'texture', new Uint8Array( [ 5, 11, 23, 47, 89 ] ) ] ] );
const assetIDs = new Map();
for ( const [ name, bytes ] of assetBytes ) assetIDs.set( name, `sha256:${Buffer.from( await crypto.subtle.digest( 'SHA-256', bytes ) ).toString( 'hex' )}` );
let manifest = await signedDocument( 'elsemesh.world/3', {
	protocol: 'elsemesh.world/3', worldId: 'elsemesh:directory-test', ownerPeerId: second.peerId,
	authorityPeerId: second.peerId, authorityEpoch: 1, version: 1, discoverable: true,
	title: 'Directory test', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 8, avatarComplexity: 1000, physicsProfile: 'elsemesh-default' },
	assets: [ ...assetBytes ].map( ( [ name, bytes ] ) => ( { id: assetIDs.get( name ), bytes: bytes.length, priority: 'visible' } ) ), objects: [], portals: [], hosts: [
		{ peerId: first.peerId, scopes: [ 'failover-authority' ], expiresAt, epoch: grantEpoch, failoverAfter, failoverSeconds },
		{ peerId: third.peerId, scopes: [ 'content-cache' ], expiresAt, epoch: 1 },
	], updatedAt: now,
}, second );
const validManifest = manifest;
let authorityLease = await signedDocument( 'elsemesh.authority/2', {
	worldId: 'elsemesh:directory-test', authorityPeerId: first.peerId, epoch: 2, grantEpoch,
	notBefore: failoverAfter, expiresAt: Math.min( expiresAt, failoverAfter + failoverSeconds ),
}, first );
const validAuthorityLease = authorityLease;

const oldFetch = globalThis.fetch;
const OldWebSocket = globalThis.WebSocket;
let staleSecondAssets = new Set();
let failoverProviderReachable = false;
let privateGatewayReachable = true;
let privateGatewayHangs = false;
let directoryProviders = providers;
let zeroTierLookups = 0;
let directNodeRecordRequests = 0;
const directGatewayAttempts = [];
globalThis.fetch = async ( input ) => {
	const url = new URL( input );
	if ( url.pathname === '/.well-known/elsemesh/node' ) { directNodeRecordRequests ++; return { ok: true, json: async () => zeroTierProvider }; }
	if ( url.pathname === '/v1/zerotier/e3918db4832a3056/3af4fd5d50' ) {
		zeroTierLookups ++;
		return { ok: true, json: async () => ( { networkId: 'e3918db4832a3056', nodeId: '3af4fd5d50', worldIds: [ 'elsemesh:directory-test' ], providers: [ zeroTierProvider ] } ) };
	}
	return { ok: true, json: async () => ( { worldId: 'elsemesh:directory-test', providers: directoryProviders } ) };
};
globalThis.WebSocket = class extends EventTarget {
	static OPEN = 1;
	static CONNECTING = 0;
	static CLOSING = 2;
	static CLOSED = 3;
	constructor( url ) {
		super();
		this.url = String( url );
		if ( this.url.includes( '10.147.20.' ) ) directGatewayAttempts.push( this.url );
		this.targetPeerId = '';
		this.readyState = WebSocket.CONNECTING;
		queueMicrotask( () => {
			if ( this.url.includes( '10.147.20.4' ) && privateGatewayHangs ) return;
			if ( this.url.includes( 'offline.example' ) && ! failoverProviderReachable || this.url.includes( '10.147.20.4' ) && ! privateGatewayReachable ) emit( this, 'error' );
			else { this.readyState = WebSocket.OPEN; emit( this, 'open' ); }
		} );
	}
	send( value ) {
		const request = JSON.parse( value );
		if ( request.type === 'connect' ) {
			this.targetPeerId = request.targetPeerId;
			if ( this.url.includes( 'offline.example' ) && ! failoverProviderReachable || this.url.includes( '10.147.20.4' ) && ! privateGatewayReachable || request.targetPeerId === first.peerId && ! failoverProviderReachable ) emit( this, 'message', JSON.stringify( { type: 'error', error: 'world_unreachable' } ) );
			else emit( this, 'message', JSON.stringify( { type: 'connected', worldId: request.worldId } ) );
		}
		else if ( request.type === 'manifest.get' ) emit( this, 'message', JSON.stringify( { type: 'manifest', worldId: request.worldId, requestId: request.requestId, document: manifest, authorityLease } ) );
		else if ( request.type === 'asset.get' && this.targetPeerId === first.peerId ) emit( this, 'message', JSON.stringify( { type: 'error', requestId: request.requestId, code: 'asset_not_found', error: 'failover delegate has no content-cache grant' } ) );
		else if ( request.type === 'asset.get' && this.targetPeerId === second.peerId && staleSecondAssets.has( request.assetId ) ) {
			staleSecondAssets.delete( request.assetId );
			emit( this, 'message', JSON.stringify( { type: 'error', requestId: request.requestId, code: 'asset_not_found', error: 'cached asset is stale' } ) );
		}
		else if ( request.type === 'asset.get' ) {
			const [ name, bytes ] = [ ...assetBytes ].find( ( [ key ] ) => assetIDs.get( key ) === request.assetId );
			const chunk = bytes.slice( request.offset, request.offset + request.length );
			emit( this, 'message', JSON.stringify( { type: 'asset.chunk', requestId: request.requestId, assetId: assetIDs.get( name ), offset: request.offset, total: bytes.length, chunk: Buffer.from( chunk ).toString( 'base64' ) } ) );
		}
	}
	close() { this.readyState = WebSocket.CLOSED; emit( this, 'close' ); }
};

try {
	const connector = new WorldConnector( { worldId: 'elsemesh:directory-test', directory: 'https://thruhold.org' } );
	const loaded = await connector.getManifest();
	assert.equal( loaded.worldId, 'elsemesh:directory-test' );
	assert.equal( connector.nodeId, second.peerId, 'unreachable directory providers should fall through to the next signed gateway' );
	assert.equal( connector.gateway, 'https://online.example' );
	assert.equal( connector.authorityLease.grantEpoch, grantEpoch, 'signed temporary authority lease binds to its owner grant revision' );
	connector.close();
	failoverProviderReachable = true;
	directoryProviders = [ providers[ 1 ], providers[ 0 ], providers[ 2 ] ];
	const recoveredOwner = new WorldConnector( { worldId: 'elsemesh:directory-test', directory: 'https://thruhold.org' } );
	await recoveredOwner.getManifest();
	assert.equal( recoveredOwner.nodeId, second.peerId, 'directory ordering lets a recovered owner reclaim preferred authority over an active delegate' );
	recoveredOwner.close();
	const failoverConnector = new WorldConnector( { worldId: 'elsemesh:directory-test', nodeId: first.peerId, gateway: 'https://offline.example', directory: 'https://thruhold.org' } );
	await failoverConnector.getManifest();
	assert.equal( failoverConnector.nodeId, first.peerId, 'an active failover-only delegate may serve the signed world manifest' );
	assert.equal( failoverConnector.authorityLease.authorityPeerId, first.peerId, 'the browser records the delegate as current authority' );
	assert.deepEqual( await failoverConnector.getAsset( assetIDs.get( 'mesh' ) ), assetBytes.get( 'mesh' ), 'a failover-only gateway falls back to a separate authorized asset provider' );
	assert.equal( failoverConnector.nodeId, second.peerId, 'asset fallback selects the owner after the failover node denies content access' );
	failoverConnector.close();
	failoverProviderReachable = false;
	const invitedReplicas = new WorldConnector( { worldId: 'elsemesh:directory-test', providers: [ { nodeId: first.peerId, gateway: 'https://offline.example' }, { nodeId: second.peerId, gateway: 'https://online.example' } ] } );
	await invitedReplicas.getManifest();
	assert.equal( invitedReplicas.nodeId, second.peerId, 'a shareable invite falls through from an offline desktop node to its independent replica gateway' );
	assert.equal( invitedReplicas.gateway, 'https://online.example' );
	invitedReplicas.close();
	const zeroTierConnector = new WorldConnector( { zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056', directory: 'https://thruhold.org' } );
	const zeroTierManifest = await zeroTierConnector.getManifest();
	assert.equal( zeroTierManifest.worldId, 'elsemesh:directory-test', 'a ZeroTier node locator resolves through its signed provider record to the canonical ThruHold ID' );
	assert.equal( zeroTierConnector.nodeId, second.peerId, 'ZeroTier lookup selects the signed provider gateway and verifies the world manifest' );
	assert.equal( zeroTierConnector.gateway, 'http://10.147.20.4:43127', 'after Worker lookup, the browser tries the signed private gateway before the public gateway' );
	zeroTierConnector.close();
	const zeroTierLookupsBeforePrivate = zeroTierLookups;
	const directZeroTierConnector = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		zeroTierGateway: 'http://10.147.20.4:43127', zeroTierNodeRecord: zeroTierProvider, directory: 'https://thruhold.org',
	} );
	const privateAttemptsBeforePublicRoute = directGatewayAttempts.length;
	await directZeroTierConnector.getManifest();
	assert.equal( directZeroTierConnector.nodeId, second.peerId, 'a direct private gateway reveals a signed node identity bound to the invited ZeroTier ID' );
	assert.equal( directZeroTierConnector.gateway, 'https://online.example', 'a world-ID invite uses its public provider before probing an optional private route' );
	assert.equal( zeroTierLookups, zeroTierLookupsBeforePrivate, 'a working public route does not need a ZeroTier Worker lookup' );
	assert.equal( directGatewayAttempts.length, privateAttemptsBeforePublicRoute, 'a successful public route does not contact the private IP' );
	directZeroTierConnector.close();
	directoryProviders = [];
	const privateFallback = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		zeroTierGateway: 'http://10.147.20.4:43127', zeroTierNodeRecord: zeroTierProvider, directory: 'https://thruhold.org',
	} );
	await privateFallback.getManifest();
	assert.equal( privateFallback.gateway, 'http://10.147.20.4:43127', 'the signed private gateway remains available when public provider discovery has no working route' );
	privateFallback.close();
	assert.throws( () => new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		zeroTierGateway: 'http://10.147.20.4:43127', directory: 'https://thruhold.org',
	} ), /signed node record/, 'direct gateway use requires a signed route record' );
	const unsignedPrivateIPRecord = { ...zeroTierProvider, payload: { ...zeroTierProvider.payload, zeroTierGateway: 'http://10.147.20.99:43127' } };
	const attemptsBeforeTamperedRecord = directGatewayAttempts.length;
	const tamperedPrivateRoute = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		zeroTierGateway: 'http://10.147.20.99:43127', zeroTierNodeRecord: unsignedPrivateIPRecord, directory: 'https://thruhold.org',
	} );
	await tamperedPrivateRoute.getManifest();
	assert.equal( tamperedPrivateRoute.gateway, 'http://10.147.20.4:43127', 'a tampered direct IP is discarded in favor of the signed Worker route' );
	assert.equal( directGatewayAttempts.slice( attemptsBeforeTamperedRecord ).some( url => url.includes( '10.147.20.99' ) ), false, 'changing the private IP without updating its provider signature receives no WebSocket request' );
	tamperedPrivateRoute.close();
	const staleNodeRecord = await signedDocument( 'elsemesh.node/1', {
		...zeroTierProvider.payload, issuedAt: now - 901, expiresAt: now + 600,
	}, second );
	const lookupsBeforeStaleRecord = zeroTierLookups;
	const stalePrivateRoute = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		zeroTierGateway: 'http://10.147.20.4:43127', zeroTierNodeRecord: staleNodeRecord, directory: 'https://thruhold.org',
	} );
	await stalePrivateRoute.getManifest();
	assert.equal( zeroTierLookups, lookupsBeforeStaleRecord + 1, 'a stale invite-bound node record triggers fresh Worker discovery' );
	assert.equal( stalePrivateRoute.gateway, 'http://10.147.20.4:43127', 'fresh Worker data restores the current direct private route' );
	stalePrivateRoute.close();
	directoryProviders = providers;
	const lookupsBeforeWorkerFallback = zeroTierLookups;
	const tailscaleGateway = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		nodeId: second.peerId, gateway: 'https://world-host.tailnet-example.ts.net', directory: 'https://thruhold.org',
	} );
	await tailscaleGateway.getManifest();
	assert.equal( tailscaleGateway.gateway, 'https://world-host.tailnet-example.ts.net', 'a signed explicit HTTPS provider is tried before optional ZeroTier discovery' );
	assert.equal( zeroTierLookups, lookupsBeforeWorkerFallback, 'a working explicit provider avoids ZeroTier lookup' );
	tailscaleGateway.close();
	const directThenResolver = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		nodeId: first.peerId, gateway: 'https://offline.example', directory: 'https://thruhold.org',
	} );
	await directThenResolver.getManifest();
	assert.equal( directThenResolver.nodeId, second.peerId, 'an unreachable invite gateway falls back to the world-ID directory provider' );
	assert.equal( directThenResolver.gateway, 'https://online.example', 'the public provider route is used before any optional private route' );
	assert.equal( zeroTierLookups, lookupsBeforeWorkerFallback, 'a working world-ID lookup does not query the ZeroTier index' );
	directThenResolver.close();
	privateGatewayReachable = false;
	const directThenFallback = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
		nodeId: first.peerId, gateway: 'https://offline.example', directory: 'https://thruhold.org',
	} );
	await directThenFallback.getManifest();
	assert.equal( directThenFallback.nodeId, second.peerId, 'if the private ZeroTier gateway fails, the verified public provider remains available' );
	assert.equal( directThenFallback.gateway, 'https://online.example' );
	assert.equal( zeroTierLookups, lookupsBeforeWorkerFallback, 'a world-ID invite does not depend on ZeroTier resolution for its public route' );
	directThenFallback.close();
	privateGatewayHangs = true;
	const boundedPrivateRoute = new WorldConnector( {
		worldId: 'elsemesh:directory-test', zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056', directory: 'https://thruhold.org',
	} );
	const privateRouteStartedAt = Date.now();
	await boundedPrivateRoute.getManifest();
	assert.ok( Date.now() - privateRouteStartedAt < 7000, 'a non-ZeroTier browser falls through from the bounded private-route probe to its ordinary public gateway' );
	assert.equal( boundedPrivateRoute.gateway, 'https://online.example' );
	boundedPrivateRoute.close();
	privateGatewayHangs = false;
	privateGatewayReachable = true;
	failoverProviderReachable = false;
	authorityLease = await signedDocument( 'elsemesh.authority/2', {
		worldId: 'elsemesh:directory-test', authorityPeerId: first.peerId, epoch: 2, grantEpoch: grantEpoch - 1,
		notBefore: failoverAfter, expiresAt: Math.min( expiresAt, failoverAfter + failoverSeconds ),
	}, first );
	const stale = new WorldConnector( { worldId: 'elsemesh:directory-test', nodeId: second.peerId, gateway: 'https://online.example' } );
	await assert.rejects( stale.getManifest(), /no matching owner grant/, 'browser rejects a validly signed but stale grant epoch' );
	stale.close();
	authorityLease = await signedDocument( 'elsemesh.authority/2', {
		worldId: 'elsemesh:directory-test', authorityPeerId: first.peerId, epoch: 3, grantEpoch,
		notBefore: failoverAfter, expiresAt: Math.min( expiresAt, failoverAfter + failoverSeconds ),
	}, first );
	const skippedEpoch = new WorldConnector( { worldId: 'elsemesh:directory-test', nodeId: second.peerId, gateway: 'https://online.example' } );
	await assert.rejects( skippedEpoch.getManifest(), /Authority lease is not valid/, 'browser requires failover authority to advance exactly one epoch' );
	skippedEpoch.close();
	authorityLease = await signedDocument( 'elsemesh.authority/2', {
		worldId: 'elsemesh:directory-test', authorityPeerId: first.peerId, epoch: Number.MAX_SAFE_INTEGER + 1, grantEpoch,
		notBefore: failoverAfter, expiresAt: Math.min( expiresAt, failoverAfter + failoverSeconds ),
	}, first );
	const unsafeEpoch = new WorldConnector( { worldId: 'elsemesh:directory-test', nodeId: second.peerId, gateway: 'https://online.example' } );
	await assert.rejects( unsafeEpoch.getManifest(), /Authority lease is not valid/, 'browser rejects authority epochs outside JavaScript safe integer range' );
	unsafeEpoch.close();
	authorityLease = validAuthorityLease;
	manifest = await signedDocument( 'elsemesh.world/3', {
		protocol: 'elsemesh.world/3', worldId: 'elsemesh:directory-test', ownerPeerId: second.peerId,
		authorityPeerId: second.peerId, authorityEpoch: Number.MAX_SAFE_INTEGER + 1, version: 1, discoverable: true,
		title: 'Directory test', rules: { gravity: 1, maxVisitors: 12, spawnRadius: 8, avatarComplexity: 1000, physicsProfile: 'elsemesh-default' },
		assets: [], objects: [], portals: [], hosts: [], updatedAt: now,
	}, second );
	const unsafeManifestEpoch = new WorldConnector( { worldId: 'elsemesh:directory-test', nodeId: second.peerId, gateway: 'https://online.example' } );
	await assert.rejects( unsafeManifestEpoch.getManifest(), /Manifest authority epoch/, 'browser rejects a manifest epoch outside safe integer range' );
	unsafeManifestEpoch.close();
	manifest = validManifest;
	globalThis.fetch = async ( input ) => {
		const pathname = new URL( input ).pathname;
		if ( pathname === '/api/lookup' ) return { ok: true, json: async () => ( { worldId: 'elsemesh:directory-test', providers: [ first.peerId, second.peerId, third.peerId ] } ) };
		assert.equal( pathname, '/v1/worlds/elsemesh%3Adirectory-test' );
		return { ok: true, json: async () => ( { providers } ) };
	};
	const dhtFallback = new WorldConnector( { worldId: 'elsemesh:directory-test', gateway: 'https://bootstrap.example' } );
	assert.equal( ( await dhtFallback.getManifest() ).worldId, 'elsemesh:directory-test' );
	assert.equal( dhtFallback.nodeId, second.peerId, 'DHT lookup should fall through from an unreachable cache to another provider without a directory' );
	dhtFallback.close();
	staleSecondAssets = new Set( assetIDs.values() );
	const staleCache = new WorldConnector( { worldId: 'elsemesh:directory-test', directory: 'https://thruhold.org' } );
	await staleCache.getManifest();
	assert.equal( staleCache.nodeId, second.peerId, 'asset recovery starts from the current owner provider' );
	const recovered = await Promise.all( [ ...assetIDs ].map( async ( [ name, assetId ] ) => [ name, await staleCache.getAsset( assetId ) ] ) );
	for ( const [ name, bytes ] of recovered ) assert.deepEqual( bytes, assetBytes.get( name ), `missing ${name} retries from another signed provider and verifies the asset hash` );
	assert.equal( staleCache.nodeId, third.peerId, 'asset recovery moves to a different owner-authorized cache provider' );
	assert.ok( staleCache.unavailableProviders.has( `${second.peerId}\nhttps://online.example` ), 'failed cache providers are excluded for the connector session' );
	staleCache.close();
	console.log( 'ok directory signatures, concurrent stale-cache recovery, and owner-signed manifest verification' );
} finally {
	globalThis.fetch = oldFetch;
	if ( OldWebSocket === undefined ) delete globalThis.WebSocket;
	else globalThis.WebSocket = OldWebSocket;
}
