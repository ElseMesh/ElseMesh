import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GroundCoverCellPlanner } from '../src/engine/render/GroundCoverCellPlanner.js';
import { webglGrassMesh } from '../src/fallback/WebGLFallback.js';

const terrain = { origin: - 100, size: 200, texel: 2, res: 101, heights: new Float32Array( 101 * 101 ), heightAt: () => 0 };
const densityData = new Uint8Array( 64 * 64 * 4 );
for ( let index = 1; index < densityData.length; index += 4 ) densityData[ index ] = 30;
const density = { origin: terrain.origin, size: terrain.size, res: 64, data: densityData };
const planner = new GroundCoverCellPlanner( { terrain, density } );
const camera = { position: new THREE.Vector3( 0, 2, 0 ) };

const first = webglGrassMesh( THREE, terrain, camera, null, density, planner );
const firstPositions = first.geometry.attributes.position.array;
let minDistance = Infinity, maxDistance = 0;
for ( let index = 0; index < firstPositions.length; index += 3 ) {
	const distance = Math.hypot( firstPositions[ index ], firstPositions[ index + 2 ] );
	minDistance = Math.min( minDistance, distance );
	maxDistance = Math.max( maxDistance, distance );
}
assert.ok( minDistance < 18, 'near ground cover is generated' );
assert.ok( maxDistance > 46, 'far LOD cells extend beyond the former 42 m WebGL limit' );
assert.ok( maxDistance <= 89, 'ground-cover blades remain inside the 88 m planner range plus blade extent' );

const second = webglGrassMesh( THREE, terrain, camera, null, density, planner );
assert.deepEqual( second.geometry.attributes.position.array, firstPositions, 'WebGL ground-cover geometry is deterministic across cell-planner updates' );
first.geometry.dispose(); first.material.dispose();
second.geometry.dispose(); second.material.dispose();
console.log( 'WebGL ground-cover LOD radius and deterministic geometry checks passed' );
