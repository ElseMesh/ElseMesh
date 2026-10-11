import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Colliders } from '../src/world/Colliders.js';
import { STAND, FISH_STAND_VENDOR, fishStandColliderVolumes } from '../src/game/FishStandContent.js';
import { WebGLFishStandAdapter } from '../src/fallback/WebGLFishStandAdapter.js';

const scene = new THREE.Scene();
const colliders = new Colliders();
const adapter = new WebGLFishStandAdapter( THREE, scene, { terrain: { heightAt: () => 2 }, colliders } );

assert.equal( adapter.group.name, 'FishStand', 'the WebGL adapter preserves the canonical content identity' );
assert.deepEqual( adapter.group.position.toArray(), [ STAND.x, 2, STAND.z ], 'the WebGL adapter uses the shared terrain placement' );
assert( adapter.mesh.geometry.attributes.position && adapter.mesh.geometry.attributes.color, 'the shared procedural geometry reaches Three.js with positions and colors' );
assert.equal( colliders.boxes.length, fishStandColliderVolumes( 2 ).length, 'collision volumes come from the shared content descriptor' );
assert.equal( adapter.vendor.name, FISH_STAND_VENDOR.name, 'vendor identity comes from the shared content descriptor' );
assert( adapter.vendor.inRange( { x: adapter.vendor.position.x, y: adapter.vendor.position.y, z: adapter.vendor.position.z } ), 'the canonical buyer interaction radius is exposed to the WebGL path' );

adapter.dispose();
assert.equal( scene.children.length, 0, 'disposing the adapter removes the stand presentation' );
assert.equal( colliders.boxes.length, 0, 'disposing the adapter removes its collision volumes' );
console.log( 'webgl fish stand adapter passed (shared placement, geometry, vendor and colliders)' );
