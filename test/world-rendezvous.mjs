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

async function signedDocument( protocol, payload, signer ) {
	const unsigned = { protocol, signer: signer.peerId, publicKey: Buffer.from( signer.protobuf ).toString( 'base64' ), payload };
	const signature = new Uint8Array( await crypto.subtle.sign( 'Ed25519', signer.pair.privateKey, new TextEncoder().encode( canonical( unsigned ) ) ) );
	return { ...unsigned, signature: Buffer.from( signature ).toString( 'base64' ) };
}

function emit( socket, type, data ) {
	const event = new Event( type );
	Object.defineProperty( event, 'data', { value: data } );
	socket.dispatchEvent( event );
}

const owner = await identity();
const worldId = 'elsemesh:rendezvous-test';
const now = Math.floor( Date.now() / 1000 );
let node = await signedDocument( 'elsemesh.node/1', {
	protocol: 'elsemesh.node/1', nodeId: owner.peerId, gateway: '', rendezvous: true,
	worldIds: [ worldId ], zeroTierNodeId: '0123456789', zeroTierNetworkId: 'e3918db4832a3056',
	issuedAt: now, expiresAt: now + 600,
}, owner );
const manifest = await signedDocument( 'elsemesh.world/3', {
	protocol: 'elsemesh.world/3', worldId, ownerPeerId: owner.peerId, authorityPeerId: owner.peerId,
	authorityEpoch: 1, version: 1, discoverable: true, title: 'Rendezvous test',
	rules: { gravity: 1, maxVisitors: 8, spawnRadius: 8, avatarComplexity: 1000, physicsProfile: 'elsemesh-default' },
	assets: [], objects: [], components: [], portals: [], hosts: [], updatedAt: now,
}, owner );

const oldFetch = globalThis.fetch;
const OldWebSocket = globalThis.WebSocket;
const OldRTCPeerConnection = globalThis.RTCPeerConnection;
const socketURLs = [];
const socketFrames = [];
const offerSDPs = [];
let connector;
let rejectPublicGateway = false;
let gatheringStaysOpenAfterPublicCandidate = false;

globalThis.fetch = async ( input ) => {
	const url = new URL( input );
	assert.equal( url.pathname, '/v1/zerotier/e3918db4832a3056/0123456789' );
	return { ok: true, json: async () => ( { networkId: 'e3918db4832a3056', nodeId: '0123456789', worldIds: [ worldId ], providers: [ node ] } ) };
};

globalThis.WebSocket = class extends EventTarget {
	static OPEN = 1;
	static CONNECTING = 0;
	static CLOSING = 2;
	static CLOSED = 3;
	constructor( url ) {
		super();
		socketURLs.push( String( url ) );
		this.url = String( url );
		this.readyState = WebSocket.CONNECTING;
		queueMicrotask( () => {
			if ( rejectPublicGateway && this.url.includes( 'owner.example' ) ) { emit( this, 'error' ); return; }
			this.readyState = WebSocket.OPEN;
			emit( this, 'open' );
		} );
	}
	send( raw ) {
		const request = JSON.parse( raw );
		socketFrames.push( request.type );
		if ( request.type === 'connect' ) emit( this, 'message', JSON.stringify( { type: 'connected', worldId, nodeId: owner.peerId, targetPeerId: owner.peerId, manifestProtocol: 'elsemesh.world/3', signalSessionId: 'a'.repeat( 32 ), iceServers: [ { urls: [ 'stun:stun.example:3478' ] } ] } ) );
		else if ( request.type === 'webrtc.offer' ) {
			assert.equal( request.signalSessionId, 'a'.repeat( 32 ) );
			offerSDPs.push( request.sdp );
			emit( this, 'message', JSON.stringify( { type: 'webrtc.answer', worldId, requestId: request.requestId, sdp: 'answer' } ) );
		}
		else throw new Error( `world data must not be sent over signaling (${request.type})` );
	}
	close() { this.readyState = WebSocket.CLOSED; emit( this, 'close' ); }
};

class FakeChannel extends EventTarget {
	constructor() { super(); this.readyState = 'connecting'; this.label = 'elsemesh.world/3'; this.ordered = true; }
	send( raw ) {
		const request = JSON.parse( raw );
		assert.equal( request.type, 'manifest.get' );
		queueMicrotask( () => emit( this, 'message', JSON.stringify( { type: 'manifest', worldId, requestId: request.requestId, document: manifest } ) ) );
	}
}

globalThis.RTCPeerConnection = class extends EventTarget {
	constructor( config ) { super(); this.iceServers = config.iceServers; this.iceGatheringState = gatheringStaysOpenAfterPublicCandidate ? 'gathering' : 'complete'; this.connectionState = 'new'; }
	createDataChannel() { return this.channel = new FakeChannel(); }
	async createOffer() { return { type: 'offer', sdp: 'offer' }; }
	async setLocalDescription( offer ) {
		this.localDescription = { ...offer };
		if ( gatheringStaysOpenAfterPublicCandidate ) setTimeout( () => {
			const candidate = { candidate: 'candidate:1 1 udp 100 203.0.113.7 50000 typ srflx raddr 192.0.2.4 rport 50000', type: 'srflx' };
			this.localDescription.sdp += `\r\na=${candidate.candidate}`;
			const event = new Event( 'icecandidate' );
			Object.defineProperty( event, 'candidate', { value: candidate } );
			this.dispatchEvent( event );
		}, 0 );
	}
	async setRemoteDescription() { this.channel.readyState = 'open'; queueMicrotask( () => emit( this.channel, 'open' ) ); }
	close() { this.connectionState = 'closed'; }
};

try {
	connector = new WorldConnector( { zeroTierNodeId: '0123456789', zeroTierNetworkId: 'e3918db4832a3056', directory: 'https://resolver.example' } );
	const loaded = await connector.getManifest();
	assert.equal( loaded.worldId, worldId );
	assert.equal( connector.nodeId, owner.peerId );
	assert.equal( connector.gateway, '', 'a gateway-less record uses the signaling rendezvous' );
	assert.deepEqual( socketURLs, [ `wss://resolver.example/v1/signal/e3918db4832a3056/0123456789/${encodeURIComponent( worldId )}` ] );
	assert.deepEqual( socketFrames, [ 'connect', 'webrtc.offer' ], 'the Worker receives signaling only; manifest data travels over the WebRTC channel' );
	connector.close();
	gatheringStaysOpenAfterPublicCandidate = true;
	socketFrames.length = 0;
	offerSDPs.length = 0;
	const partialGathering = new WorldConnector( { zeroTierNodeId: '0123456789', zeroTierNetworkId: 'e3918db4832a3056', directory: 'https://resolver.example' } );
	assert.equal( ( await partialGathering.getManifest() ).worldId, worldId, 'the rendezvous proceeds once a public candidate exists even if ICE gathering stays open' );
	assert.match( offerSDPs[ 0 ], /typ srflx/, 'the one-shot offer includes the gathered server-reflexive candidate' );
	assert.deepEqual( socketFrames, [ 'connect', 'webrtc.offer' ], 'partial gathering still uses signaling for setup only' );
	partialGathering.close();
	gatheringStaysOpenAfterPublicCandidate = false;
	node = await signedDocument( 'elsemesh.node/1', { ...node.payload, gateway: 'https://owner.example' }, owner );
	rejectPublicGateway = true;
	socketURLs.length = 0;
	socketFrames.length = 0;
	const rendezvousFallback = new WorldConnector( { zeroTierNodeId: '0123456789', zeroTierNetworkId: 'e3918db4832a3056', directory: 'https://resolver.example' } );
	await rendezvousFallback.getManifest();
	assert.equal( rendezvousFallback.nodeId, owner.peerId );
	assert.deepEqual( socketURLs, [ 'wss://owner.example/gateway', `wss://resolver.example/v1/signal/e3918db4832a3056/0123456789/${encodeURIComponent( worldId )}` ], 'a failed public gateway falls through to the HostID signaling room' );
	assert.deepEqual( socketFrames, [ 'connect', 'webrtc.offer' ], 'fallback still keeps manifest traffic off the Worker' );
	rendezvousFallback.close();
	rejectPublicGateway = false;
	globalThis.RTCPeerConnection = undefined;
	const unsupported = new WorldConnector( { zeroTierNodeId: '0123456789', zeroTierNetworkId: 'e3918db4832a3056', directory: 'https://resolver.example' } );
	await assert.rejects( unsupported.getManifest(), /does not support WebRTC required by the signaling rendezvous/ );
	unsupported.close();
	console.log( 'ok signaling-only discovery, authenticated WebRTC setup, and direct data-channel manifest transfer' );
} finally {
	connector?.close();
	globalThis.fetch = oldFetch;
	if ( OldWebSocket === undefined ) delete globalThis.WebSocket;
	else globalThis.WebSocket = OldWebSocket;
	if ( OldRTCPeerConnection === undefined ) delete globalThis.RTCPeerConnection;
	else globalThis.RTCPeerConnection = OldRTCPeerConnection;
}
