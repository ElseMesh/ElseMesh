import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractKTX2Level } from '../src/engine/loaders/KTX2Level.js';

const source = new Uint8Array( readFileSync( new URL( './fixtures/ktx2-checker.ktx2', import.meta.url ) ) );
const sourceView = new DataView( source.buffer, source.byteOffset, source.byteLength );
const levelCount = sourceView.getUint32( 40, true );
assert( levelCount > 1, 'fixture has multiple independently indexed levels' );

for ( const index of [ 0, levelCount - 1 ] ) {
	const extracted = extractKTX2Level( source, index );
	const view = new DataView( extracted.buffer, extracted.byteOffset, extracted.byteLength );
	assert.equal( view.getUint32( 40, true ), 1, 'extracted KTX2 contains one image level' );
	assert.equal( view.getUint32( 20, true ), Math.max( 1, sourceView.getUint32( 20, true ) >> index ) );
	assert.equal( view.getUint32( 24, true ), Math.max( 1, sourceView.getUint32( 24, true ) >> index ) );
	const sourceIndex = 80 + index * 24;
	const sourceOffset = Number( sourceView.getBigUint64( sourceIndex, true ) );
	const sourceLength = Number( sourceView.getBigUint64( sourceIndex + 8, true ) );
	const outputOffset = Number( view.getBigUint64( 80, true ) );
	const outputLength = Number( view.getBigUint64( 88, true ) );
	assert.equal( outputLength, sourceLength, 'selected mip payload length is preserved' );
	assert.deepEqual( extracted.subarray( outputOffset, outputOffset + outputLength ), source.subarray( sourceOffset, sourceOffset + sourceLength ), 'output carries only the selected mip payload' );
	assert( extracted.byteLength < source.byteLength, 'single-level container is smaller than the full mip pyramid' );
}

assert.throws( () => extractKTX2Level( source, levelCount ), RangeError );
assert.throws( () => extractKTX2Level( source.subarray( 0, 32 ), 0 ), /truncated/ );
console.log( 'KTX2 level extraction checks passed' );
