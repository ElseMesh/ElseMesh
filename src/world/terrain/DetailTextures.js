import { Texture } from '../../engine/gpu/Texture.js';
import { generateMipmaps } from '../../engine/gpu/Mipmaps.js';
import { getDetailImage } from './DetailTextureData.js';

export { getDetailImage };

let cached = null;

export function getDetailTexture( { cpuOnly = false } = {} ) {

	const image = getDetailImage();
	if ( cpuOnly ) return image;
	if ( cached ) return cached;
	const started = performance.now();
	const texture = new Texture( { label: 'terrainDetail', width: image.width, height: image.height, format: 'rgba8unorm', mips: true, usage: [ 'sample', 'copyDst' ], sampler: 'aniso4Repeat', data: image.data } );
	texture.getGPU();
	generateMipmaps( texture );
	texture.userData = {};
	texture.image = image;
	texture.userData.ms = performance.now() - started;
	cached = texture;
	return texture;

}
