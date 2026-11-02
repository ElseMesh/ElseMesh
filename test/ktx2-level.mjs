import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleKTX2LevelFromRanges, extractKTX2Level, planKTX2LevelRanges } from '../src/engine/loaders/KTX2Level.js';
import { fetchKTX2Level } from '../src/engine/loaders/KTX2Range.js';

const source = new Uint8Array( readFileSync( new URL( './fixtures/ktx2-checker.ktx2', import.meta.url ) ) );
const sourceView = new DataView( source.buffer, source.byteOffset, source.byteLength );
const levelCount = sourceView.getUint32( 40, true );
assert( levelCount > 1, 'fixture has multiple independently indexed levels' );

for ( const index of [ 0, levelCount - 1 ] ) {
	const extracted = extractKTX2Level( source, index );
	const baseOffset = 1234;
	const plan = planKTX2LevelRanges( source, index, { baseOffset, totalLength: source.byteLength } );
	const sourceLevelIndex = 80 + index * 24;
	const sourceOffset = Number( sourceView.getBigUint64( sourceLevelIndex, true ) );
	const sourceLength = Number( sourceView.getBigUint64( sourceLevelIndex + 8, true ) );
	assert.equal( plan.parts.find( part => part.kind === 'level' ).start, baseOffset + sourceOffset );
	assert.equal( plan.parts.find( part => part.kind === 'level' ).end, baseOffset + sourceOffset + sourceLength - 1 );
	assert( plan.parts.every( part => part.kind !== 'level' || part.level === index ), 'the range plan includes only the selected mip payload' );
	const sectionParts = Object.fromEntries( plan.parts.filter( part => part.kind !== 'header-index' && part.kind !== 'level' ).map( part => {
		const offset = part.start - baseOffset;
		return [ part.kind.toUpperCase(), source.subarray( offset, offset + part.end - part.start + 1 ) ];
	} ) );
	const levelBytes = source.subarray( sourceOffset, sourceOffset + sourceLength );
	const assembled = assembleKTX2LevelFromRanges( source.subarray( 0, 80 + levelCount * 24 ), index, {
		sections: sectionParts, levelBytes, totalLength: source.byteLength,
	} );
	assert.deepEqual( assembled, extracted, 'independent metadata and selected-level ranges rebuild the same one-level KTX2' );
	const view = new DataView( extracted.buffer, extracted.byteOffset, extracted.byteLength );
	assert.equal( view.getUint32( 40, true ), 1, 'extracted KTX2 contains one image level' );
	assert.equal( view.getUint32( 20, true ), Math.max( 1, sourceView.getUint32( 20, true ) >> index ) );
	assert.equal( view.getUint32( 24, true ), Math.max( 1, sourceView.getUint32( 24, true ) >> index ) );
	const outputOffset = Number( view.getBigUint64( 80, true ) );
	const outputLength = Number( view.getBigUint64( 88, true ) );
	assert.equal( outputLength, sourceLength, 'selected mip payload length is preserved' );
	assert.deepEqual( extracted.subarray( outputOffset, outputOffset + outputLength ), source.subarray( sourceOffset, sourceOffset + sourceLength ), 'output carries only the selected mip payload' );
	assert( extracted.byteLength < source.byteLength, 'single-level container is smaller than the full mip pyramid' );
}

assert.throws( () => extractKTX2Level( source, levelCount ), RangeError );
assert.throws( () => extractKTX2Level( source.subarray( 0, 32 ), 0 ), /truncated/ );
const glbImageOffset = 256;
const containingAsset = new Uint8Array( glbImageOffset + source.byteLength + 64 );
containingAsset.set( source, glbImageOffset );
const fullAssetHash = '"sha256-' + 'a'.repeat( 64 ) + '"';
const requestedRanges = [];
const rangeConnector = {
	getAssetRange: async ( _assetId, { start, end, etag } ) => {
		assert( ! etag || etag === fullAssetHash, 'subsequent ranges remain bound to the original asset ETag' );
		requestedRanges.push( { start, end } );
		return { bytes: containingAsset.slice( start, end + 1 ), etag: fullAssetHash, start, end, totalLength: containingAsset.byteLength };
	},
};
const selectedLevelIndex = levelCount - 1;
const selectedLevel = await fetchKTX2Level( rangeConnector, 'fixture-glb', {
	imageOffset: glbImageOffset, imageLength: source.byteLength, levelIndex: selectedLevelIndex,
	assetLength: containingAsset.byteLength, etag: fullAssetHash,
} );
assert.deepEqual( selectedLevel.bytes, extractKTX2Level( source, selectedLevelIndex ), 'range transport rebuilds a decoder-ready selected KTX2 level' );
const selectedLevelIndexOffset = 80 + selectedLevelIndex * 24;
const selectedLevelStart = Number( sourceView.getBigUint64( selectedLevelIndexOffset, true ) ) + glbImageOffset;
const selectedLevelEnd = selectedLevelStart + Number( sourceView.getBigUint64( selectedLevelIndexOffset + 8, true ) ) - 1;
assert( requestedRanges.some( range => range.start <= selectedLevelStart && range.end >= selectedLevelEnd ), 'the selected level payload is requested' );
for ( let index = 0; index < selectedLevelIndex; index ++ ) {
	const levelIndexOffset = 80 + index * 24;
	const levelStart = Number( sourceView.getBigUint64( levelIndexOffset, true ) ) + glbImageOffset;
	const levelEnd = levelStart + Number( sourceView.getBigUint64( levelIndexOffset + 8, true ) ) - 1;
	assert( requestedRanges.every( range => range.end < levelStart || range.start > levelEnd ), `mip ${index} bytes are never requested for a different selected level` );
}
console.log( 'KTX2 level extraction checks passed' );
