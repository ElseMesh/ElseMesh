import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Group } from '../src/engine/scene/Group.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { disposeWorldPackage } from '../src/network/WorldPackage.js';
import { Texture } from '../src/engine/gpu/Texture.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT } from '../src/network/StaticModelInstanceSet.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';

await import( '../src/network/WebGPUWorldComponentAdapters.js' );
await import( '../src/fallback/WebGLComponentSupport.js' );

const hash = bytes => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
async function waitFor( predicate, message ) {
	const deadline = Date.now() + 3000;
	while ( Date.now() < deadline ) {
		if ( predicate() ) return;
		await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	assert.ok( predicate(), message );
}
const detailFieldGraph = {
	format: 'elsemesh.material-graph/1',
	nodes: [
		{ id: 'position', op: 'input', name: 'position' },
		{ id: 'x', op: 'x', args: [ 'position' ] }, { id: 'y', op: 'y', args: [ 'position' ] },
		{ id: 'uv', op: 'vec2', args: [ 'x', 'y' ] }, { id: 'lod', op: 'constant', value: 0 },
		{ id: 'detail', op: 'textureSampleLevel', slot: 'detailField', uv: 'uv', lod: 'lod' },
		{ id: 'red', op: 'x', args: [ 'detail' ] }, { id: 'scale', op: 'constant', value: 0.05 },
		{ id: 'offsetX', op: 'multiply', args: [ 'red', 'scale' ] }, { id: 'zero', op: 'constant', value: 0 },
		{ id: 'offset', op: 'vec3', args: [ 'offsetX', 'zero', 'zero' ] },
		{ id: 'moved', op: 'add', args: [ 'position', 'offset' ] },
		{ id: 'albedo', op: 'rgb', args: [ 'detail' ] },
	],
	outputs: { baseColor: 'albedo', vertexPosition: 'moved' },
};
const glbBytes = staticModelGLB( {
	nodeScale: [ -1, 1, 1 ],
	materialExtras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', graph: detailFieldGraph } },
} ), modelAssetID = hash( glbBytes ), fineModelAssetID = `sha256:${'f'.repeat( 64 )}`;
const document = {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ { id: 'fixture-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: false, lods: [ { assetId: fineModelAssetID }, { assetId: modelAssetID } ], lodThresholds: [ 0.1 ], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLodBias: 0, shadowMaxDistance: 40, drawMaxDistance: 90, drawFadeStartDistance: 90 } ],
	instances: [ { model: 'fixture-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0.25, 0.5, 0.75, 1, 2, 3, 4, 5 ] } ],
};
const setBytes = new TextEncoder().encode( JSON.stringify( document ) ), setAssetID = hash( setBytes );
const component = { id: 'fixture-static-models', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: modelAssetID, kind: 'glb' }, { assetId: fineModelAssetID, kind: 'glb' } ] };
const requestedAssets = [];
let releaseFineAsset;
const connector = {
	manifest: { assets: [ { id: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { id: modelAssetID, kind: 'glb' }, { id: fineModelAssetID, kind: 'glb' } ] },
	assets: new Map( [ [ setAssetID, setBytes ] ] ),
	getAsset: async assetId => {
		requestedAssets.push( assetId );
		assert.ok( [ modelAssetID, fineModelAssetID ].includes( assetId ) );
		if ( assetId === fineModelAssetID ) return new Promise( resolve => { releaseFineAsset = () => resolve( glbBytes ); } );
		return glbBytes;
	},
};
const camera = new PerspectiveCamera( 60, 1, 0.1, 100 );
camera.lookAt( 0, 0, - 1 );

const webgpuRoot = new Group();
webgpuRoot.userData.worldPackage = { parsed: new Map(), loadedObjects: new Set(), connector, materialAdapterContexts: new Map() };
const webgpuDetailField = new Texture( { label: 'static-model-detail-field-fixture', width: 1, height: 1, format: 'rgba8unorm', data: Uint8Array.from( [ 64, 128, 192, 255 ] ), sampler: 'linearRepeat' } );
const webgpuInstall = worldComponentBackendAdapter( 'webgpu', component.type );
assert.equal( typeof webgpuInstall, 'function' );
const webgpuResult = await webgpuInstall( { root: webgpuRoot, connector, installed: [ { terrainSurface: true, terrainGPU: { detailTexture: webgpuDetailField } } ] }, component );
assert.equal( webgpuResult.installed, true );
assert.deepEqual( requestedAssets, [], 'installing the placement descriptor does not fetch offscreen model assets' );
assert.equal( webgpuResult.runtime.isCoarseReadyForView(), false, 'the visible model waits for its coarse mesh' );
webgpuResult.runtime.update( 1 / 60, camera );
await new Promise( resolve => setTimeout( resolve, 10 ) );
assert.deepEqual( requestedAssets, [ modelAssetID ], 'the current view requests only the coarse model first' );
await waitFor( () => webgpuResult.runtime.isCoarseReadyForView(), 'the WebGPU coarse model finishes installing' );
webgpuResult.runtime.update( 1 / 60, camera );
assert.ok( webgpuRoot.children.filter( mesh => mesh.isInstancedMesh ).every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'static WebGPU batches freeze their world transforms' );
const cachedFineBatchAttributes = webgpuResult.runtime._batchAttributeGroups[ 0 ];
await waitFor( () => typeof releaseFineAsset === 'function', 'WebGPU starts the finer request asynchronously' );
assert.ok( webgpuRoot.children.some( mesh => mesh.isInstancedMesh && ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the coarse WebGPU model stays visible while refinement is pending' );
releaseFineAsset();
await new Promise( resolve => setTimeout( resolve, 10 ) );
assert.deepEqual( requestedAssets, [ modelAssetID, fineModelAssetID ], 'projected-size demand requests the finer model only after installation' );
webgpuResult.runtime.update( 1 / 60, camera );
assert.notEqual( webgpuResult.runtime._batchAttributeGroups[ 0 ], cachedFineBatchAttributes, 'streaming a finer LOD rebuilds only its cached batch attributes' );
assert.equal( webgpuResult.runtime._batchAttributeGroups[ 0 ].batches, webgpuResult.runtime.batches[ 0 ], 'the refreshed cache points at the newly installed LOD batch' );
const webgpuMeshes = [];
webgpuRoot.traverse( object => { if ( object.isInstancedMesh ) webgpuMeshes.push( object ); } );
const webgpuMain = webgpuMeshes.find( mesh => ! mesh.userData.shadowOnly );
const webgpuShadow = webgpuMeshes.find( mesh => mesh.userData.shadowOnly && mesh.count > 0 );
assert.ok( webgpuMeshes.some( mesh => ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the requested fine WebGPU model becomes active after it loads' );
assert.ok( webgpuMeshes.every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'newly streamed WebGPU LOD batches also freeze their world transforms' );
assert.equal( webgpuShadow.count, 1 );
assert.equal( webgpuMain.geometry.getAttribute( 'position' ).getX( 0 ), 2.5, 'negative-scale GLB nodes retain their reflected geometry positions' );
assert.deepEqual( [ webgpuMain.geometry.getIndex().getX( 0 ), webgpuMain.geometry.getIndex().getX( 1 ), webgpuMain.geometry.getIndex().getX( 2 ) ], [ 0, 2, 1 ], 'baking a negative-scale GLB node reverses winding for the WebGPU rasterizer' );
assert.deepEqual( [ webgpuShadow.geometry.getIndex().getX( 0 ), webgpuShadow.geometry.getIndex().getX( 1 ), webgpuShadow.geometry.getIndex().getX( 2 ) ], [ 0, 2, 1 ], 'WebGPU shadow geometry uses the corrected reflected winding' );
assert.equal( webgpuMain.geometry.getAttribute( 'iStaticFade' ).array[ 0 ], 1 );
assert.equal( webgpuMain.geometry.getAttribute( 'iStaticFade' ).itemSize, 4, 'shared adapter fade data carries LOD and draw-distance fades' );
assert.deepEqual( Array.from( webgpuMain.geometry.getAttribute( 'iStaticMaterialData0' ).array ), [ 0.25, 0.5, 0.75, 1 ], 'WebGPU exposes opaque material-profile data in the first instanced vec4' );
assert.deepEqual( Array.from( webgpuMain.geometry.getAttribute( 'iStaticMaterialData1' ).array ), [ 2, 3, 4, 5 ], 'WebGPU exposes opaque material-profile data in the second instanced vec4' );
assert.equal( webgpuMain.material.attributes.iStaticMaterialData0, 'vec4f', 'WebGPU material profiles can bind opaque per-instance data' );
assert.match( webgpuMain.material.vertex, /v\.iStaticMaterialData0/ );
assert.equal( webgpuMain.material.bindings.emgTexture_detailField.texture, webgpuDetailField, 'the WebGPU static-model adapter binds the installed terrain detail texture to material graphs' );
assert.match( webgpuMain.material.vertex, /textureSampleLevel\( emgTexture_detailField, smpLinearRepeat,/ );
assert.equal( webgpuShadow.geometry.getAttribute( 'iStaticFade' ).array[ 1 ], 0, 'shadow-only instances remain fully visible with complementary fade enabled' );
const farWebGPUCamera = new PerspectiveCamera( 60, 1, 0.1, 200 );
farWebGPUCamera.position.set( 0, 0, 25 );
farWebGPUCamera.lookAt( 0, 0, - 5 );
webgpuResult.runtime.update( 1 / 60, farWebGPUCamera );
assert.equal( webgpuResult.runtime.planner.shadowGroups[ 1 ].count, 1, 'WebGPU casts the same instance through the coarser shadow LOD as the camera recedes' );
webgpuResult.runtime.dispose();
disposeWorldPackage( webgpuRoot );
webgpuDetailField.destroy();
assert.equal( webgpuRoot.children.length, 0 );

const webglFallback = { THREE, connector, loader: new GLTFLoader(), scene: new THREE.Scene(), app: { renderLoadBias: 1 } };
const webglDetailField = new THREE.DataTexture( Uint8Array.from( [ 64, 128, 192, 255 ] ), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType );
webglDetailField.wrapS = webglDetailField.wrapT = THREE.RepeatWrapping;
webglDetailField.colorSpace = THREE.NoColorSpace;
webglDetailField.needsUpdate = true;
webglFallback.beachDetailTexture = webglDetailField;
const webglInstall = worldComponentBackendAdapter( 'webgl', component.type );
assert.equal( typeof webglInstall, 'function' );
const webglResult = await webglInstall( { fallback: webglFallback }, component );
assert.equal( webglResult.installed, true );
assert.equal( requestedAssets.filter( id => id === modelAssetID ).length, 1, 'the WebGL placement descriptor does not eagerly fetch model GLBs' );
webglResult.runtime.update( 1 / 60, new THREE.PerspectiveCamera( 60, 1, 0.1, 100 ), null, 0.025 );
await new Promise( resolve => setTimeout( resolve, 10 ) );
assert.equal( requestedAssets.filter( id => id === modelAssetID ).length, 2, 'the WebGL view requests the visible coarse model' );
await waitFor( () => webglResult.runtime.isCoarseReadyForView(), 'the WebGL coarse model finishes installing' );
webglResult.runtime.update( 1 / 60, new THREE.PerspectiveCamera( 60, 1, 0.1, 100 ) );
assert.ok( webglFallback.scene.children.filter( mesh => mesh.isInstancedMesh ).every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'static WebGL batches freeze their world transforms' );
releaseFineAsset = undefined;
await waitFor( () => typeof releaseFineAsset === 'function', 'WebGL starts the finer request asynchronously' );
assert.ok( webglFallback.scene.children.some( mesh => mesh.isInstancedMesh && ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the coarse WebGL model stays visible while refinement is pending' );
releaseFineAsset();
await new Promise( resolve => setTimeout( resolve, 10 ) );
assert.equal( requestedAssets.filter( id => id === fineModelAssetID ).length, 2, 'WebGL also requests finer models only after view demand' );
webglResult.runtime.update( 1 / 60, new THREE.PerspectiveCamera( 60, 1, 0.1, 100 ) );
const webglMeshes = webglFallback.scene.children.filter( object => object.isInstancedMesh );
const webglMain = webglMeshes.find( mesh => ! mesh.userData.shadowOnly );
const webglShadow = webglMeshes.find( mesh => mesh.userData.shadowOnly && mesh.count > 0 );
assert.ok( webglMeshes.some( mesh => ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the requested fine WebGL model becomes active after it loads' );
assert.ok( webglMeshes.every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'newly streamed WebGL LOD batches also freeze their world transforms' );
assert.ok( webglShadow, 'WebGL submits a separate batch for the shared authored shadow LOD' );
assert.equal( webglMain.castShadow, false, 'the WebGL color LOD does not duplicate the shared shadow batch' );
assert.equal( webglMain.customDepthMaterial, null, 'the selected color LOD does not allocate an unused shadow material' );
assert.equal( webglShadow.castShadow, true, 'the selected WebGL shadow LOD casts shadows' );
assert.equal( webglShadow.receiveShadow, false, 'the WebGL shadow-only LOD does not receive duplicate shadows' );
assert.equal( webglShadow.material.colorWrite, false, 'the WebGL shadow LOD does not write color' );
assert.equal( webglShadow.material.depthWrite, false, 'the WebGL shadow LOD does not occlude the color pass' );
assert.ok( webglShadow.customDepthMaterial, 'the selected shadow LOD uses its fade-aware depth material' );
assert.equal( webglResult.runtime.usesShadowBatches, true, 'WebGL uses the shared independent shadow selection' );
assert.equal( webglResult.runtime.planner.shadowGroups[ 0 ].count, 1, 'WebGL selects the same shadow instance independently of color visibility' );
const farWebGLCamera = new THREE.PerspectiveCamera( 60, 1, 0.1, 200 );
farWebGLCamera.position.set( 0, 0, 25 );
farWebGLCamera.lookAt( 0, 0, - 5 );
webglResult.runtime.update( 1 / 60, farWebGLCamera );
assert.equal( webglResult.runtime.planner.shadowGroups[ 1 ].count, 1, 'WebGL casts the same instance through the matching coarser shadow LOD' );
assert.equal( webglMain.geometry.getAttribute( 'position' ).getX( 0 ), 2.5, 'the WebGL batch retains reflected GLB node geometry positions' );
assert.deepEqual( [ webglMain.geometry.getIndex().getX( 0 ), webglMain.geometry.getIndex().getX( 1 ), webglMain.geometry.getIndex().getX( 2 ) ], [ 0, 2, 1 ], 'baking a negative-scale GLB node reverses winding for the WebGL rasterizer' );
assert.equal( webglMain.geometry.getAttribute( 'iStaticFade' ).array[ 0 ], 1 );
assert.equal( webglMain.geometry.getAttribute( 'iStaticFade' ).itemSize, 4, 'WebGL uses the shared four-channel fade policy' );
assert.deepEqual( Array.from( webglMain.geometry.getAttribute( 'iStaticMaterialData0' ).array ), [ 0.25, 0.5, 0.75, 1 ], 'WebGL exposes the same opaque material-profile data as WebGPU' );
assert.deepEqual( Array.from( webglMain.geometry.getAttribute( 'iStaticMaterialData1' ).array ), [ 2, 3, 4, 5 ], 'WebGL exposes the second material-profile vec4' );
assert.match( webglMain.material.customProgramCacheKey(), /static-instance-fade-v1\+material-data-v1/ );
const webglShader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
webglMain.material.onBeforeCompile( webglShader, {} );
assert.match( webglShader.vertexShader, /textureLod\( emgTexture_detailField,/ );
assert.equal( webglShader.uniforms.emgTexture_detailField.value, webglDetailField, 'the WebGL static-model adapter binds the installed terrain detail texture to material graphs' );
webglResult.runtime.dispose();
webglDetailField.dispose();
assert.equal( webglFallback.scene.children.length, 0 );

const transparentModelBytes = staticModelGLB( { materialAlpha: 0 } );
const transparentModelAssetID = hash( transparentModelBytes );
const transparentDocumentBytes = new TextEncoder().encode( JSON.stringify( {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ { id: 'transparent-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: false, lods: [ { assetId: transparentModelAssetID } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLodBias: 0, shadowMaxDistance: 20, drawMaxDistance: 90, drawFadeStartDistance: 90 } ],
	instances: [ { model: 'transparent-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
} ) );
const transparentDocumentAssetID = hash( transparentDocumentBytes );
const transparentComponent = {
	id: 'fixture-transparent-static-model', type: component.type,
	assets: [ { assetId: transparentDocumentAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: transparentModelAssetID, kind: 'glb' } ],
};
const transparentAssets = new Map( [ [ transparentDocumentAssetID, transparentDocumentBytes ], [ transparentModelAssetID, transparentModelBytes ] ] );
const transparentConnector = {
	manifest: { assets: transparentComponent.assets.map( asset => ( { id: asset.assetId, kind: asset.kind } ) ) },
	assets: new Map( [ [ transparentDocumentAssetID, transparentDocumentBytes ] ] ),
	getAsset: async assetId => transparentAssets.get( assetId ),
};
const transparentWebGPU = new Group();
transparentWebGPU.userData.worldPackage = { parsed: new Map(), loadedObjects: new Set(), connector: transparentConnector, materialAdapterContexts: new Map() };
const transparentWebGPUResult = await worldComponentBackendAdapter( 'webgpu', component.type )( { root: transparentWebGPU, connector: transparentConnector }, transparentComponent );
assert.equal( transparentWebGPUResult.installed, true );
assert.equal( transparentWebGPU.children.some( object => object.isInstancedMesh ), false, 'fully transparent WebGPU static meshes create neither color nor shadow draws' );
transparentWebGPUResult.runtime.dispose();
disposeWorldPackage( transparentWebGPU );

const transparentWebGL = { THREE, connector: transparentConnector, loader: new GLTFLoader(), scene: new THREE.Scene(), app: { renderLoadBias: 0 } };
const transparentWebGLResult = await worldComponentBackendAdapter( 'webgl', component.type )( { fallback: transparentWebGL }, transparentComponent );
assert.equal( transparentWebGLResult.installed, true );
assert.equal( transparentWebGL.scene.children.some( object => object.isInstancedMesh ), false, 'fully transparent WebGL static meshes create neither color nor shadow draws' );
transparentWebGLResult.runtime.dispose();

console.log( 'generic static model component installs and updates through WebGPU and WebGL adapters' );
