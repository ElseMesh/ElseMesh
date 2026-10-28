import assert from 'node:assert/strict';
import { Vector3 } from '../src/engine/math/Vector3.js';
import { Colliders } from '../src/world/Colliders.js';
import { worldSpawnCandidates, worldSpawnCollisionObjectIDs } from '../src/network/WorldSpawn.js';

const colliders = new Colliders();
colliders.addBox( new Vector3( 0, 1, 0 ), new Vector3( 0.5, 1, 0.5 ), 0, { solid: true } );
const spawn = { position: [ 0, 2.62, 0 ], yaw: 0, pitch: 0 };
const candidates = worldSpawnCandidates( spawn, 2, colliders );
assert.ok( candidates.length > 0, 'search finds legal positions around a blocked preferred spawn' );
assert.ok( Math.hypot( candidates[ 0 ][ 0 ], candidates[ 0 ][ 2 ] ) > 0.8, 'occupied starting capsule is skipped' );
assert.ok( candidates.every( ( [ x, , z ] ) => Math.hypot( x, z ) <= 2 + 1e-9 ), 'all candidates remain within the authored horizontal radius of the preferred position' );
const free = worldSpawnCandidates( { ...spawn, position: [ 10, 2.62, 10 ] }, 0, colliders );
assert.deepEqual( free, [ [ 10, 1, 10 ] ], 'zero radius keeps the exact preferred point and ground adjusts its feet height' );
assert.throws( () => worldSpawnCandidates( spawn, -1, colliders ), /Invalid world spawn search/ );
const objectIDs = worldSpawnCollisionObjectIDs( { objects: [
	{ id: 'elsemesh-object:near', transform: { position: [ 2, 2.62, 0 ], yaw: 0 }, collision: { enabled: true, shape: 'box', center: [ 0, 0, 0 ], halfExtents: [ 0.5, 1, 0.5 ] } },
	{ id: 'elsemesh-object:far', transform: { position: [ 50, 2.62, 0 ], yaw: 0 }, collision: { enabled: true, shape: 'box', center: [ 0, 0, 0 ], halfExtents: [ 0.5, 1, 0.5 ] } },
	{ id: 'elsemesh-object:terrain', transform: { position: [ 500, 0, 500 ], yaw: 0 }, collision: { enabled: true, shape: 'heightfield' } },
	{ id: 'elsemesh-object:decor', transform: { position: [ 0, 0, 0 ], yaw: 0 }, collision: { enabled: false, shape: 'none' } },
] }, spawn, 2 );
assert.deepEqual( [ ...objectIDs ].sort(), [ 'elsemesh-object:near', 'elsemesh-object:terrain' ], 'spawn loads every potentially intersecting collider and heightfield, but skips distant or noncolliding objects' );
console.log( 'world spawn placement invariants passed' );
