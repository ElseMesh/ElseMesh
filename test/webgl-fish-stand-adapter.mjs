import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { Colliders } from '../src/world/Colliders.js';
import { STAND, FISH_STAND_VENDOR, fishStandColliderVolumes } from '../src/game/FishStandContent.js';
import { WebGLFishStandAdapter } from '../src/fallback/WebGLFishStandAdapter.js';

globalThis.__assetFile = async url => {
	const file = await readFile( new URL( `../worlds/tidewater/source/models/props/${url.split( '/' ).at( -1 )}`, import.meta.url ) );
	return file.buffer.slice( file.byteOffset, file.byteOffset + file.byteLength );
};

const scene = new THREE.Scene();
const colliders = new Colliders();
const adapter = new WebGLFishStandAdapter( THREE, scene, { terrain: { heightAt: () => 2 }, colliders } );
await adapter.ready;

assert.equal( adapter.group.name, 'FishStand', 'the WebGL adapter preserves the canonical content identity' );
assert.deepEqual( adapter.group.position.toArray(), [ STAND.x, 2, STAND.z ], 'the WebGL adapter uses the shared terrain placement' );
assert( adapter.mesh.geometry.attributes.position && adapter.mesh.geometry.attributes.color && adapter.mesh.geometry.attributes.aLayer, 'the authored stall kit geometry and material layer data reach Three.js' );
assert( adapter.mesh.geometry.groups.length > 1 && Array.isArray( adapter.mesh.material ), 'the WebGL path preserves the authored stall kit material groups' );
assert.equal( colliders.boxes.length, fishStandColliderVolumes( 2 ).length, 'collision volumes come from the shared content descriptor' );
assert.equal( adapter.vendor.name, FISH_STAND_VENDOR.name, 'vendor identity comes from the shared content descriptor' );
assert( adapter.vendor.inRange( { x: adapter.vendor.position.x, y: adapter.vendor.position.y, z: adapter.vendor.position.z } ), 'the canonical buyer interaction radius is exposed to the WebGL path' );

adapter.dispose();
assert.equal( scene.children.length, 0, 'disposing the adapter removes the stand presentation' );
assert.equal( colliders.boxes.length, 0, 'disposing the adapter removes its collision volumes' );
const hostedPlacement = { position: [ 13, -9 ], yaw: -0.75, interactionRadius: 5 };
const hosted = new WebGLFishStandAdapter( THREE, scene, { terrain: { heightAt: () => 3 }, placement: hostedPlacement } );
await hosted.ready;
assert.deepEqual( hosted.group.position.toArray(), [ 13, 3, -9 ], 'hosted vendor placement comes from world experience data' );
assert.equal( hosted.vendor.radius, 5, 'hosted interaction range comes from world experience data' );
hosted.dispose();
console.log( 'webgl fish stand adapter passed (shared placement, geometry, vendor and colliders)' );
