import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { handleRequest } from './src/index.js';

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
const worldId = 'tw-world:worker-test';
const node = await signedDocument( 'tidewater.node/1', {
	protocol: 'tidewater.node/1', nodeId: owner.peerId, gateway: 'https://owner.example',
	worldIds: [ worldId ], zeroTierNodeId: '3af4fd5d50', zeroTierNetworkId: 'e3918db4832a3056',
	issuedAt: now, expiresAt: now + 600,
}, owner );
const manifest = await signedDocument( 'tidewater.world/1', {
	protocol: 'tidewater.world/1', worldId, ownerPeerId: owner.peerId, authorityEpoch: 1,
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

const nodeLookup = await handleRequest( new Request( 'https://resolver.example/v1/zerotier/e3918db4832a3056/3af4fd5d50' ), env );
const nodeResult = await nodeLookup.json();
assert.deepEqual( nodeResult.worldIds, [ worldId ] );
assert.deepEqual( nodeResult.providers, [ node ] );

const options = await handleRequest( new Request( 'https://resolver.example/v1/worlds/tw-world%3Aworker-test', { method: 'OPTIONS' } ), env );
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

const oversized = await handleRequest( new Request( 'https://resolver.example/v1/announce', { method: 'POST', body: ' '.repeat( 2 * 1024 * 1024 + 1 ) } ), env );
assert.equal( oversized.status, 413, 'body-size limits apply even when a caller does not provide Content-Length' );

console.log( 'Cloudflare world resolver tests passed' );
