import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLBoatAdapter } from '../src/fallback/WebGLBoatAdapter.js';
import { ISLAND_DEFINITION } from '../src/world/IslandDefinition.js';

const scene = new THREE.Scene();
const adapter = new WebGLBoatAdapter( THREE, scene );
const meshes = [];
adapter.group.traverse( ( object ) => { if ( object.isMesh ) meshes.push( object ); } );

assert.equal( meshes.length, Object.keys( adapter.model.meshes ).length, 'adapter presents every canonical boat mesh' );
assert.deepEqual( adapter.group.position.toArray(), ISLAND_DEFINITION.boatDock.position, 'adapter uses the shared boat berth' );
assert( meshes.every( ( mesh ) => mesh.geometry.attributes.position && mesh.geometry.attributes.color ), 'converted meshes retain shared geometry and vertex color data' );

adapter.update( 1 / 60 );
adapter.dispose();
assert.equal( scene.children.length, 0, 'dispose removes the adapter scene root' );
console.log( `webgl boat adapter passed (${meshes.length} canonical meshes)` );
