import assert from 'node:assert/strict';
import { advanceBenchFrame } from '../src/core/Bench.js';

const calls = [];
advanceBenchFrame( {
	hostedPackageWorld: true,
	hostedPackageFrame: dt => calls.push( [ 'hosted', dt ] ),
	frame: dt => calls.push( [ 'local', dt ] ),
}, 0.5 );
advanceBenchFrame( {
	hostedPackageWorld: false,
	hostedPackageFrame: dt => calls.push( [ 'hosted', dt ] ),
	frame: dt => calls.push( [ 'local', dt ] ),
}, 1 / 60 );

assert.deepEqual( calls, [ [ 'hosted', 0.5 ], [ 'local', 1 / 60 ] ], 'benchmark captures advance each world through the same frame path used by its live runtime' );
console.log( 'benchmark frame-path selection passed' );
