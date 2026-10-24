import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLBoatAdapter } from '../src/fallback/WebGLBoatAdapter.js';
import { ISLAND_DEFINITION } from '../src/world/IslandDefinition.js';
import { Vector3 as EngineVector3 } from '../src/engine/index.js';

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

const hostedScene = new THREE.Scene();
const berthPosition = new EngineVector3( 12, 0.8, - 42 );
const hosted = new WebGLBoatAdapter( THREE, hostedScene, { initialPosition: berthPosition, initialHeading: 1.1 } );
assert.deepEqual( hosted.group.position.toArray(), berthPosition.toArray(), 'hosted adapter honors the signed berth position' );
assert.ok( Math.abs( hosted.controller.homeHeading - 1.1 ) < 1e-9, 'hosted adapter honors the signed berth heading' );
hosted.dispose();
assert.equal( hostedScene.children.length, 0, 'hosted adapter releases its scene root' );
console.log( `webgl boat adapter passed (${meshes.length} canonical meshes)` );
