import assert from 'node:assert/strict';
import { compileGroundCoverDensityExpression } from '../src/network/GroundCoverDensityExpression.js';

// Tidewater's grass density blends meadow (G) and dune (R) density by the dune share.
const duneShare = {
	op: 'divide', left: { op: 'channel', index: 0 },
	right: { op: 'add', left: { op: 'channel', index: 0 }, right: { op: 'add', left: { op: 'channel', index: 1 }, right: { op: 'constant', value: 0.001 } } },
};
const grassDensity = compileGroundCoverDensityExpression( {
	op: 'add',
	left: { op: 'multiply', left: { op: 'channel', index: 1 }, right: { op: 'subtract', left: { op: 'constant', value: 1 }, right: duneShare } },
	right: { op: 'multiply', left: { op: 'min', left: { op: 'multiply', left: { op: 'channel', index: 0 }, right: { op: 'constant', value: 1.1 } }, right: { op: 'constant', value: 1 } }, right: duneShare },
} );

assert.deepEqual( grassDensity.channels, [ 1, 0 ], 'the compiled expression records referenced channels' );
for ( const channels of [
	[ 0, 0, 0, 0 ], [ 1, 0, 0, 0 ], [ 0, 1, 0, 0 ], [ 0.5, 0.5, 0, 0 ],
] ) {
	const dune = channels[ 0 ], meadow = channels[ 1 ];
	const duneShare = dune / ( dune + meadow + 0.001 );
	const expected = meadow * ( 1 - duneShare ) + Math.min( dune * 1.1, 1 ) * duneShare;
	assert.ok( Math.abs( grassDensity.evaluate( channels ) - expected ) < 1e-12, 'density expression reproduces the authored channel blend' );
}
assert.equal( compileGroundCoverDensityExpression( { op: 'divide', left: { op: 'channel', index: 1 }, right: { op: 'constant', value: 0 } } ).evaluate( [ 0, 1, 0, 0 ] ), 0, 'division by zero is bounded' );

console.log( 'ground-cover renderer-neutral density expressions: ok' );
