import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';

function validateDataImage( image ) {
	if ( ! image || image.format !== 'rgba8unorm' || ! ( image.data instanceof Uint8Array ) || ! Number.isInteger( image.width ) || image.width < 1 || ! Number.isInteger( image.height ) || image.height < 1 || image.data.byteLength !== image.width * image.height * 4 ) throw new Error( 'Canopy texture requires validated raw RGBA8 image data' );
}

/** Create a GPU texture from the shared linear RGBA8 atlas or leaf-mask bytes. */
export function createWebGPUOctahedralCanopyTexture( image, label ) {
	validateDataImage( image );
	return new Texture( {
		label,
		width: image.width,
		height: image.height,
		format: 'rgba8unorm',
		data: image.data,
		mips: true,
		usage: [ 'sample', 'render', 'copyDst' ],
		sampler: 'linearClamp',
	} );
}

/** Upload level zero and create the same box-filtered mip chain used by canopy bakes. */
export function uploadWebGPUOctahedralCanopyTexture( texture ) {
	if ( ! ( texture instanceof Texture ) || texture.format !== 'rgba8unorm' || texture.mipLevelCount < 2 ) throw new Error( 'A mipmapped raw RGBA8 canopy texture is required' );
	texture.getGPU();
	generateMipmaps( texture );
	return texture;
}
