import assert from 'node:assert/strict';
import './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { Texture, RenderTarget } from '../src/engine/gpu/Texture.js';
import { generateMipmaps } from '../src/engine/gpu/Mipmaps.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { Mesh } from '../src/engine/scene/Mesh.js';
import { PlaneGeometry } from '../src/engine/geometry/PrimitiveGeometries.js';
import { Scene } from '../src/engine/scene/Scene.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { G, setFrameCamera } from '../src/engine/render/Frame.js';
import { SunShadows } from '../src/engine/render/Shadows.js';

await GPU.init( { headless: true } );
const errors = [];
GPU.device.addEventListener( 'uncapturederror', event => errors.push( event.error?.message || 'unknown GPU error' ) );

const W = 64, H = 64;
const scene = new Scene();
const camera = new PerspectiveCamera( 55, W / H, 0.1, 100 );
camera.position.set( 0, 0, 3 );
camera.lookAt( 0, 0, 0 );
const target = new RenderTarget( W, H, { colors: [ 'rgba16float', 'rgba16float', 'rgba8unorm' ], depth: 'depth32float', label: 'resource-preparation' } );
const material = new Material( {
	name: 'resource-preparation',
} );
scene.add( new Mesh( new PlaneGeometry( 2, 2 ), material ) );

const renderer = new MeshRenderer();
const shadows = new SunShadows();
G.sunDir.value.set( 0.45, 0.62, 0.35 ).normalize();
const preparePipeline = renderer._pipeline.bind( renderer );
let detailTexture = null;
renderer._pipeline = ( ...args ) => {
	const pipeline = preparePipeline( ...args );
	if ( ! detailTexture ) {
		detailTexture = new Texture( { width: 4, height: 4, format: 'rgba8unorm', mips: true, data: new Uint8Array( 4 * 4 * 4 ).fill( 255 ) } );
		detailTexture.getGPU();
		generateMipmaps( detailTexture );
	}
	return pipeline;
};

GPU.beginFrame();
setFrameCamera( camera, W, H );
shadows.render( scene, renderer, shadows.update( camera, G.sunDir.value ) );
renderer.render( scene, {
	camera, colorViews: target.textures.map( texture => texture.view() ), colorFormats: target.formats,
	depthView: target.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0,
} );
GPU.submit();
await GPU.queue.onSubmittedWorkDone();
await new Promise( resolve => setTimeout( resolve, 50 ) );

assert.ok( detailTexture, 'the material resolves its lazy detail texture' );
assert.deepEqual( errors, [], `lazy texture mip generation stays outside the render pass: ${errors.join( '; ' )}` );
console.log( 'MeshRenderer prepares lazy GPU resources before opening a render pass' );
GPU.device.destroy();
