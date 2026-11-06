import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TerrainData } from '../src/world/TerrainData.js';
import { Reef, REEF_TYPE_NAMES } from '../src/world/Reef.js';
import { decodeReefPlacements, encodeReefPlacements, MAX_REEF_PLACEMENTS, REEF_PLACEMENT_RECORD_BYTES } from '../src/network/ReefPlacements.js';
import { TIDEWATER_LAYOUT } from '../worlds/tidewater/layout.js';

const terrain = new TerrainData( { seed: 7, worldLayout: TIDEWATER_LAYOUT } );
function generate() {
	const reef = new Reef( { terrain, layoutOnly: true } );
	assert.equal( reef.group.parent, null, 'layout-only reef is not inserted into a scene' );
	assert.equal( reef.fish, null, 'layout-only reef skips fish simulation' );
	assert.equal( reef.batches, undefined, 'layout-only reef allocates no GPU batches' );
	assert.equal( reef.noise3D, undefined, 'layout-only reef allocates no GPU noise volume' );
	return { placements: reef.placements(), stats: reef.stats };
}

const first = generate();
assert.ok( first.placements.length > 1000, 'reef layout contains its expected large procedural population' );
assert.equal( first.stats.instances.hard + first.stats.instances.soft, first.placements.length, 'all reef layout records are exposed' );
assert.deepEqual( REEF_TYPE_NAMES.slice( 0, 5 ), [ 'slab', 'rock', 'boulder', 'lobes', 'brain' ], 'type IDs retain their stable leading order' );

const bytes = encodeReefPlacements( first.placements, 20260923 );
assert.equal( bytes.byteLength, 16 + first.placements.length * REEF_PLACEMENT_RECORD_BYTES, 'reef snapshot uses fixed-width records' );
const decoded = decodeReefPlacements( bytes );
assert.equal( decoded.seed, 20260923 );
assert.equal( decoded.records.length, first.placements.length );
assert.deepEqual( encodeReefPlacements( decoded.records, decoded.seed ), bytes, 'decoded records re-encode byte-identically' );
assert.equal( createHash( 'sha256' ).update( encodeReefPlacements( first.placements, 20260923 ) ).digest( 'hex' ), createHash( 'sha256' ).update( bytes ).digest( 'hex' ), 'repeat encoding is deterministic' );

const second = generate();
const secondBytes = encodeReefPlacements( second.placements, 20260923 );
assert.deepEqual( secondBytes, bytes, 'same terrain and fixed seed produce byte-identical layouts' );

const badMagic = bytes.slice(); badMagic[ 0 ] ^= 0xff;
assert.throws( () => decodeReefPlacements( badMagic ), /header/ );
const badLength = bytes.slice( 0, bytes.length - 1 );
assert.throws( () => decodeReefPlacements( badLength ), /length/ );
const badType = bytes.slice(); new DataView( badType.buffer ).setUint16( 16, REEF_TYPE_NAMES.length, true );
assert.throws( () => decodeReefPlacements( badType ), /type or flags/ );
assert.throws( () => encodeReefPlacements( first.placements.slice( 0, 1 ), -1 ), /seed/ );
assert.throws( () => encodeReefPlacements( [ { ...first.placements[ 0 ], type: 'unknown' } ], 1 ), /unknown type/ );
assert.throws( () => encodeReefPlacements( [ { ...first.placements[ 0 ], variant: 255 } ], 1 ), /unknown type or variant/ );
assert.throws( () => encodeReefPlacements( [ { ...first.placements[ 0 ], q: [ 0, 0, 0, 2 ] } ], 1 ), /quaternion/ );
assert.throws( () => encodeReefPlacements( new Array( MAX_REEF_PLACEMENTS + 1 ), 1 ), /record count/ );

console.log( `ok deterministic CPU reef snapshot (${first.placements.length} records, ${bytes.byteLength} bytes)` );
