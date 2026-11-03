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

const textureAssetId = 'source:dGVzdC10ZXh0dXJl';
const externalDocument = {
	asset: { version: '2.0' },
	buffers: [ { byteLength: geometry.byteLength } ],
	bufferViews: [ { buffer: 0, byteOffset: 0, byteLength: geometry.byteLength } ],
	images: [ { mimeType: 'image/ktx2', extensions: { EXT_elsemesh_asset_reference: { assetId: textureAssetId } } } ],
	nodes: [], scenes: [ { nodes: [] } ], scene: 0,
	extensionsUsed: [ 'EXT_elsemesh_asset_reference' ], extensionsRequired: [ 'EXT_elsemesh_asset_reference' ],
};
const externalJSON = new TextEncoder().encode( JSON.stringify( externalDocument ) );
const externalJSONLength = ( externalJSON.byteLength + 3 ) & ~3;
const externalGLB = new Uint8Array( 28 + externalJSONLength + geometry.byteLength );
const externalView = new DataView( externalGLB.buffer );
externalView.setUint32( 0, 0x46546c67, true );
externalView.setUint32( 4, 2, true );
externalView.setUint32( 8, externalGLB.byteLength, true );
externalView.setUint32( 12, externalJSONLength, true );
externalView.setUint32( 16, 0x4e4f534a, true );
externalGLB.fill( 0x20, 20, 20 + externalJSONLength );
externalGLB.set( externalJSON, 20 );
externalView.setUint32( 20 + externalJSONLength, geometry.byteLength, true );
externalView.setUint32( 24 + externalJSONLength, 0x004e4942, true );
externalGLB.set( geometry, 28 + externalJSONLength );
const externalAssets = new Map( [ [ 'external-glb', externalGLB ], [ textureAssetId, ktx2 ] ] );
const externalETags = new Map( [ [ 'external-glb', '"external-glb-etag"' ], [ textureAssetId, `"${textureAssetId}"` ] ] );
const externalRequests = [];
const registeredExternalAssets = [];
const externalConnector = {
	registerExternalTextureAsset: ( sourceAssetId, referencedAssetId ) => registeredExternalAssets.push( { sourceAssetId, referencedAssetId } ),
	async getAssetRange( assetId, { start, end } ) {
		const bytes = externalAssets.get( assetId );
		assert( bytes, `external range requested for declared asset ${assetId}` );
		externalRequests.push( { assetId, start, end } );
		return { start, end, bytes: bytes.slice( start, end + 1 ), etag: externalETags.get( assetId ), totalLength: bytes.byteLength };
	},
	async getAssetRanges( assetId, ranges ) {
		const bytes = externalAssets.get( assetId );
		assert( bytes, `external range batch requested for declared asset ${assetId}` );
		for ( const range of ranges ) externalRequests.push( { assetId, ...range } );
		return ranges.map( range => ( { ...range, bytes: bytes.slice( range.start, range.end + 1 ), etag: externalETags.get( assetId ), totalLength: bytes.byteLength } ) );
	},
};
const externalResult = await fetchGLBWithCoarseKTX2( externalConnector, 'external-glb' );
assert( externalResult?.bytes instanceof Uint8Array, 'external KTX2 references use the progressive range path' );
assert.deepEqual( registeredExternalAssets, [ { sourceAssetId: 'external-glb', referencedAssetId: textureAssetId } ], 'the ranged loader registers its referenced texture asset before requesting its mip ranges' );
const externalParsed = parseGLB( externalResult.bytes );
assert.equal( externalParsed.images[ 0 ].assetId, textureAssetId, 'the coarse GLB retains the opaque shared texture identity' );
assert.equal( externalParsed.images[ 0 ].bytes, null, 'the coarse GLB does not inline duplicate texture bytes' );
assert.deepEqual( externalResult.textures[ 0 ].initialLevelBytes, extractKTX2Level( ktx2, levelCount - 1 ), 'the initial shared texture is the coarsest independently fetched mip' );
const webGLParsed = parseGLB( externalResult.webGLBytes );
assert.equal( webGLParsed.images[ 0 ].assetId, null, 'the WebGL GLB removes the engine-only external image reference' );
assert.deepEqual( webGLParsed.images[ 0 ].bytes, extractKTX2Level( ktx2, levelCount - 1 ), 'the WebGL GLB embeds only the selected coarse external KTX2 level' );
assert( ! webGLParsed.json.extensionsRequired?.includes( 'EXT_elsemesh_asset_reference' ), 'the WebGL GLB does not require the engine-only external image extension' );
const externalInitialRequests = externalRequests.slice();
assert.equal( externalResult.sourceBytesRequested, externalInitialRequests.reduce( ( total, range ) => total + range.end - range.start + 1, 0 ), 'the reported initial transfer includes ranges for separate texture assets' );
const wrongTextureETagConnector = {
	...externalConnector,
	async getAssetRange( assetId, range ) {
		const result = await externalConnector.getAssetRange( assetId, range );
		return assetId === textureAssetId ? { ...result, etag: '"source:wrong"' } : result;
	},
};
await assert.rejects( fetchGLBWithCoarseKTX2( wrongTextureETagConnector, 'external-glb' ), /ETag does not match its asset id/, 'external texture ETags must agree with their opaque asset ID' );
const externalMipStart = externalRequests.length;
const externalFine = await fetchNextGLBTextureLevels( externalConnector, 'external-glb', externalResult );
const externalFineIndex = levelCount - 2;
assert.deepEqual( externalFine[ 0 ].bytes, extractKTX2Level( ktx2, externalFineIndex ), 'a shared texture upgrades from its standalone KTX2 asset' );
const externalFineRequests = externalRequests.slice( externalMipStart );
const externalFineOffset = Number( sourceView.getBigUint64( 80 + externalFineIndex * 24, true ) );
const externalFineLength = Number( sourceView.getBigUint64( 80 + externalFineIndex * 24 + 8, true ) );
assert.deepEqual( externalFineRequests, [ { assetId: textureAssetId, start: externalFineOffset, end: externalFineOffset + externalFineLength - 1 } ], 'a shared-texture upgrade requests only its new mip bytes, not geometry or earlier mips' );
console.log( 'Ranged GLB coarse-texture checks passed' );
