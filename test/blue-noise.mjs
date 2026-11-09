import assert from 'node:assert/strict';
import { bestCandidateBlueNoise, MAX_BLUE_NOISE_POINTS } from '../src/util/BlueNoise.js';
import { mulberry32 } from '../src/util/Noise.js';

const points = bestCandidateBlueNoise( mulberry32( 8 ), 4, 8 );
assert.deepEqual( points, [
	[ 1.2503613587468863, 5.001538088545203 ],
	[ 5.5474426206201315, 0.7279664184898138 ],
	[ 2.2133942171931267, 0.8327114265412092 ],
	[ 4.545699015259743, 3.227406620979309 ],
], 'best-candidate points preserve the pre-extraction deterministic sequence' );
assert.deepEqual( bestCandidateBlueNoise( mulberry32( 8 ), 4, 8 ), points, 'a seeded generator produces repeatable toroidal placement' );
assert.throws( () => bestCandidateBlueNoise( null, 4, 8 ), /settings/ );
assert.throws( () => bestCandidateBlueNoise( Math.random, - 1, 8 ), /settings/ );
assert.throws( () => bestCandidateBlueNoise( Math.random, MAX_BLUE_NOISE_POINTS + 1, 8 ), /settings/ );

console.log( 'shared deterministic blue-noise placement: ok' );
