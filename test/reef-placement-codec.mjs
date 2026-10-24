import assert from 'node:assert/strict';
import { decodeReefPlacements, encodeReefPlacements, REEF_PLACEMENT_RECORD_BYTES } from '../src/network/ReefPlacements.js';
import { REEF_TYPE_NAMES, REEF_TYPE_VARIANT_COUNTS } from '../src/network/ReefPlacementTypes.js';

assert.deepEqual( REEF_TYPE_NAMES.slice( 0, 5 ), [ 'slab', 'rock', 'boulder', 'lobes', 'brain' ] );
assert.equal( REEF_TYPE_VARIANT_COUNTS.slab, 2 );
const record = {
	type: 'slab', variant: 0, x: 1, y: - 2, z: 3, s: 1, sx: 1, sy: 1, sz: 1,
	q: [ 0, 0, 0, 1 ], c1: 0x736452, c2: 0x887766, seed: 0.25, flex: - 0.04,
};
const bytes = encodeReefPlacements( [ record ], 7 );
assert.equal( bytes.byteLength, 16 + REEF_PLACEMENT_RECORD_BYTES );
const decoded = decodeReefPlacements( bytes );
assert.equal( decoded.seed, 7 );
assert.equal( decoded.records[ 0 ].type, record.type );
assert.equal( decoded.records[ 0 ].variant, record.variant );
assert.ok( Math.abs( decoded.records[ 0 ].flex - record.flex ) < 1e-6 );
assert.deepEqual( encodeReefPlacements( decoded.records, decoded.seed ), bytes, 'codec round-trips without importing renderer code' );
console.log( 'renderer-free reef placement codec passed' );
