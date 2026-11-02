import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { extractKTX2Level } from '../src/engine/loaders/KTX2Level.js';
import { fetchGLBWithCoarseKTX2, fetchNextGLBTextureLevels } from '../src/engine/loaders/GLBRange.js';

const ktx2 = new Uint8Array( await readFile( new URL( './fixtures/ktx2-checker.ktx2', import.meta.url ) ) );
const sourceView = new DataView( ktx2.buffer, ktx2.byteOffset, ktx2.byteLength );
const levelCount = sourceView.getUint32( 40, true );
const geometry = new Uint8Array( [ 0x10, 0x20, 0x30, 0x40 ] );
const binary = new Uint8Array( geometry.byteLength + ktx2.byteLength );
binary.set( geometry );
binary.set( ktx2, geometry.byteLength );
const document = {
	asset: { version: '2.0' },
	buffers: [ { byteLength: binary.byteLength } ],
	bufferViews: [
		{ buffer: 0, byteOffset: 0, byteLength: geometry.byteLength },
		{ buffer: 0, byteOffset: geometry.byteLength, byteLength: ktx2.byteLength },
	],
	images: [ { bufferView: 1, mimeType: 'image/ktx2' } ],
	nodes: [], scenes: [ { nodes: [] } ], scene: 0,
};
const json = new TextEncoder().encode( JSON.stringify( document ) );
const jsonLength = ( json.byteLength + 3 ) & ~3;
const binLength = ( binary.byteLength + 3 ) & ~3;
const asset = new Uint8Array( 28 + jsonLength + binLength );
const assetView = new DataView( asset.buffer );
assetView.setUint32( 0, 0x46546c67, true );
assetView.setUint32( 4, 2, true );
assetView.setUint32( 8, asset.byteLength, true );
assetView.setUint32( 12, jsonLength, true );
assetView.setUint32( 16, 0x4e4f534a, true );
asset.fill( 0x20, 20, 20 + jsonLength );
asset.set( json, 20 );
assetView.setUint32( 20 + jsonLength, binLength, true );
assetView.setUint32( 24 + jsonLength, 0x004e4942, true );
asset.set( binary, 28 + jsonLength );

const etag = `"sha256-${'a'.repeat( 64 )}"`;
const requested = [];
const connector = {
	async getAssetRange( _assetId, { start, end, signal } ) {
		assert( ! signal?.aborted );
		requested.push( { start, end } );
		return { start, end, bytes: asset.slice( start, end + 1 ), etag, totalLength: asset.byteLength };
	},
	async getAssetRanges( _assetId, ranges ) {
		for ( const range of ranges ) requested.push( { ...range } );
		return ranges.map( range => ( { ...range, bytes: asset.slice( range.start, range.end + 1 ), etag, totalLength: asset.byteLength } ) );
	},
};

const result = await fetchGLBWithCoarseKTX2( connector, 'synthetic-glb' );
assert( result?.bytes instanceof Uint8Array );
assert( result.bytes.byteLength < asset.byteLength, 'coarse-first GLB omits unrequested finer mip payloads' );
const parsed = parseGLB( result.bytes );
assert.equal( parsed.json.bufferViews[ 0 ].byteOffset, 0 );
assert.deepEqual( parsed.json.images.map( image => image.mimeType ), [ 'image/ktx2' ] );
assert.deepEqual( parsed.images[ 0 ].bytes, extractKTX2Level( ktx2, levelCount - 1 ) );
const outputJSONLength = new DataView( result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength ).getUint32( 12, true );
const outputBinOffset = 28 + outputJSONLength;
assert.deepEqual( result.bytes.subarray( outputBinOffset, outputBinOffset + geometry.byteLength ), geometry );
const selectedLevelOffset = Number( sourceView.getBigUint64( 80 + ( levelCount - 1 ) * 24, true ) ) + 28 + jsonLength + geometry.byteLength;
const selectedLevelLength = Number( sourceView.getBigUint64( 80 + ( levelCount - 1 ) * 24 + 8, true ) );
assert( requested.some( range => range.start <= selectedLevelOffset && range.end >= selectedLevelOffset + selectedLevelLength - 1 ), 'the coarsest mip payload is requested' );
for ( let level = 0; level < levelCount - 1; level ++ ) {
	const offset = Number( sourceView.getBigUint64( 80 + level * 24, true ) ) + 28 + jsonLength + geometry.byteLength;
	const length = Number( sourceView.getBigUint64( 80 + level * 24 + 8, true ) );
	assert( requested.every( range => range.end < offset || range.start >= offset + length ), `finer mip ${level} bytes are not requested` );
}
assert( result.sourceBytesRequested < asset.byteLength, 'range transfer requests fewer bytes than the complete GLB' );
const beforeFineLevel = requested.length;
const fineLevelIndex = levelCount - 2;
const fineLevel = await fetchNextGLBTextureLevels( connector, 'synthetic-glb', result );
assert.equal( fineLevel.length, 1, 'the image exposes one next-finer level' );
assert.deepEqual( fineLevel[ 0 ].bytes, extractKTX2Level( ktx2, fineLevelIndex ), 'the next-finer mip is rebuilt from its indexed payload' );
const fineLevelOffset = Number( sourceView.getBigUint64( 80 + fineLevelIndex * 24, true ) ) + 28 + jsonLength + geometry.byteLength;
const fineLevelLength = Number( sourceView.getBigUint64( 80 + fineLevelIndex * 24 + 8, true ) );
const fineLevelRequests = requested.slice( beforeFineLevel );
assert( fineLevelRequests.length === 1 && fineLevelRequests[ 0 ].start === fineLevelOffset && fineLevelRequests[ 0 ].end === fineLevelOffset + fineLevelLength - 1, 'a finer-level upgrade requests only that mip payload, without geometry, coarse mip, or metadata' );
const beforeSecondFineLevel = requested.length;
const secondFineLevelIndex = levelCount - 3;
const secondFineLevel = await fetchNextGLBTextureLevels( connector, 'synthetic-glb', result );
assert.deepEqual( secondFineLevel[ 0 ].bytes, extractKTX2Level( ktx2, secondFineLevelIndex ), 'successive upgrades advance toward higher resolution' );
const secondFineOffset = Number( sourceView.getBigUint64( 80 + secondFineLevelIndex * 24, true ) ) + 28 + jsonLength + geometry.byteLength;
const secondFineLength = Number( sourceView.getBigUint64( 80 + secondFineLevelIndex * 24 + 8, true ) );
const secondFineRequests = requested.slice( beforeSecondFineLevel );
assert( secondFineRequests.length === 1 && secondFineRequests[ 0 ].start === secondFineOffset && secondFineRequests[ 0 ].end === secondFineOffset + secondFineLength - 1, 'each successive upgrade transfers only its newly requested mip payload' );
console.log( 'Ranged GLB coarse-texture checks passed' );
