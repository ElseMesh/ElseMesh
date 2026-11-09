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
import { FrameUniforms, G, setFrameCamera } from '../src/engine/render/Frame.js';
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
const stablePipelineKey = material.pipelineKey();
assert.equal( material.pipelineKey(), stablePipelineKey, 'unchanged material pipeline keys reuse the same string' );
material.depthWrite = false;
const changedPipelineKey = material.pipelineKey();
assert.notEqual( changedPipelineKey, stablePipelineKey, 'direct pipeline-state changes invalidate the cached key' );
assert.equal( material.pipelineKey(), changedPipelineKey, 'the changed key is cached after invalidation' );
material.blending = { mode: 'normal' };
const objectBlendingKey = material.pipelineKey();
material.blending.mode = 'add';
assert.notEqual( material.pipelineKey(), objectBlendingKey, 'mutating object-form blending invalidates the cached key' );
assert.notEqual( material.clone().pipelineKey(), material.pipelineKey(), 'clones keep independent pipeline-key caches and identities' );
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
const cameraMatrixNames = [ 'view', 'proj', 'viewProj', 'invView', 'invProj', 'invViewProj', 'viewProjNoJitter', 'prevViewProjNoJitter' ];
const cameraMatrices = new Map( cameraMatrixNames.map( name => [ name, FrameUniforms.fields[ name ].value ] ) );
const firstView = Array.from( FrameUniforms.fields.view.value.elements );
const cameraPosition = FrameUniforms.fields.cameraPos.value;
shadows.render( scene, renderer, shadows.update( camera, G.sunDir.value ) );
const renderPass = {
	camera, colorViews: target.textures.map( texture => texture.view() ), colorFormats: target.formats,
	depthView: target.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0,
};
renderer.render( scene, renderPass );
const scratch = renderer.renderScratch[ 0 ];
const dynamicOffsets = renderer.dynamicOffsets;
const firstItem = scratch.lists.opaque[ 0 ];
const mainPassKey = [ ...scratch.preparedByPass.keys() ].find( key => key.startsWith( 'main.0.' ) );
const mainPrepared = scratch.preparedByPass.get( mainPassKey );
const firstPreparedDraw = mainPrepared.opaque[ 0 ];
const getPipeline = renderer._pipeline;
renderer._pipeline = () => firstPreparedDraw.p;
try { renderer.render( scene, { ...renderPass, late: true, clearDepth: null } ); }
finally { renderer._pipeline = getPipeline; }
const latePassKey = [ ...scratch.preparedByPass.keys() ].find( key => key.startsWith( 'main.1.' ) );
const latePrepared = scratch.preparedByPass.get( latePassKey );
const firstLatePreparedDraw = latePrepared.opaque[ 0 ];
const firstDistance = firstItem.z;
GPU.submit();
await GPU.queue.onSubmittedWorkDone();
await new Promise( resolve => setTimeout( resolve, 50 ) );

assert.ok( detailTexture, 'the material resolves its lazy detail texture' );
assert.deepEqual( errors, [], `lazy texture mip generation stays outside the render pass: ${errors.join( '; ' )}` );

camera.position.z = 4;
GPU.beginFrame();
setFrameCamera( camera, W, H );
for ( const name of cameraMatrixNames ) assert.notStrictEqual( FrameUniforms.fields[ name ].value, cameraMatrices.get( name ), `${name} camera snapshot is replaced for the new frame` );
assert.notStrictEqual( FrameUniforms.fields.cameraPos.value, cameraPosition, 'camera position snapshot is replaced for the new frame' );
assert.deepEqual( Array.from( cameraMatrices.get( 'view' ).elements ), firstView, 'the prior frame view snapshot remains unchanged after camera movement' );
assert.notDeepEqual( Array.from( FrameUniforms.fields.view.value.elements ), firstView, 'reused view matrix refreshes after camera movement' );
renderer.render( scene, renderPass );
renderer._pipeline = () => firstPreparedDraw.p;
try { renderer.render( scene, { ...renderPass, late: true, clearDepth: null } ); }
finally { renderer._pipeline = getPipeline; }
GPU.submit();
await GPU.queue.onSubmittedWorkDone();
assert.equal( renderer.renderScratch[ 0 ], scratch, 'frame scratch storage is reused' );
assert.equal( renderer.dynamicOffsets, dynamicOffsets, 'dynamic-offset storage is reused for every draw' );
assert.equal( scratch.lists.opaque[ 0 ], firstItem, 'collected draw-item records are reused' );
assert.strictEqual( mainPrepared.opaque[ 0 ], firstPreparedDraw, 'opaque pass draw records are reused across stable frames' );
assert.strictEqual( latePrepared.opaque[ 0 ], firstLatePreparedDraw, 'late pass draw records are not cleared by the main opaque pass' );
assert.notEqual( firstItem.z, firstDistance, 'reused draw-item records refresh camera-dependent distance' );
renderer._prepareItems( [ { object: {}, geometry: { attributes: {} }, material: {} } ], {}, mainPrepared.opaque );
assert.equal( mainPrepared.opaque[ 0 ], null, 'skipped items clear their prior prepared draw record' );
assert.deepEqual( errors, [], `reused renderer scratch stays valid: ${errors.join( '; ' )}` );
console.log( 'MeshRenderer prepares lazy resources and reuses frame draw-list scratch' );
GPU.device.destroy();
