import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TerrainData } from '../src/world/TerrainData.js';
import { Colliders } from '../src/world/Colliders.js';
import { CRITTER } from '../src/world/wildlife/CritterSpecies.js';
import { WebGLCrabAdapter } from '../src/fallback/WebGLCrabAdapter.js';

const scene = new THREE.Scene();
const adapter = new WebGLCrabAdapter( THREE, scene, { terrain: new TerrainData(), colliders: new Colliders() } );
adapter.update( 1 / 60, { position: new THREE.Vector3( 53.6, 3, - 77 ) }, 23 );

assert.equal( adapter.crabs.constructor.name, 'Crabs', 'WebGL uses the canonical crab simulation' );
assert.equal( adapter.bodyMeshes.length, 3, 'ghost crab, hermit shell, and burrow share the canonical species geometry' );
assert( adapter.bodyMeshes[ CRITTER.BURROW ].count > 0, 'nearby canonical burrows are presented' );
assert( adapter.bodyMeshes[ 0 ].geometry.attributes.position.count > 0, 'shared carapace vertex data reaches Three.js' );
assert( adapter.limbMeshes.some( mesh => mesh.count > 0 ), 'simulated crab limbs reach the WebGL presentation' );
console.log( `webgl crab adapter passed (${adapter.bodyMeshes[0].count} ghost crabs, ${adapter.bodyMeshes[1].count} hermit crabs, ${adapter.bodyMeshes[2].count} burrows)` );
