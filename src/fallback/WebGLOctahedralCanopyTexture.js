function validateDataImage( image ) {
	if ( ! image || image.format !== 'rgba8unorm' || ! ( image.data instanceof Uint8Array ) || ! Number.isInteger( image.width ) || image.width < 1 || ! Number.isInteger( image.height ) || image.height < 1 || image.data.byteLength !== image.width * image.height * 4 ) throw new Error( 'Canopy texture requires validated raw RGBA8 image data' );
}

/** Create a WebGL texture with the same raw channels, clamp sampling, and mip policy as WebGPU. */
export function createWebGLOctahedralCanopyTexture( THREE, image, label ) {
	validateDataImage( image );
	const texture = new THREE.DataTexture( image.data, image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType );
	texture.name = label;
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = true;
	texture.flipY = false;
	texture.unpackAlignment = 1;
	texture.colorSpace = THREE.NoColorSpace;
	texture.premultiplyAlpha = false;
	texture.needsUpdate = true;
	return texture;
}
