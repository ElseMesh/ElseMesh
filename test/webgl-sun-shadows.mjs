import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLSunShadows } from '../src/fallback/WebGLSunShadows.js';
import { installWebGLSceneMaterialLighting } from '../src/fallback/WebGLMaterialLighting.js';
import { SUN_SHADOW_PROFILE } from '../src/engine/render/SunShadowProfile.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 62, 16 / 9, 0.1, 5000 );
camera.position.set( 12, 4, - 30 );
camera.lookAt( 0, 0, 0 );
camera.updateMatrixWorld();
const renderer = { shadowMap: { autoUpdate: true, needsUpdate: false } };
const shadows = new WebGLSunShadows( {
	renderer,
	scene,
	camera,
	direction: new THREE.Vector3( 0.3, - 0.8, 0.4 ).normalize(),
} );

assert.equal( shadows.lights.length, 3, 'WebGL presents the shared near, middle, and far shadow cascades' );
assert.deepEqual( shadows.csm.breaks, [ 0.025, 0.15, 1 ], 'WebGL uses the same 10 m, 60 m, and 400 m split distances as WebGPU' );
assert.equal( renderer.shadowMap.autoUpdate, false, 'shadow maps update on the engine cadence instead of rendering all cascades every color pass' );
assert.ok( shadows.lights.every( light => light.castShadow && light.shadow.autoUpdate === false ), 'each cascade owns a scheduled shadow map' );

const initialMaterial = new THREE.MeshStandardMaterial();
scene.add( new THREE.Mesh( new THREE.BoxGeometry(), initialMaterial ) );
installWebGLSceneMaterialLighting( THREE, scene, null, shadows );
assert.equal( initialMaterial.defines.CSM_CASCADES, 3, 'existing generic scene materials receive the engine shadow adapter' );
const streamedMaterial = new THREE.MeshPhysicalMaterial();
const streamedRoot = new THREE.Group();
streamedRoot.add( new THREE.Mesh( new THREE.BoxGeometry(), streamedMaterial ) );
scene.add( streamedRoot );
assert.equal( streamedMaterial.defines.CSM_CASCADES, 3, 'streamed world and LOD materials receive the same shadow adapter at insertion' );

const material = new THREE.MeshStandardMaterial();
let originalCompileCalled = false;
material.onBeforeCompile = shader => {
	originalCompileCalled = true;
	shader.fragmentShader += '\n// retained world material shader hook';
};
assert.equal( shadows.setupMaterial( material ), true, 'the WebGL shadow adapter accepts renderer-neutral PBR materials' );
assert.equal( shadows.setupMaterial( material ), false, 'shadow material setup is idempotent' );
assert.equal( material.defines.USE_CSM, 1 );
assert.equal( material.defines.CSM_CASCADES, 3 );
const shader = { vertexShader: '', fragmentShader: '', uniforms: {} };
material.onBeforeCompile( shader, {} );
assert.equal( originalCompileCalled, true, 'the existing world material hook still runs' );
assert.match( shader.fragmentShader, /retained world material shader hook/ );
assert.equal( shader.uniforms.CSM_cascades.value.length, 3, 'the compiled material receives all cascade boundaries' );

renderer.shadowMap.needsUpdate = false;
shadows.update( camera, shadows.direction );
assert.deepEqual( shadows.lights.map( light => light.shadow.needsUpdate ), [ true, true, true ], 'the first frame initializes all shadow maps' );
for ( const light of shadows.lights ) light.shadow.needsUpdate = false;
renderer.shadowMap.needsUpdate = false;
shadows.update( camera, shadows.direction );
assert.deepEqual( shadows.lights.map( light => light.shadow.needsUpdate ), [ true, false, false ], 'the near cascade updates every frame' );
for ( const light of shadows.lights ) light.shadow.needsUpdate = false;
renderer.shadowMap.needsUpdate = false;
shadows.update( camera, shadows.direction );
assert.deepEqual( shadows.lights.map( light => light.shadow.needsUpdate ), [ true, true, false ], 'the middle cascade updates every second frame' );
for ( const light of shadows.lights ) light.shadow.needsUpdate = false;
renderer.shadowMap.needsUpdate = false;
shadows.update( camera, shadows.direction );
shadows.update( camera, shadows.direction );
assert.deepEqual( shadows.lights.map( light => light.shadow.needsUpdate ), [ true, true, true ], 'the far cascade updates every fourth frame' );

const movedSun = shadows.direction.clone().add( new THREE.Vector3( 0.01, 0, 0 ) ).normalize();
for ( const light of shadows.lights ) light.shadow.needsUpdate = false;
renderer.shadowMap.needsUpdate = false;
shadows.update( camera, movedSun );
assert.deepEqual( shadows.lights.map( light => light.shadow.needsUpdate ), [ true, true, true ], 'a moving sun invalidates every cascade' );

shadows.dispose();
assert.equal( renderer.shadowMap.autoUpdate, true, 'disposing restores renderer shadow scheduling' );
for ( const light of shadows.lights ) assert.equal( scene.children.includes( light ), false, 'disposing removes engine-owned shadow lights' );

console.log( 'WebGL sun shadows share the engine cascade profile and scheduled update cadence' );
