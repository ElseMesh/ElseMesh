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
const glbBytes = staticModelGLB(), modelAssetID = hash( glbBytes );
const document = {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ { id: 'fixture-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, lods: [ { assetId: modelAssetID } ], lodThresholds: [], shadowLod: 0, shadowMaxDistance: 20 } ],
	instances: [ { model: 'fixture-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
};
const setBytes = new TextEncoder().encode( JSON.stringify( document ) ), setAssetID = hash( setBytes );
const component = { id: 'fixture-static-models', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: modelAssetID, kind: 'glb' } ] };
const connector = {
	manifest: { assets: [ { id: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { id: modelAssetID, kind: 'glb' } ] },
	assets: new Map( [ [ setAssetID, setBytes ] ] ),
	getAsset: async assetId => { assert.equal( assetId, modelAssetID ); return glbBytes; },
};
const camera = new PerspectiveCamera( 60, 1, 0.1, 100 );
camera.lookAt( 0, 0, - 1 );

const webgpuRoot = new Group();
webgpuRoot.userData.worldPackage = { parsed: new Map(), loadedObjects: new Set(), connector, materialAdapterContexts: new Map() };
const webgpuInstall = worldComponentBackendAdapter( 'webgpu', component.type );
assert.equal( typeof webgpuInstall, 'function' );
const webgpuResult = await webgpuInstall( { root: webgpuRoot, connector }, component );
assert.equal( webgpuResult.installed, true );
webgpuResult.runtime.update( 1 / 60, camera );
const webgpuMeshes = [];
webgpuRoot.traverse( object => { if ( object.isInstancedMesh ) webgpuMeshes.push( object ); } );
const webgpuMain = webgpuMeshes.find( mesh => ! mesh.userData.shadowOnly );
const webgpuShadow = webgpuMeshes.find( mesh => mesh.userData.shadowOnly );
assert.equal( webgpuMain.count, 1 );
assert.equal( webgpuShadow.count, 1 );
assert.equal( webgpuMain.geometry.getAttribute( 'position' ).getX( 0 ), 1.5, 'GLB node translation is baked into the cloned primitive geometry' );
assert.equal( webgpuMain.geometry.getAttribute( 'iStaticFade' ).array[ 0 ], 1 );
assert.equal( webgpuShadow.geometry.getAttribute( 'iStaticFade' ).array[ 1 ], 0, 'shadow-only instances remain fully visible with complementary fade enabled' );
webgpuResult.runtime.dispose();
disposeWorldPackage( webgpuRoot );
assert.equal( webgpuRoot.children.length, 0 );

const webglFallback = { THREE, connector, loader: new GLTFLoader(), scene: new THREE.Scene() };
const webglInstall = worldComponentBackendAdapter( 'webgl', component.type );
assert.equal( typeof webglInstall, 'function' );
const webglResult = await webglInstall( { fallback: webglFallback }, component );
assert.equal( webglResult.installed, true );
webglResult.runtime.update( 1 / 60, new THREE.PerspectiveCamera( 60, 1, 0.1, 100 ) );
const webglMeshes = webglFallback.scene.children.filter( object => object.isInstancedMesh );
const webglMain = webglMeshes.find( mesh => ! mesh.userData.shadowOnly );
const webglShadow = webglMeshes.find( mesh => mesh.userData.shadowOnly );
assert.equal( webglMain.count, 1 );
assert.equal( webglShadow.count, 1 );
assert.ok( webglShadow.customDepthMaterial, 'shadow LOD uses its own screen-door aware depth material' );
assert.equal( webglMain.geometry.getAttribute( 'position' ).getX( 0 ), 1.5 );
assert.equal( webglMain.geometry.getAttribute( 'iStaticFade' ).array[ 0 ], 1 );
assert.equal( webglShadow.geometry.getAttribute( 'iStaticFade' ).array[ 1 ], 0 );
webglResult.runtime.dispose();
assert.equal( webglFallback.scene.children.length, 0 );

console.log( 'generic static model component installs and updates through WebGPU and WebGL adapters' );
