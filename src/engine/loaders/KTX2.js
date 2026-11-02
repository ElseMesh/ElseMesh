import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import {
	HalfFloatType,
	RGB_BPTC_SIGNED_Format,
	RGB_BPTC_UNSIGNED_Format,
	RGBA_BPTC_Format,
	RGBAFormat,
	SRGBColorSpace,
} from 'three';
import { GPU } from '../gpu/GPU.js';

const BASIS_TRANSCODER_PATH = `${ import.meta.env?.BASE_URL || '/' }basis/`;

let webGPUDecoder;
let webGPUDecoderSupportsBC = false;
let webGPUFallbackDecoder;

function createLoader() {
	return new KTX2Loader()
		.setTranscoderPath( BASIS_TRANSCODER_PATH )
		.setWorkerLimit( 1 );
}

export function createWebGLKTX2Loader( renderer ) {
	return createLoader().detectSupport( renderer );
}

export function canUploadBCTexture( width, height ) {
	return width >= 4 && height >= 4 && width % 4 === 0 && height % 4 === 0;
}

export async function decodeKTX2( bytes ) {
	if ( globalThis.__assetKTX2 ) return globalThis.__assetKTX2( bytes );

	const supportsBC = GPU.features.has( 'texture-compression-bc' );
	if ( ! webGPUDecoder || webGPUDecoderSupportsBC !== supportsBC ) {

		webGPUDecoderSupportsBC = supportsBC;
		webGPUDecoder = createLoader().detectSupport( {
			// ElseMesh owns WebGPU texture uploads; request BC when the device can
			// sample it, and retain the loader's RGBA fallback for other adapters.
			isWebGPURenderer: true,
			hasFeature: feature => feature === 'texture-compression-bc' && supportsBC,
		} );

	}

	const data = bytes instanceof Uint8Array ? bytes : new Uint8Array( bytes );
	const sourceHeader = data.byteLength >= 80 ? new DataView( data.buffer, data.byteOffset, data.byteLength ) : null;
	const singleLevelDimensions = sourceHeader?.getUint32( 40, true ) === 1
		? { width: sourceHeader.getUint32( 20, true ), height: sourceHeader.getUint32( 24, true ) }
		: null;
	const start = data.byteOffset;
	const input = data.buffer.slice( start, start + data.byteLength );
	let texture = await new Promise( ( resolve, reject ) => {
		webGPUDecoder.parse( input, resolve, reject );
	} );
	try {
		const format = texture.format === RGBA_BPTC_Format
			? ( texture.colorSpace === SRGBColorSpace ? 'bc7-rgba-unorm-srgb' : 'bc7-rgba-unorm' )
			: texture.format === RGB_BPTC_UNSIGNED_Format ? 'bc6h-rgb-ufloat'
				: texture.format === RGB_BPTC_SIGNED_Format ? 'bc6h-rgb-float'
					: null;
		if ( format ) {
			// WebGPU requires BC texture dimensions and write extents to align to 4x4
			// blocks. Tiny or non-aligned images therefore use the RGBA path.
			if ( ! canUploadBCTexture( texture.image.width, texture.image.height ) ) {

				texture.dispose?.();
				webGPUFallbackDecoder ||= createLoader().detectSupport( { isWebGPURenderer: true, hasFeature: () => false } );
				const fallbackInput = data.buffer.slice( data.byteOffset, data.byteOffset + data.byteLength );
				texture = await new Promise( ( resolve, reject ) => webGPUFallbackDecoder.parse( fallbackInput, resolve, reject ) );

			} else {

				const mipmaps = [];
				for ( let index = 0; index < texture.mipmaps.length; index ++ ) {

					const mip = texture.mipmaps[ index ];
					if ( ! canUploadBCTexture( mip.width, mip.height ) ) break;

					const mipData = mip.data instanceof Uint8Array ? mip.data : new Uint8Array( mip.data );
					const expected = Math.ceil( mip.width / 4 ) * Math.ceil( mip.height / 4 ) * 16;
					if ( mipData.byteLength !== expected ) throw new Error( `KTX2 ${format} mip ${ index } has ${ mipData.byteLength } bytes; expected ${ expected }` );
					mipmaps.push( { data: mipData, width: mip.width, height: mip.height } );

				}
				if ( ! mipmaps.length ) throw new Error( 'KTX2 decoder returned no BC7 mip levels' );
				return { format, mipmaps, width: mipmaps[ 0 ].width, height: mipmaps[ 0 ].height };

			}

		}

		const mip = texture.mipmaps?.[ 0 ];
		const image = mip || texture.image;
		if ( ! image?.data || ! Number.isSafeInteger( image.width ) || ! Number.isSafeInteger( image.height ) )
			throw new Error( 'KTX2 decoder returned no base-level image data' );
		let width = image.width, height = image.height;
		if ( texture.format === RGBAFormat && texture.type === HalfFloatType ) {
			const source = image.data;
			const buffer = source instanceof ArrayBuffer ? source : source.buffer;
			const byteOffset = source instanceof ArrayBuffer ? 0 : source.byteOffset;
			const byteLength = source.byteLength;
			const halfPixels = new Uint16Array( buffer, byteOffset, byteLength / 2 );
			if ( halfPixels.byteLength !== width * height * 8 && singleLevelDimensions && halfPixels.byteLength === singleLevelDimensions.width * singleLevelDimensions.height * 8 ) {
				width = singleLevelDimensions.width;
				height = singleLevelDimensions.height;
			}
			if ( halfPixels.byteLength !== width * height * 8 ) throw new Error( `KTX2 decoder returned an unexpected RGBA16F byte size (${halfPixels.byteLength} bytes)` );
			return { data: halfPixels, width, height, format: 'rgba16float' };
		}
		const pixels = image.data instanceof Uint8Array ? image.data : new Uint8Array( image.data );
		if ( pixels.byteLength !== width * height * 4 && singleLevelDimensions && pixels.byteLength === singleLevelDimensions.width * singleLevelDimensions.height * 4 ) {
			width = singleLevelDimensions.width;
			height = singleLevelDimensions.height;
		}
		if ( pixels.byteLength !== width * height * 4 )
			throw new Error( `KTX2 decoder returned an unexpected base-level pixel size (${pixels.byteLength} bytes for ${width}x${height})` );
		return { data: pixels, width, height };
	} finally {
		texture.dispose?.();
	}
}
