import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_LOCAL_LIGHT_SET_COMPONENT, transformWorldLocalLightInto, validateWorldLocalLightSet, worldLocalLightSources } from '../src/network/WorldLocalLightSet.js';
import { LocalLights } from '../src/materials/LocalLights.js';
import { WebGLLocalLights } from '../src/fallback/WebGLLocalLights.js';

const lights = [
	{ position: [ 1, 2, 3 ], color: [ 1, 0.7, 0.4 ], intensity: 3, range: 11, type: 'point', flicker: 0.08 },
	{ position: [ -1, 2, 3 ], color: [ 1, 0.6, 0.3 ], intensity: 2, range: 6, type: 'spot', direction: [ 0, 0, 1 ], innerCone: 0.8, outerCone: 1.2 },
];
const component = { id: 'elsemesh-component:lights', type: WORLD_LOCAL_LIGHT_SET_COMPONENT, data: { lights } };
assert.deepEqual( worldLocalLightSources( [ component ] ), lights, 'the generic world component returns the same renderer-neutral light records' );
assert.throws( () => validateWorldLocalLightSet( { ...component, data: { lights: [ { ...lights[ 0 ], range: 0 } ] } } ), /Invalid world local-light-set entry/ );

const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
camera.position.set( 0, 0, 0 );
const runtime = new WebGLLocalLights( THREE, scene, [ component ] );
runtime.update( camera, 1 / 60, 1 );
assert.equal( runtime.active, 2, 'the WebGL presenter selects the shared point and spot sources' );
assert( runtime.pool.point[ 0 ].intensity > 0, 'the WebGL point light receives the authored source intensity at night' );
assert( runtime.pool.spot[ 0 ].intensity > 0, 'the WebGL spot light receives the authored cone and intensity at night' );
assert.equal( runtime.toggleFlashlight(), true, 'the renderer-neutral WebGL player controls can enable the flashlight' );
runtime.update( camera, 1 / 60, 0 );
assert.equal( runtime.active, 1, 'the flashlight is active while world night lights remain off in daylight' );
assert.equal( runtime.flashlight.visible, true, 'the WebGL flashlight becomes visible when enabled' );
assert.ok( runtime.flashlight.intensity > 0, 'the WebGL flashlight remains usable in daylight at reduced intensity' );
runtime.update( camera, 1 / 60, 1 );
assert.equal( runtime.active, 3, 'the flashlight and both night sources share the WebGL local-light pool' );
assert.equal( runtime.toggleFlashlight( false ), false, 'the flashlight can be disabled deterministically' );
runtime.update( camera, 1 / 60, 1 );
assert.equal( runtime.flashlight.visible, false, 'disabling the flashlight removes it from presentation' );
runtime.dispose();
assert.equal( scene.children.length, 0, 'the WebGL presenter removes its light pool on disposal' );

const webgpu = new LocalLights();
webgpu.setWorldComponents( [ component ] );
assert.equal( webgpu.worldSources.length, 2, 'the WebGPU light packer receives the same world component' );
assert.equal( webgpu.worldSources[ 1 ].cosOuter, Math.cos( lights[ 1 ].outerCone ), 'the WebGPU presenter receives the authored spot cone' );

const attachedLight = { objectId: 'elsemesh-object:boat', position: [ 1, 2, 3 ], color: [ 1, 0.7, 0.4 ], intensity: 3, range: 11, type: 'spot', direction: [ 1, 0, 0 ], innerCone: 0.8, outerCone: 1.2, alwaysOn: true };
const attachedComponent = { ...component, data: { lights: [ attachedLight ] } };
assert.deepEqual( validateWorldLocalLightSet( attachedComponent ), [ attachedLight ], 'the shared component accepts object-local light inputs' );
assert.throws( () => validateWorldLocalLightSet( { ...attachedComponent, data: { lights: [ { ...attachedLight, objectId: 'boat' } ] } } ), /Invalid world local-light-set entry/ );
assert.throws( () => validateWorldLocalLightSet( { ...attachedComponent, data: { lights: [ { ...attachedLight, direction: [ 0, 0, 0 ] } ] } } ), /Invalid world local-light-set entry/ );

const objectRoot = new THREE.Group();
objectRoot.position.set( 10, 2, 20 );
objectRoot.rotation.y = Math.PI / 2;
objectRoot.updateWorldMatrix( true, false );
const webglAttached = new WebGLLocalLights( THREE, new THREE.Scene(), [ attachedComponent ] );
webglAttached.setWorldObjectRoot( attachedLight.objectId, objectRoot );
webglAttached.update( camera, 1 / 60, 0 );
const webgpuAttached = new LocalLights();
webgpuAttached.setWorldComponents( [ attachedComponent ] );
webgpuAttached.setWorldObjectRoot( attachedLight.objectId, objectRoot );
webgpuAttached.update( camera, 1 / 60 );
const webgpuPosition = webgpuAttached.worldSources[ 0 ].position.toArray();
assert.deepEqual( webglAttached.sources[ 0 ].position.map( value => Math.round( value * 1e6 ) / 1e6 ), webgpuPosition.map( value => Math.round( value * 1e6 ) / 1e6 ), 'both renderers use the same world-space position for an attached light' );
assert.deepEqual( webglAttached.sources[ 0 ].direction.map( value => Math.round( value * 1e6 ) / 1e6 ), webgpuAttached.worldSources[ 0 ].dir.toArray().map( value => Math.round( value * 1e6 ) / 1e6 ), 'both renderers use the same world-space direction for an attached spot light' );
assert.deepEqual( webgpuPosition.map( value => Math.round( value * 1e6 ) / 1e6 ), [ 13, 4, 19 ], 'the shared transform includes object rotation and translation' );
webglAttached.dispose();

console.log( 'world local-light-set contract and attached-light WebGPU/WebGL transform parity passed' );
