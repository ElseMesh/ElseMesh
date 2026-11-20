import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleRequest, SignalRoom } from './src/index.js';

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
	const peerId = base58( Uint8Array.from( [ 0, protobuf.length, ...protobuf ] ) );
	return { pair, protobuf, peerId };
}

async function signedDocument( protocol, payload, signer ) {
	const unsigned = { protocol, signer: signer.peerId, publicKey: Buffer.from( signer.protobuf ).toString( 'base64' ), payload };
	const signature = new Uint8Array( await crypto.subtle.sign( 'Ed25519', signer.pair.privateKey, new TextEncoder().encode( canonical( unsigned ) ) ) );
	return { ...unsigned, signature: Buffer.from( signature ).toString( 'base64' ) };
}

class MemoryKV {
	values = new Map();
	async put( key, value ) { this.values.set( key, value ); }
	async get( key ) { return this.values.get( key ) ?? null; }
	async list( { prefix } ) { return { keys: [ ...this.values.keys() ].filter( ( name ) => name.startsWith( prefix ) ).map( ( name ) => ( { name } ) ), list_complete: true }; }
}

const owner = await identity();
const now = Math.floor( Date.now() / 1000 );
const worldId = 'elsemesh:worker-test';
const node = await signedDocument( 'elsemesh.node/1', {
	protocol: 'elsemesh.node/1', nodeId: owner.peerId, gateway: 'https://owner.example',
	worldIds: [ worldId ], zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056', zeroTierGateway: 'http://10.147.20.4:43127',
	issuedAt: now, expiresAt: now + 600,
}, owner );
const manifest = await signedDocument( 'elsemesh.world/1', {
	protocol: 'elsemesh.world/1', worldId, ownerPeerId: owner.peerId, authorityEpoch: 1,
	discoverable: true, hosts: [],
}, owner );
const announcement = { node, manifest };
const env = { PROVIDERS: new MemoryKV() };

const health = await handleRequest( new Request( 'https://resolver.example/healthz' ), env );
assert.equal( health.status, 200 );
assert.deepEqual( await health.json(), { status: 'ok' } );

const published = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( announcement ) } ), env );
assert.equal( published.status, 202 );

const worldLookup = await handleRequest( new Request( `https://resolver.example/v1/worlds/${encodeURIComponent( worldId )}` ), env );
assert.equal( worldLookup.headers.get( 'access-control-allow-origin' ), '*' );
const worldResult = await worldLookup.json();
assert.equal( worldResult.worldId, worldId );
assert.equal( worldResult.providers.length, 1 );
assert.deepEqual( worldResult.providers[ 0 ], node );
assert.equal( worldResult.providers[ 0 ].payload.zeroTierGateway, 'http://10.147.20.4:43127', 'the signed announcement carries its optional private browser gateway' );

const nodeLookup = await handleRequest( new Request( 'https://resolver.example/v1/zerotier/e3918db4832a3056/3af4fd5d50' ), env );
const nodeResult = await nodeLookup.json();
assert.deepEqual( nodeResult.worldIds, [ worldId ] );
assert.deepEqual( nodeResult.providers, [ node ] );

const options = await handleRequest( new Request( 'https://resolver.example/v1/worlds/elsemesh%3Aworker-test', { method: 'OPTIONS' } ), env );
assert.equal( options.status, 204 );
assert.equal( options.headers.get( 'access-control-allow-methods' ), 'GET, OPTIONS' );

const invalid = structuredClone( announcement );
invalid.node.payload.gateway = 'http://insecure.example';
const rejected = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( invalid ) } ), env );
assert.equal( rejected.status, 422, 'the Worker verifies signed node and world documents before indexing' );

const limitedEnv = { PROVIDERS: new MemoryKV(), ANNOUNCEMENT_LIMIT: { limit: async ( { key } ) => ( { success: key !== owner.peerId } ) } };
const limited = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( announcement ) } ), limitedEnv );
assert.equal( limited.status, 429, 'per-provider rate limiting protects repeated KV writes' );

const invalidLocator = await handleRequest( new Request( 'https://resolver.example/v1/zerotier/not-a-network/not-a-node' ), env );
assert.equal( invalidLocator.status, 400 );
const unsupportedNetwork = await handleRequest( new Request( 'https://resolver.example/v1/zerotier/0123456789abcdef/3af4fd5d50' ), env );
assert.equal( unsupportedNetwork.status, 400, 'the configured resolver is limited to the single supported ZeroTier network' );
const unsupportedAnnouncementNode = await signedDocument( 'elsemesh.node/1', { ...node.payload, zeroTierNetworkId: '0123456789abcdef', issuedAt: now, expiresAt: now + 600 }, owner );
const unsupportedAnnouncement = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( { node: unsupportedAnnouncementNode, manifest } ) } ), env );
assert.equal( unsupportedAnnouncement.status, 422, 'announcements for other ZeroTier networks are rejected' );

const rendezvousHost = await identity();
const rendezvousWorldId = 'elsemesh:worker-rendezvous';
const rendezvousNode = await signedDocument( 'elsemesh.node/1', {
	protocol: 'elsemesh.node/1', nodeId: rendezvousHost.peerId, gateway: '', rendezvous: true,
	worldIds: [ rendezvousWorldId ], zeroTierNodeId: '0123456789', zeroTierNetworkId: 'e3918db4832a3056',
	issuedAt: now, expiresAt: now + 600,
}, rendezvousHost );
const rendezvousManifest = await signedDocument( 'elsemesh.world/1', {
	protocol: 'elsemesh.world/1', worldId: rendezvousWorldId, ownerPeerId: owner.peerId, authorityEpoch: 1,
	discoverable: true, hosts: [ { peerId: rendezvousHost.peerId, scopes: [ 'content-cache' ], expiresAt: now + 600, epoch: 1 } ],
}, owner );
const rendezvousPublished = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( { node: rendezvousNode, manifest: rendezvousManifest } ) } ), env );
assert.equal( rendezvousPublished.status, 202, 'a signed rendezvous-only provider can publish without a public gateway' );
const rendezvousLookup = await handleRequest( new Request( 'https://resolver.example/v1/zerotier/e3918db4832a3056/0123456789' ), env );
const rendezvousResult = await rendezvousLookup.json();
assert.equal( rendezvousResult.providers[ 0 ].payload.rendezvous, true );
assert.equal( rendezvousResult.providers[ 0 ].payload.gateway, '' );

const ownerRendezvousWorldId = 'elsemesh:worker-owner-rendezvous';
const ownerRendezvousNode = await signedDocument( 'elsemesh.node/1', {
	protocol: 'elsemesh.node/1', nodeId: owner.peerId, gateway: '', rendezvous: true,
	worldIds: [ ownerRendezvousWorldId ], zeroTierNodeId: 'abcdef1234', zeroTierNetworkId: 'e3918db4832a3056',
	issuedAt: now, expiresAt: now + 600,
}, owner );
const ownerRendezvousManifest = await signedDocument( 'elsemesh.world/1', {
	protocol: 'elsemesh.world/1', worldId: ownerRendezvousWorldId, ownerPeerId: owner.peerId, authorityEpoch: 1,
	discoverable: true,
}, owner );
const ownerRendezvousPublished = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( { node: ownerRendezvousNode, manifest: ownerRendezvousManifest } ) } ), env );
assert.equal( ownerRendezvousPublished.status, 202, 'an owner-hosted rendezvous world may omit its empty host-grant list' );
const ownerRendezvousLookup = await handleRequest( new Request( 'https://resolver.example/v1/zerotier/e3918db4832a3056/abcdef1234' ), env );
assert.deepEqual( ( await ownerRendezvousLookup.json() ).providers, [ ownerRendezvousNode ], 'HostID lookup returns an owner-hosted rendezvous world without delegated hosts' );
const invalidOwnerManifest = await signedDocument( 'elsemesh.world/1', {
	...ownerRendezvousManifest.payload, hosts: null,
}, owner );
const invalidOwnerRendezvous = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( { node: ownerRendezvousNode, manifest: invalidOwnerManifest } ) } ), env );
assert.equal( invalidOwnerRendezvous.status, 422, 'a present but malformed host-grant list remains invalid' );

class FakeSignalSocket {
	constructor( attachment ) { this.attachment = attachment; this.messages = []; this.closed = false; }
	serializeAttachment( attachment ) { this.attachment = structuredClone( attachment ); }
	deserializeAttachment() { return structuredClone( this.attachment ); }
	send( value ) { if ( this.closed ) throw new Error( 'socket is closed' ); this.messages.push( JSON.parse( value ) ); }
	close( code, reason ) { this.closed = true; this.closeReason = { code, reason }; }
}
const signalSockets = [];
let signalAlarm = null;
const signalState = {
	acceptWebSocket( socket ) { signalSockets.push( socket ); },
	getWebSockets() { return signalSockets.filter( ( socket ) => ! socket.closed ); },
	storage: {
		async getAlarm() { return signalAlarm; },
		async setAlarm( at ) { signalAlarm = at; },
		async deleteAlarm() { signalAlarm = null; },
	},
};
const signalRoom = new SignalRoom( signalState, env );
const hostSocket = new FakeSignalSocket( { role: 'pending', networkId: 'e3918db4832a3056', nodeId: '0123456789', worldId: rendezvousWorldId } );
signalSockets.push( hostSocket );
const refreshedRendezvousNode = await signedDocument( 'elsemesh.node/1', {
	...rendezvousNode.payload, issuedAt: now + 1, expiresAt: now + 601,
}, rendezvousHost );
assert.notEqual( refreshedRendezvousNode.signature, rendezvousNode.signature, 'fresh signed node records rotate their signature as timestamps change' );
await signalRoom.webSocketMessage( hostSocket, JSON.stringify( { type: 'host.open', node: refreshedRendezvousNode } ) );
const challenge = hostSocket.messages.at( -1 );
assert.equal( challenge.type, 'host.challenge' );
const hostProof = await signedDocument( 'elsemesh.signal-proof/1', {
	nonce: challenge.nonce, worldId: rendezvousWorldId, networkId: challenge.networkId,
	zeroTierNodeId: challenge.zeroTierNodeId, iceServers: [],
}, rendezvousHost );
await signalRoom.webSocketMessage( hostSocket, JSON.stringify( { type: 'host.proof', document: hostProof } ) );
assert.equal( hostSocket.deserializeAttachment().role, 'host', `the host must answer the one-use signed challenge (${JSON.stringify( hostSocket.closeReason )})` );
const visitorSocket = new FakeSignalSocket( { role: 'pending', networkId: 'e3918db4832a3056', nodeId: '0123456789', worldId: rendezvousWorldId } );
signalSockets.push( visitorSocket );
await signalRoom.webSocketMessage( visitorSocket, JSON.stringify( { type: 'connect', worldId: rendezvousWorldId, targetPeerId: rendezvousHost.peerId } ) );
const openRequest = hostSocket.messages.at( -1 );
assert.equal( openRequest.type, 'visitor.request' );
await signalRoom.webSocketMessage( hostSocket, JSON.stringify( { type: 'host.response', sessionId: openRequest.sessionId, response: { type: 'connected', worldId: rendezvousWorldId, nodeId: rendezvousHost.peerId, targetPeerId: rendezvousHost.peerId } } ) );
const connected = visitorSocket.messages.at( -1 );
assert.equal( connected.type, 'connected' );
assert.equal( connected.signalSessionId, openRequest.sessionId );
await signalRoom.webSocketMessage( visitorSocket, JSON.stringify( { type: 'webrtc.offer', signalSessionId: connected.signalSessionId, requestId: 'offer-1', sdp: 'valid bounded offer' } ) );
const offerRequest = hostSocket.messages.at( -1 );
assert.equal( offerRequest.request.type, 'webrtc.offer' );
await signalRoom.webSocketMessage( hostSocket, JSON.stringify( { type: 'host.response', sessionId: openRequest.sessionId, response: { type: 'webrtc.answer', worldId: rendezvousWorldId, requestId: 'offer-1', sdp: 'valid bounded answer' } } ) );
assert.equal( visitorSocket.messages.at( -1 ).type, 'webrtc.answer' );
const lateCandidate = { candidate: 'candidate:2 1 udp 90 198.51.100.8 50001 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'test' };
await signalRoom.webSocketMessage( visitorSocket, JSON.stringify( { type: 'webrtc.candidate', signalSessionId: connected.signalSessionId, candidate: lateCandidate } ) );
const candidateRequest = hostSocket.messages.at( -1 );
assert.equal( candidateRequest.type, 'visitor.request' );
assert.equal( candidateRequest.sessionId, connected.signalSessionId );
assert.deepEqual( candidateRequest.request, { type: 'webrtc.candidate', worldId: rendezvousWorldId, candidate: lateCandidate } );
await signalRoom.webSocketMessage( hostSocket, JSON.stringify( { type: 'host.response', sessionId: connected.signalSessionId, response: { type: 'webrtc.candidate.applied', worldId: rendezvousWorldId } } ) );
assert.equal( visitorSocket.messages.at( -1 ).type, 'webrtc.answer', 'candidate acknowledgements stay on signaling and are not relayed to the visitor' );
await signalRoom.webSocketMessage( visitorSocket, JSON.stringify( { type: 'asset.get', signalSessionId: connected.signalSessionId } ) );
assert.equal( visitorSocket.closed, true, 'the rendezvous rejects asset requests instead of carrying world data' );
const candidateLimitSocket = new FakeSignalSocket( { role: 'visitor', connected: true, sessionId: 'e'.repeat( 32 ), nodeId: '0123456789', worldId: rendezvousWorldId } );
signalSockets.push( candidateLimitSocket );
for ( let index = 0; index < 64; index ++ ) await signalRoom.webSocketMessage( candidateLimitSocket, JSON.stringify( { type: 'webrtc.candidate', signalSessionId: 'e'.repeat( 32 ), candidate: lateCandidate } ) );
assert.equal( candidateLimitSocket.closed, false, 'the signaling room accepts its bounded candidate allowance' );
await signalRoom.webSocketMessage( candidateLimitSocket, JSON.stringify( { type: 'webrtc.candidate', signalSessionId: 'e'.repeat( 32 ), candidate: lateCandidate } ) );
assert.equal( candidateLimitSocket.closed, true, 'the signaling room closes a visitor that exceeds the ICE candidate limit' );
const stalePending = new FakeSignalSocket( { role: 'pending', createdAt: Date.now() - 31_000, networkId: 'e3918db4832a3056', nodeId: '0123456789', worldId: rendezvousWorldId } );
signalSockets.push( stalePending );
await signalRoom.alarm();
assert.equal( stalePending.closed, true, 'Durable Object alarms close abandoned signaling handshakes' );

const rendezvousWithoutHostID = await signedDocument( 'elsemesh.node/1', {
	protocol: 'elsemesh.node/1', nodeId: rendezvousHost.peerId, gateway: '', rendezvous: true,
	worldIds: [ rendezvousWorldId ], issuedAt: now, expiresAt: now + 600,
}, rendezvousHost );
const invalidRendezvous = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: JSON.stringify( { node: rendezvousWithoutHostID, manifest: rendezvousManifest } ) } ), env );
assert.equal( invalidRendezvous.status, 422, 'rendezvous-only discovery requires the signed ZeroTier host identity' );

let routedRoom = '';
const signalEnv = {
	...env,
	SIGNAL_ROOMS: {
		idFromName( name ) { routedRoom = name; return name; },
		get() { return { fetch: async () => new Response( 'routed' ) }; },
	},
};
const signalRoute = await handleRequest( new Request( `https://resolver.example/v1/signal/e3918db4832a3056/0123456789/${encodeURIComponent( rendezvousWorldId )}`, { headers: { Upgrade: 'websocket', Origin: 'https://elsemesh.org' } } ), signalEnv );
assert.equal( signalRoute.status, 200 );
assert.equal( routedRoom, `e3918db4832a3056:0123456789:${rendezvousWorldId}` );
const deniedSignalOrigin = await handleRequest( new Request( `https://resolver.example/v1/signal/e3918db4832a3056/0123456789/${encodeURIComponent( rendezvousWorldId )}`, { headers: { Upgrade: 'websocket', Origin: 'https://attacker.example' } } ), signalEnv );
assert.equal( deniedSignalOrigin.status, 403, 'signal room access is limited to the hosted ElseMesh app and local development' );

const oversized = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: ' '.repeat( 2 * 1024 * 1024 + 1 ) } ), env );
assert.equal( oversized.status, 413, 'body-size limits apply even when a caller does not provide Content-Length' );

console.log( 'Cloudflare world resolver tests passed' );
