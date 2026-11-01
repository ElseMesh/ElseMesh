import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const BASIS_TRANSCODER_PATH = `${ import.meta.env?.BASE_URL || '/' }basis/`;

let webGPUDecoder;

function createLoader() {
	return new KTX2Loader()
		.setTranscoderPath( BASIS_TRANSCODER_PATH )
		.setWorkerLimit( 1 );
}

export function createWebGLKTX2Loader( renderer ) {
	return createLoader().detectSupport( renderer );
}

export async function decodeKTX2( bytes ) {
	if ( globalThis.__assetKTX2 ) return globalThis.__assetKTX2( bytes );

	webGPUDecoder ||= createLoader().detectSupport( {
		// ElseMesh's WebGPU scene uses its own texture abstraction. Ask the Basis
		// transcoder for portable RGBA pixels; the engine then uploads its normal
		// mip chain through the established WebGPU path.
		isWebGPURenderer: true,
		hasFeature: () => false,
	} );

	const data = bytes instanceof Uint8Array ? bytes : new Uint8Array( bytes );
	const start = data.byteOffset;
	const input = data.buffer.slice( start, start + data.byteLength );
	const texture = await new Promise( ( resolve, reject ) => {
		webGPUDecoder.parse( input, resolve, reject );
	} );
	try {
		const mip = texture.mipmaps?.[ 0 ];
		const image = mip || texture.image;
		if ( ! image?.data || ! Number.isSafeInteger( image.width ) || ! Number.isSafeInteger( image.height ) )
			throw new Error( 'KTX2 decoder returned no base-level image data' );
		const pixels = image.data instanceof Uint8Array ? image.data : new Uint8Array( image.data );
		if ( pixels.byteLength !== image.width * image.height * 4 )
			throw new Error( `KTX2 decoder returned an unexpected base-level pixel size (${pixels.byteLength} bytes)` );
		return { data: pixels, width: image.width, height: image.height };
	} finally {
		texture.dispose?.();
	}
}
