import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Group } from '../src/engine/scene/Group.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { disposeWorldPackage } from '../src/network/WorldPackage.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT } from '../src/network/StaticModelInstanceSet.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';

await import( '../src/network/WebGPUWorldComponentAdapters.js' );
await import( '../src/fallback/WebGLComponentSupport.js' );

const hash = bytes => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const glbBytes = staticModelGLB(), modelAssetID = hash( glbBytes ), fineModelAssetID = `sha256:${'f'.repeat( 64 )}`;
const document = {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ { id: 'fixture-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, lods: [ { assetId: modelAssetID }, { assetId: fineModelAssetID } ], lodThresholds: [ 0.001 ], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 20, drawMaxDistance: 90, drawFadeStartDistance: 90 } ],
	instances: [ { model: 'fixture-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
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
const webgpuInstall = worldComponentBackendAdapter( 'webgpu', component.type );
assert.equal( typeof webgpuInstall, 'function' );
const webgpuResult = await webgpuInstall( { root: webgpuRoot, connector }, component );
assert.equal( webgpuResult.installed, true );
assert.deepEqual( requestedAssets, [ modelAssetID ], 'installation fetches only coarse model assets' );
assert.ok( webgpuRoot.children.filter( mesh => mesh.isInstancedMesh ).every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'static WebGPU batches freeze their world transforms' );
webgpuResult.runtime.update( 1 / 60, camera );
const cachedFineBatchAttributes = webgpuResult.runtime._batchAttributeGroups[ 1 ];
await new Promise( resolve => setTimeout( resolve, 0 ) );
assert.equal( typeof releaseFineAsset, 'function', 'WebGPU starts the finer request asynchronously' );
assert.ok( webgpuRoot.children.some( mesh => mesh.isInstancedMesh && ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the coarse WebGPU model stays visible while refinement is pending' );
releaseFineAsset();
await new Promise( resolve => setTimeout( resolve, 10 ) );
assert.deepEqual( requestedAssets, [ modelAssetID, fineModelAssetID ], 'projected-size demand requests the finer model only after installation' );
webgpuResult.runtime.update( 1 / 60, camera );
assert.notEqual( webgpuResult.runtime._batchAttributeGroups[ 1 ], cachedFineBatchAttributes, 'streaming a finer LOD rebuilds only its cached batch attributes' );
assert.equal( webgpuResult.runtime._batchAttributeGroups[ 1 ].batches, webgpuResult.runtime.batches[ 1 ], 'the refreshed cache points at the newly installed LOD batch' );
const webgpuMeshes = [];
webgpuRoot.traverse( object => { if ( object.isInstancedMesh ) webgpuMeshes.push( object ); } );
const webgpuMain = webgpuMeshes.find( mesh => ! mesh.userData.shadowOnly );
const webgpuShadow = webgpuMeshes.find( mesh => mesh.userData.shadowOnly );
assert.ok( webgpuMeshes.some( mesh => ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the requested fine WebGPU model becomes active after it loads' );
assert.ok( webgpuMeshes.every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'newly streamed WebGPU LOD batches also freeze their world transforms' );
assert.equal( webgpuShadow.count, 1 );
assert.equal( webgpuMain.geometry.getAttribute( 'position' ).getX( 0 ), 1.5, 'GLB node translation is baked into the cloned primitive geometry' );
assert.equal( webgpuMain.geometry.getAttribute( 'iStaticFade' ).array[ 0 ], 1 );
assert.equal( webgpuMain.geometry.getAttribute( 'iStaticFade' ).itemSize, 4, 'shared adapter fade data carries LOD and draw-distance fades' );
assert.equal( webgpuShadow.geometry.getAttribute( 'iStaticFade' ).array[ 1 ], 0, 'shadow-only instances remain fully visible with complementary fade enabled' );
webgpuResult.runtime.dispose();
disposeWorldPackage( webgpuRoot );
assert.equal( webgpuRoot.children.length, 0 );

const webglFallback = { THREE, connector, loader: new GLTFLoader(), scene: new THREE.Scene() };
const webglInstall = worldComponentBackendAdapter( 'webgl', component.type );
assert.equal( typeof webglInstall, 'function' );
const webglResult = await webglInstall( { fallback: webglFallback }, component );
assert.equal( webglResult.installed, true );
assert.ok( webglFallback.scene.children.filter( mesh => mesh.isInstancedMesh ).every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'static WebGL batches freeze their world transforms' );
assert.equal( requestedAssets.filter( id => id === modelAssetID ).length, 2, 'the WebGL renderer begins by requesting its coarse model' );
releaseFineAsset = undefined;
webglResult.runtime.update( 1 / 60, new THREE.PerspectiveCamera( 60, 1, 0.1, 100 ) );
await new Promise( resolve => setTimeout( resolve, 0 ) );
assert.equal( typeof releaseFineAsset, 'function', 'WebGL starts the finer request asynchronously' );
assert.ok( webglFallback.scene.children.some( mesh => mesh.isInstancedMesh && ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the coarse WebGL model stays visible while refinement is pending' );
releaseFineAsset();
await new Promise( resolve => setTimeout( resolve, 10 ) );
assert.equal( requestedAssets.filter( id => id === fineModelAssetID ).length, 2, 'WebGL also requests finer models only after view demand' );
webglResult.runtime.update( 1 / 60, new THREE.PerspectiveCamera( 60, 1, 0.1, 100 ) );
const webglMeshes = webglFallback.scene.children.filter( object => object.isInstancedMesh );
const webglMain = webglMeshes.find( mesh => ! mesh.userData.shadowOnly );
assert.ok( webglMeshes.some( mesh => ! mesh.userData.shadowOnly && mesh.count === 1 ), 'the requested fine WebGL model becomes active after it loads' );
assert.ok( webglMeshes.every( mesh => mesh.matrixAutoUpdate === false && mesh.matrixWorldAutoUpdate === false ), 'newly streamed WebGL LOD batches also freeze their world transforms' );
assert.equal( webglMeshes.some( mesh => mesh.userData.shadowOnly ), false, 'WebGL does not submit duplicate shadow-only meshes in its color pass' );
assert.equal( webglMain.castShadow, true, 'the selected WebGL color LOD casts shadows without a duplicate mesh' );
assert.ok( webglMain.customDepthMaterial, 'the selected color LOD uses a screen-door aware depth material' );
assert.equal( webglResult.runtime.planner.shadowGroups[ 0 ].count, 0, 'WebGL skips its unused separate shadow-instance selection' );
assert.equal( webglMain.geometry.getAttribute( 'position' ).getX( 0 ), 1.5 );
assert.equal( webglMain.geometry.getAttribute( 'iStaticFade' ).array[ 0 ], 1 );
assert.equal( webglMain.geometry.getAttribute( 'iStaticFade' ).itemSize, 4, 'WebGL uses the shared four-channel fade policy' );
webglResult.runtime.dispose();
assert.equal( webglFallback.scene.children.length, 0 );

console.log( 'generic static model component installs and updates through WebGPU and WebGL adapters' );
