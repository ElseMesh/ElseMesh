import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPECIES } from '../src/world/wildlife/BirdSpecies.js';
import { buildBird } from '../src/world/wildlife/BirdShapes.js';
import { createPose } from '../src/world/wildlife/BirdPose.js';
import { WebGLWildlifeAdapter, deformWebGLBirdVertex } from '../src/fallback/WebGLWildlifeAdapter.js';

const poses = SPECIES.map( ( _species, index ) => createPose( index, 0.4 ) );
for ( const [ speciesIndex, species ] of SPECIES.entries() ) {
	const shape = buildBird( species ), pose = poses[ speciesIndex ];
	const wingIndex = shape.A.findIndex( ( _v, i ) => i % 4 === 3 && shape.A[ i ] >= 5 && shape.A[ i ] < 7.5 ) / 4;
	for ( const index of [ 0, wingIndex ] ) {
		const expected = [ shape.A[ index * 4 ], shape.A[ index * 4 + 1 ], shape.A[ index * 4 + 2 ] ];
		const actual = deformWebGLBirdVertex( shape, species, pose, index );
		assert( Math.hypot( actual[ 0 ] - expected[ 0 ], actual[ 1 ] - expected[ 1 ], actual[ 2 ] - expected[ 2 ] ) < 1e-6, `neutral ${species.name} poses preserve shared body and wing rest vertices` );
	}
}

const scene = new THREE.Scene();
const adapter = new WebGLWildlifeAdapter( THREE, scene, { heightAt: () => 0 } );
const runtime = {
	 birds: { agents: poses.map( ( P, index ) => ( { visible: true, kind: index === 3 ? 'frigate' : 'gull', f: { P } } ) ) },
	shorebirds: { drawDistance: 190, birds: [] },
	crabs: { nearBurrows: [ { x: 0, y: 0, z: 0, yaw: 0, seed: 0.3, size: 1 } ], ghosts: [], hermits: [] },
};
adapter.update( runtime, { position: new THREE.Vector3() } );
assert.equal( scene.children.length, 8, 'adapter creates five bird and three shared ghost, hermit, and burrow batches' );
const birdMesh = scene.children.find( child => child.name === 'WebGL laughing gull' );
assert.equal( birdMesh.geometry.attributes.position.count, buildBird( SPECIES[ 0 ] ).count );
assert( birdMesh.geometry.attributes.normal.array.every( Number.isFinite ), 'deformed bird normals remain finite' );
assert.equal( adapter.crabs.meshes[ 2 ].count, 1, 'shared burrow presentation records reach the WebGL batch' );
assert( Math.abs( adapter.crabs.meshes[ 2 ].geometry.attributes.iPosScale.array[ 3 ] - 0.05 ) < 1e-6, 'burrows use the shared distance-scaled record' );
adapter.dispose();
assert.equal( scene.children.length, 0, 'disposing removes the WebGL wildlife meshes' );
console.log( 'webgl wildlife adapter passed (shared bird shapes and pose records)' );
