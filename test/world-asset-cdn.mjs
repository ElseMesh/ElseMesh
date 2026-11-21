import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchWorldAssetFromCDN, isValidWorldAssetCDNURL, normalizeWorldAssetCDNBase, worldAssetCDNURL } from '../src/network/WorldAssetCDN.js';
import { WorldConnector, validateWorldAssets } from '../src/network/WorldConnector.js';

const bytes = new TextEncoder().encode( 'shared immutable world mesh bytes' );
const id = `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const baseURL = normalizeWorldAssetCDNBase( 'https://assets.example.net/world-content/' );
const cdnURL = worldAssetCDNURL( baseURL, id );
const asset = { id, bytes: bytes.byteLength, kind: 'glb', priority: 'visible', cdnURL };

assert.equal( cdnURL, `https://assets.example.net/world-content/sha256/${id.slice( 7 )}` );
assert.equal( worldAssetCDNURL( baseURL, id ), cdnURL, 'different worlds using the shared CDN base get the same cache URL for identical content' );
assert.equal( isValidWorldAssetCDNURL( cdnURL, id ), true );
assert.equal( isValidWorldAssetCDNURL( cdnURL, `sha256:${'f'.repeat( 64 )}` ), false );
assert.throws( () => normalizeWorldAssetCDNBase( 'http://assets.example.net' ), /HTTPS/ );
assert.throws( () => normalizeWorldAssetCDNBase( 'https://assets.example.net?token=private' ), /query/ );
assert.doesNotThrow( () => validateWorldAssets( [ asset ] ) );
assert.throws( () => validateWorldAssets( [ { ...asset, cdnURL: 'https://assets.example.net/worlds/elsemesh:test/asset' } ] ), /invalid asset/ );

const previousFetch = globalThis.fetch;
const previousWebSocket = globalThis.WebSocket;
const fetchCalls = [];
class FakeWebSocket {
	static OPEN = 1;
	constructor() { this.readyState = 0; this.listeners = new Map(); queueMicrotask( () => { this.readyState = 1; this.dispatch( 'open', {} ); } ); }
	addEventListener( type, callback, options = {} ) {
		const callbacks = this.listeners.get( type ) || [];
		callbacks.push( { callback, once: options.once === true } );
		this.listeners.set( type, callbacks );
	}
	dispatch( type, event ) {
		const callbacks = this.listeners.get( type ) || [];
		for ( const entry of [ ...callbacks ] ) {
			entry.callback( event );
			if ( entry.once ) callbacks.splice( callbacks.indexOf( entry ), 1 );
		}
	}
	send( text ) {
		const request = JSON.parse( text );
		if ( request.type === 'connect' ) {
			queueMicrotask( () => this.dispatch( 'message', { data: JSON.stringify( { type: 'connected', worldId: 'elsemesh:cdn-fallback', iceServers: [] } ) } ) );
		} else if ( request.type === 'asset.get' ) {
			queueMicrotask( () => this.dispatch( 'message', { data: JSON.stringify( {
				type: 'asset.chunk', requestId: request.requestId, assetId: request.assetId, offset: request.offset,
				total: bytes.byteLength, chunk: Buffer.from( bytes ).toString( 'base64' ).replace( /=+$/, '' ),
			} ) } ) );
		}
	}
	close() { this.readyState = 3; this.dispatch( 'close', {} ); }
}

try {
	globalThis.fetch = async ( url, options ) => {
		fetchCalls.push( { url: String( url ), options } );
		return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) };
	};
	const direct = await fetchWorldAssetFromCDN( asset );
	assert.deepEqual( direct, bytes, 'the CDN bytes pass size and SHA-256 verification' );
	assert.equal( fetchCalls[ 0 ].url, cdnURL );
	assert.equal( fetchCalls[ 0 ].options.cache, 'force-cache', 'immutable digest URLs use the browser HTTP cache' );
	assert.equal( fetchCalls[ 0 ].options.credentials, 'omit', 'public shared assets are fetched without world-specific credentials' );

	globalThis.WebSocket = FakeWebSocket;
	globalThis.fetch = async () => { throw new Error( 'CDN unavailable' ); };
	const connector = new WorldConnector( { worldId: 'elsemesh:cdn-fallback', nodeId: 'A'.repeat( 20 ), gateway: 'https://world.example.net' } );
	connector.manifest = { assets: [ asset ] };
	const fallback = await connector.getAsset( id );
	assert.deepEqual( fallback, bytes, 'a CDN failure falls back to the signed world provider and verifies its bytes' );
	assert.equal( connector.assets.has( id ), true );
	connector.close();

	globalThis.fetch = async () => ( { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode( 'wrong bytes' ).buffer } );
	await assert.rejects( fetchWorldAssetFromCDN( asset ), /unexpected size/, 'a cache object with a different byte length is rejected before decode' );
	const wrongLengthAsset = { ...asset, bytes: new TextEncoder().encode( 'wrong bytes' ).byteLength };
	await assert.rejects( fetchWorldAssetFromCDN( wrongLengthAsset ), /hash check/, 'a same-size cache object with a different digest is rejected' );
	console.log( 'world asset CDN URLs are shared by digest, browser-cached, hash-checked, and fall back to worldd' );
} finally {
	globalThis.fetch = previousFetch;
	globalThis.WebSocket = previousWebSocket;
}
