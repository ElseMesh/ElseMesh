import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { WebGLWildlifeAdapter } from '../src/fallback/WebGLWildlifeAdapter.js';

const scene = new THREE.Scene();
const adapter = new WebGLWildlifeAdapter( THREE, scene, { terrain: new TerrainData(), colliders: new Colliders() } );
const camera = { position: new THREE.Vector3( 53.6, 3, - 77 ) };
adapter.update( 1 / 60, camera, 12 );

const visibleInstances = adapter.meshes.reduce( ( total, mesh ) => total + mesh.count, 0 );
assert.equal( visibleInstances, adapter.birds.agents.length + adapter.shorebirds.birds.length, 'all canonical simulated birds reach the WebGL presentation' );
assert.equal( adapter.shorebirds.birds.length, 21, 'both shared sanderling flocks are present' );
assert( adapter.meshes.every( ( mesh ) => mesh.geometry.attributes.position && mesh.geometry.attributes.color ), 'adapter meshes contain species geometry and presentation colors' );

adapter.dispose();
assert.equal( scene.children.length, 0, 'dispose removes all wildlife meshes' );
console.log( `webgl wildlife adapter passed (${visibleInstances} shared bird states)` );
