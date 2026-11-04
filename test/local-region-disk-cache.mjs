import assert from 'node:assert/strict';
import { LocalRegionDiskCache } from '../src/network/LocalRegionDiskCache.js';

const files = new Map();
let quota = 4 * 1024 ** 3;
let baseUsage = 0;
let metadataFileReads = 0;

class MemoryFileHandle {
	constructor( name ) { this.name = name; }
	async getFile() {
		if ( this.name.endsWith( '.meta' ) ) metadataFileReads ++;
		if ( ! files.has( this.name ) ) throw new DOMException( 'Not found', 'NotFoundError' );
		const contents = files.get( this.name );
		return new Blob( [ contents ] );
	}
	async createWritable() {
		let pending = new Uint8Array();
		return {
			write: async contents => {
				pending = typeof contents === 'string' ? new TextEncoder().encode( contents ) : new Uint8Array( contents );
			},
			close: async () => files.set( this.name, pending ),
			abort: async () => {},
		};
	}
}

class MemoryDirectoryHandle {
	async getDirectoryHandle() { return this; }
	async getFileHandle( name ) { return new MemoryFileHandle( name ); }
	async removeEntry( name ) { files.delete( name ); }
	async * entries() {
		for ( const name of files.keys() ) yield [ name, new MemoryFileHandle( name ) ];
	}
}

const originalNavigator = Object.getOwnPropertyDescriptor( globalThis, 'navigator' );
const openedCaches = [];
const storage = {
	getDirectory: async () => new MemoryDirectoryHandle(),
	estimate: async () => ( { quota, usage: baseUsage + [ ...files.entries() ].filter( ( [ name ] ) => name.endsWith( '.bin' ) ).reduce( ( total, [ , value ] ) => total + value.byteLength, 0 ) } ),
};
Object.defineProperty( globalThis, 'navigator', { configurable: true, value: { storage } } );

try {
	const bytes = new TextEncoder().encode( 'validated local region bytes' );
	const digest = Buffer.from( await crypto.subtle.digest( 'SHA-256', bytes ) ).toString( 'hex' );
	const cache = await LocalRegionDiskCache.open( { worldId: 'elsemesh:hogwarts', sourceRevision: 'revision-1' } );
	openedCaches.push( cache );
	assert.ok( cache, 'OPFS cache opens when storage APIs are available' );
	assert.equal( await cache.put( 'cell-1:visual', bytes, digest ), true );
	assert.deepEqual( await cache.get( 'cell-1:visual' ), bytes );
	await new Promise( resolve => setTimeout( resolve, 1100 ) );
	assert.ok( files.has( 'index.json' ), 'cache writes a compact metadata index after content is stored' );
	const readsBeforeIndexedOpen = metadataFileReads;
	const indexedCache = await LocalRegionDiskCache.open( { worldId: 'elsemesh:hogwarts', sourceRevision: 'revision-3' } );
	openedCaches.push( indexedCache );
	await indexedCache.ready;
	assert.equal( metadataFileReads, readsBeforeIndexedOpen, 'a valid cache index avoids reading every per-entry metadata file on startup' );

	const pendingID = Buffer.from( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( 'elsemesh:hogwarts\0revision-1\0pending-index-write' ) ) ).toString( 'hex' );
	assert.equal( await cache.put( 'pending-index-write', bytes, digest ), true );
	await new Promise( resolve => setTimeout( resolve, 1100 ) );
	const delayedIndex = JSON.parse( new TextDecoder().decode( files.get( 'index.json' ) ) );
	assert.equal( delayedIndex.entries.some( entry => entry.id === pendingID ), false, 'cache writes coalesce index snapshots after the first recent write' );
	assert.ok( files.has( `${pendingID}.meta` ), 'per-entry metadata persists immediately while the rebuildable index is delayed' );
	clearTimeout( cache.indexWriteTimer );
	cache.indexWriteTimer = null;

	const deltaBytes = new TextEncoder().encode( 'recovered from a write after the last index snapshot' );
	const deltaId = Buffer.from( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( 'elsemesh:hogwarts\0revision-1\0interrupted-write' ) ) ).toString( 'hex' );
	files.set( `${deltaId}.bin`, deltaBytes );
	files.set( `${deltaId}.meta`, new TextEncoder().encode( JSON.stringify( { schema: 1, id: deltaId, bytes: deltaBytes.byteLength, digest: null, lastUsed: Date.now() } ) ) );
	const readsBeforeDeltaOpen = metadataFileReads;
	const recoveredCache = await LocalRegionDiskCache.open( { worldId: 'elsemesh:hogwarts', sourceRevision: 'revision-1' } );
	openedCaches.push( recoveredCache );
	await recoveredCache.ready;
	assert.equal( metadataFileReads, readsBeforeDeltaOpen + 2, 'startup reads only metadata added after the saved index' );
	assert.deepEqual( await recoveredCache.get( 'interrupted-write' ), deltaBytes, 'a valid entry written after the last index snapshot is recovered' );
	files.delete( `${deltaId}.bin` );
	files.delete( `${deltaId}.meta` );

	const changedRevision = await LocalRegionDiskCache.open( { worldId: 'elsemesh:hogwarts', sourceRevision: 'revision-2' } );
	openedCaches.push( changedRevision );
	assert.equal( await changedRevision.get( 'cell-1:visual' ), null, 'source revisions do not share cached bytes' );

	const dataName = [ ...files.keys() ].find( name => name.endsWith( '.bin' ) );
	files.set( dataName, new TextEncoder().encode( 'corrupt data' ) );
	assert.equal( await cache.get( 'cell-1:visual' ), null, 'corrupt disk entries are rejected and evicted' );
	const corruptId = dataName.slice( 0, - 4 );
	assert.equal( files.has( `${corruptId}.bin` ) || files.has( `${corruptId}.meta` ), false, 'corrupt payload and metadata files are removed while unrelated cache entries remain' );

	quota = 1024 ** 3;
	baseUsage = quota - 512 * 1024 ** 2 - 8;
	cache.nextEstimateAt = 0;
	const smallAsset = new TextEncoder().encode( '1234' );
	const smallDigest = Buffer.from( await crypto.subtle.digest( 'SHA-256', smallAsset ) ).toString( 'hex' );
	assert.equal( await cache.put( 'lru-a', smallAsset, smallDigest ), true );
	await new Promise( resolve => setTimeout( resolve, 2 ) );
	assert.equal( await cache.put( 'lru-b', smallAsset, smallDigest ), true );
	assert.deepEqual( await cache.get( 'lru-a' ), smallAsset, 'cache reads refresh least-recently-used order' );
	const lruAId = Buffer.from( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( 'elsemesh:hogwarts\0revision-1\0lru-a' ) ) ).toString( 'hex' );
	const lruAMetadataName = `${lruAId}.meta`;
	const oldLastUsed = Date.now() - 60000;
	const oldMetadata = JSON.parse( new TextDecoder().decode( files.get( lruAMetadataName ) ) );
	oldMetadata.lastUsed = oldLastUsed;
	files.set( lruAMetadataName, new TextEncoder().encode( JSON.stringify( oldMetadata ) ) );
	cache.entries.get( lruAId ).lastUsed = oldLastUsed;
	assert.equal( await cache.touch( 'lru-a' ), true, 'a RAM hit can refresh disk-cache recency without reading the payload' );
	assert.ok( JSON.parse( new TextDecoder().decode( files.get( lruAMetadataName ) ) ).lastUsed > oldLastUsed + 30000, 'a stale disk LRU timestamp is persisted when its entry is reused from RAM' );
	assert.equal( await cache.put( 'lru-c', smallAsset, smallDigest ), true );
	assert.deepEqual( await cache.get( 'lru-a' ), smallAsset, 'the recently used entry remains in the cache' );
	assert.equal( await cache.get( 'lru-b' ), null, 'the least recently used entry is evicted to meet the quota-derived budget' );
	assert.deepEqual( await cache.get( 'lru-c' ), smallAsset );
	quota = 4 * 1024 ** 3;
	baseUsage = 0;
	cache.nextEstimateAt = 0;
	const sourceTexture = new TextEncoder().encode( 'source-identified texture bytes' );
	assert.equal( await cache.put( 'source:fixture-texture', sourceTexture, null ), true );
	assert.deepEqual( await cache.get( 'source:fixture-texture' ), sourceTexture, 'source-identified texture ranges can be cached without a payload digest' );
	const sourceTextureID = Buffer.from( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( 'elsemesh:hogwarts\0revision-1\0source:fixture-texture' ) ) ).toString( 'hex' );
	assert.equal( JSON.parse( new TextDecoder().decode( files.get( `${sourceTextureID}.meta` ) ) ).digest, null, 'opaque texture cache entries omit payload digest metadata' );
	console.log( 'local region disk cache tests passed' );
} finally {
	for ( const cache of openedCaches ) if ( cache?.indexWriteTimer !== null ) clearTimeout( cache.indexWriteTimer );
	if ( originalNavigator ) Object.defineProperty( globalThis, 'navigator', originalNavigator );
	else delete globalThis.navigator;
}
