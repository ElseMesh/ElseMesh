import assert from 'node:assert/strict';
import * as THREE from 'three';
import { reefLODAtDistance } from '../src/world/Reef.js';
import { WebGLReefAdapter } from '../src/fallback/WebGLReefAdapter.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 65, 1, 0.1, 200 );
camera.position.set( 0, 1, 12 );
camera.lookAt( 0, - 2, 0 );
camera.updateProjectionMatrix();

const rock = { type: 'rock', variant: 0, x: 0, y: - 2, z: 0, s: 1, sx: 1, sy: 1, sz: 1, q: [ 0, 0, 0, 1 ], c1: 0x887766, c2: 0x997788, seed: 0.25, flex: - 0.05 };
const fan = { type: 'fan', variant: 0, x: 1, y: - 2, z: 0, s: 1, sx: 1, sy: 1, sz: 1, q: [ 0, 0, 0, 1 ], c1: 0x776688, c2: 0x665577, seed: 0.5, flex: 0.3 };
const adapter = new WebGLReefAdapter( THREE, scene, [ rock, fan ] );
try {
	assert.equal( adapter.layout.fish, null, 'static placement presentation does not start fish simulation' );
	assert.equal( adapter.layout.batches, undefined, 'layout-only Reef reuses canonical data without WebGPU batches' );
	assert.equal( adapter.layout.items.hard.length, 1 );
	assert.equal( adapter.layout.items.soft.length, 1 );
	assert.ok( adapter.meshes.hard.some( state => state.baseKind === adapter.layout.items.hard[ 0 ].model.kind0 ) );
	assert.ok( adapter.meshes.soft.some( state => state.baseKind === adapter.layout.items.soft[ 0 ].model.kind0 ) );
	adapter.update( camera );
	assert.equal( adapter.visibleInstances, 2, 'both authored placements enter the camera frustum and draw range' );
	assert.equal( adapter.meshes.hard.reduce( ( count, state ) => count + state.mesh.count, 0 ), 1 );
	assert.equal( adapter.meshes.soft.reduce( ( count, state ) => count + state.mesh.count, 0 ), 1 );
	const data = adapter.layout.hardCull;
	const distance = camera.position.distanceTo( new THREE.Vector3( data.x[ 0 ], data.y[ 0 ], data.z[ 0 ] ) );
	const selectedLOD = reefLODAtDistance( distance, data, 0 );
	assert.equal( adapter.meshes.hard.find( state => state.mesh.count > 0 )?.lod, selectedLOD, 'WebGL uses the same distance LOD rule as Reef' );
	camera.position.set( 1000, 1, 1000 );
	camera.lookAt( 1000, 0, 0 );
	adapter.update( camera );
	assert.equal( adapter.visibleInstances, 0, 'reef placements outside the view do not remain visible' );
	console.log( 'WebGL reef adapter passed (canonical static placements, LOD catalog, culling and hard/soft batches)' );
} finally {
	adapter.dispose();
}
