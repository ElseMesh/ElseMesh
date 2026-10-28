import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { Colliders } from '../src/world/Colliders.js';
import { CHANDLERY } from '../src/game/Chandlery.js';
import { WebGLChandleryAdapter } from '../src/fallback/WebGLChandleryAdapter.js';

globalThis.__assetFile = async url => {
	const file = await readFile( new URL( `../worlds/tidewater/source/models/props/${url.split( '/' ).at( -1 )}`, import.meta.url ) );
	return file.buffer.slice( file.byteOffset, file.byteOffset + file.byteLength );
};

const scene = new THREE.Scene();
const colliders = new Colliders();
const placement = { position: [ 13, -9 ], yaw: -0.75, interactionRadius: 5 };
const adapter = new WebGLChandleryAdapter( THREE, scene, { terrain: { heightAt: () => 3 }, colliders, placement } );
await adapter.ready;

assert.deepEqual( adapter.group.position.toArray(), [ 13, 3, -9 ], 'hosted chandlery placement comes from world experience data' );
assert.equal( adapter.mesh.geometry.attributes.aLayer.count > 0, true, 'WebGL chandlery uses the authored stall-kit geometry' );
assert( adapter.mesh.geometry.groups.length > 1 && Array.isArray( adapter.mesh.material ), 'the WebGL adapter preserves authored stall material groups' );
assert.equal( adapter.vendor.kind, 'shop', 'Marta opens the shared upgrade shop flow' );
assert.equal( adapter.vendor.radius, 5, 'shop interaction range comes from world experience data' );
assert( adapter.vendor.inRange( adapter.vendor.position ), 'shop range check accepts the vendor position' );
assert( colliders.boxes.length > 0, 'chandlery geometry registers collision boxes in the world collision set' );
adapter.dispose();
assert.equal( scene.children.length, 0, 'disposing the adapter removes the stall and vendor' );
assert.equal( colliders.boxes.length, 0, 'disposing the adapter removes its collision boxes' );

console.log( 'webgl chandlery adapter passed (authored geometry, placement, shop vendor and colliders)' );
