import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encodeFishPropPlacements } from '../src/network/FishPropPlacements.js';
import { fishPropGeometry } from '../src/world/fish/FishProps.js';
import { WebGLFishPropsAdapter } from '../src/fallback/WebGLFishPropsAdapter.js';

const records = [
	{ kind: 'whole', species: 'mullet', L: 0.4, x: 1.25, y: 3, z: -2.5, q: [ 0, 0.7071067811865475, 0, 0.7071067811865476 ], pattern: 14, seed: 0.972, curl: -0.1, sag: 0.15, jaw: 0.2, flags: [ 0.6, 0.6, 0, 0 ] },
	{ kind: 'ice', species: null, L: 0.25, x: 0, y: 0.1, z: 0, q: [ 0, 0, 0, 1 ], pattern: 0, seed: 0.5, curl: 0, sag: 0, jaw: 0, flags: [ 0, 0, 0, 0 ] },
];
const bytes = encodeFishPropPlacements( records );
assert.equal( JSON.parse( new TextDecoder().decode( bytes ) ).records.length, 2, 'the adapter consumes canonical placement records' );

const scene = new THREE.Scene();
const adapter = new WebGLFishPropsAdapter( THREE, scene, records );
assert.equal( adapter.group.name, 'Hosted fish props' );
assert.equal( scene.children[ 0 ], adapter.group );
assert( adapter.mesh.geometry.attributes.position.count > 0 );
assert.equal( adapter.mesh.geometry.attributes.position.count, adapter.mesh.geometry.attributes.color.count );
assert( adapter.mesh.geometry.index.count > 0 );

const whole = fishPropGeometry( 'whole', 'mullet', 0 );
assert( adapter.mesh.geometry.attributes.position.count >= whole.getAttribute( 'position' ).count, 'WebGL uses shared procedural fish geometry' );
whole.dispose();
adapter.dispose();
assert.equal( scene.children.length, 0, 'disposing removes the hosted fish props' );
console.log( 'webgl fish props adapter passed (canonical placements and shared geometry)' );
