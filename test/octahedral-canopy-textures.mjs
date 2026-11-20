import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWebGPUOctahedralCanopyTexture } from '../src/network/WebGPUOctahedralCanopyTexture.js';
import { createWebGLOctahedralCanopyTexture } from '../src/fallback/WebGLOctahedralCanopyTexture.js';

const data = Uint8Array.from( [ 1, 2, 3, 4, 17, 18, 19, 20, 33, 34, 35, 36, 49, 50, 51, 52 ] );
const image = { data, width: 2, height: 2, format: 'rgba8unorm', sampler: 'linearClamp' };

const webgpu = createWebGPUOctahedralCanopyTexture( image, 'fixture.atlas' );
assert.equal( webgpu.format, 'rgba8unorm', 'WebGPU uploads raw linear RGBA8 without an sRGB format' );
assert.equal( webgpu.sampler, 'linearClamp' );
assert.equal( webgpu.mipLevelCount, 2, 'WebGPU creates a full box-filterable mip chain' );
assert.equal( webgpu.pendingData, data, 'WebGPU preserves the shared decoded bytes for upload' );

const webgl = createWebGLOctahedralCanopyTexture( THREE, image, 'fixture.atlas' );
assert.equal( webgl.name, 'fixture.atlas' );
assert.equal( webgl.image.data, data, 'WebGL uploads the same decoded byte array without copying or channel conversion' );
assert.equal( webgl.colorSpace, THREE.NoColorSpace, 'WebGL treats atlas channels as linear data' );
assert.equal( webgl.premultiplyAlpha, false );
assert.equal( webgl.flipY, false, 'both backends retain the same top-row-first decoded atlas layout' );
assert.equal( webgl.unpackAlignment, 1 );
assert.equal( webgl.generateMipmaps, true );
assert.equal( webgl.minFilter, THREE.LinearMipmapLinearFilter );
assert.equal( webgl.magFilter, THREE.LinearFilter );
assert.equal( webgl.wrapS, THREE.ClampToEdgeWrapping );
assert.equal( webgl.wrapT, THREE.ClampToEdgeWrapping );
webgl.dispose();
webgpu.destroy();

assert.throws( () => createWebGPUOctahedralCanopyTexture( { ...image, format: 'rgba8unorm-srgb' }, 'invalid' ), /validated raw RGBA8/ );
assert.throws( () => createWebGLOctahedralCanopyTexture( THREE, { ...image, data: new Uint8Array( 3 ) }, 'invalid' ), /validated raw RGBA8/ );

console.log( 'canopy WebGPU and WebGL textures preserve identical raw linear RGBA8 atlas inputs' );
