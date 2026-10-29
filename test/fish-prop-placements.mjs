import assert from 'node:assert/strict';
import { decodeFishPropPlacements, encodeFishPropPlacements, FISH_PROP_PLACEMENT_PROTOCOL } from '../src/network/FishPropPlacements.js';
const presentation = { PATTERN: { mullet: 14 }, SPECIES: { mullet: { pattern: 14 } }, SKIN: { mullet: {} } };

const records = [
	{ kind: 'whole', species: 'mullet', L: 0.4, x: 1.25, y: 3, z: -2.5, q: [ 0, 0.7071067811865475, 0, 0.7071067811865476 ], pattern: 14, seed: 0.972, curl: -0.1, sag: 0.15, jaw: 0.2, flags: [ 0.6, 0.6, 0, 0 ] },
	{ kind: 'ice', species: null, L: 0.25, x: 0, y: 0.1, z: 0, q: [ 0, 0, 0, 1 ], pattern: 0, seed: 0.5, curl: 0, sag: 0, jaw: 0, flags: [ 0, 0, 0, 0 ] },
];

const encoded = encodeFishPropPlacements( records, presentation );
assert.equal( JSON.parse( new TextDecoder().decode( encoded ) ).format, FISH_PROP_PLACEMENT_PROTOCOL );
assert.deepEqual( decodeFishPropPlacements( encoded, presentation ), records, 'placement records round-trip without changing renderer inputs' );
assert.deepEqual( encodeFishPropPlacements( decodeFishPropPlacements( encoded, presentation ), presentation ), encoded, 'canonical asset bytes are deterministic' );
assert.throws( () => encodeFishPropPlacements( [ { ...records[ 0 ], seed: Number.NaN } ], presentation ), /seed/, 'non-finite seeds are rejected' );
assert.throws( () => encodeFishPropPlacements( [ { ...records[ 0 ], pattern: 0 } ], presentation ), /pattern/, 'species and shader pattern must agree' );
assert.throws( () => encodeFishPropPlacements( [ { ...records[ 0 ], species: 'not-a-species' } ], presentation ), /species/, 'unknown species are rejected' );
assert.throws( () => encodeFishPropPlacements( [ { ...records[ 0 ], q: [ 0, 0, 0, 2 ] } ], presentation ), /quaternion/, 'non-normalized transforms are rejected' );
const withUnknownField = new TextEncoder().encode( JSON.stringify( { format: FISH_PROP_PLACEMENT_PROTOCOL, records: [ { ...records[ 0 ], executable: true } ] } ) );
assert.throws( () => decodeFishPropPlacements( withUnknownField, presentation ), /fields/, 'unknown placement fields are rejected' );

console.log( 'fish-prop placement codec: ok' );
