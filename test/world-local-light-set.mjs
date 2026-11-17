import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_LOCAL_LIGHT_SET_COMPONENT, validateWorldLocalLightSet, worldLocalLightSources } from '../src/network/WorldLocalLightSet.js';
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
runtime.dispose();
assert.equal( scene.children.length, 0, 'the WebGL presenter removes its light pool on disposal' );

const webgpu = new LocalLights();
webgpu.setWorldComponents( [ component ] );
assert.equal( webgpu.worldSources.length, 2, 'the WebGPU light packer receives the same world component' );
assert.equal( webgpu.worldSources[ 1 ].cosOuter, Math.cos( lights[ 1 ].outerCone ), 'the WebGPU presenter receives the authored spot cone' );

console.log( 'world local-light-set contract and WebGL presenter passed' );
