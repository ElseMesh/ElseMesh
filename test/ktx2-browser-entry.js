import { decodeKTX2 } from '../src/engine/loaders/KTX2.js';

const result = document.querySelector( '#result' );

try {
	const response = await fetch( '/test/fixtures/ktx2-checker.ktx2' );
	if ( ! response.ok ) throw new Error( `fixture request failed: ${response.status}` );
	const image = await decodeKTX2( new Uint8Array( await response.arrayBuffer() ) );
	if ( image.width !== 16 || image.height !== 16 ) throw new Error( `unexpected dimensions ${image.width}x${image.height}` );
	if ( image.data.length !== 16 * 16 * 4 ) throw new Error( `unexpected RGBA byte count ${image.data.length}` );
	const pixel = ( x, y ) => Array.from( image.data.subarray( ( y * image.width + x ) * 4, ( y * image.width + x ) * 4 + 4 ) );
	const green = pixel( 1, 1 );
	const red = pixel( 5, 1 );
	if ( green[ 1 ] < 160 || red[ 0 ] < 160 || Math.abs( green[ 1 ] - red[ 1 ] ) < 80 )
		throw new Error( `transcoded checker colors are wrong: ${JSON.stringify( { green, red } )}` );
	if ( green[ 3 ] < 240 || red[ 3 ] < 240 ) throw new Error( `transcoded alpha is wrong: ${JSON.stringify( { green, red } )}` );
	result.dataset.status = 'passed';
	result.textContent = JSON.stringify( { width: image.width, height: image.height, green, red } );
} catch ( error ) {
	result.dataset.status = 'failed';
	result.textContent = error.stack || String( error );
}
