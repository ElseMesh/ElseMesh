import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Colliders, setMovementSupportKernel } from '../src/world/Colliders.js';
import { createMovementSupportKernel } from '../src/world/MovementSupportKernel.js';
import { Vector3 } from '../src/engine/math/Vector3.js';

function fixture() {
	const colliders = new Colliders();
	colliders.addBox( new Vector3( 4, 1, 4 ), new Vector3( 1, 1, 1 ), 0.3, { walkable: true } );
	colliders.addConvex( [
		new Vector3( 0, 1, 0 ), new Vector3( 1, 1, 0 ), new Vector3( 0, 1, 1 ), new Vector3( 0, 0, 0 ),
	], [ 0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0 ] );
	colliders.addHeightfield( [ 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1 ], 2, 2, {
		position: new Vector3( 10, 1, 10 ), scale: new Vector3( 1, 2, 1 ),
	} );
	return colliders;
}

const wasm = await readFile( 'native/movement/elsemesh_movement.wasm' );
const kernel = await createMovementSupportKernel( wasm );
const reference = fixture();
const accelerated = fixture();
const queries = [
	[ 4, 4, 4, 0, 18.2, 0 ], [ 0.25, 0.25, 2, 0, 34, 0.42 ],
	[ 10.5, 10.5, 3, 0, 18.2, 0 ], [ 50, 50, 3, 0, 18.2, 0 ],
];
for ( let i = 0; i < 256; i ++ ) {
	const x = ( ( i * 37 ) % 1600 ) / 100 - 2;
	const z = ( ( i * 61 ) % 1600 ) / 100 - 2;
	queries.push( [ x, z, 4, ( i % 5 ) * 0.03, i % 2 ? 34 : 18.2, i % 3 ? 0.42 : 0 ] );
}
const expected = queries.map( ( [ x, z, maxY, pad, slope, radius ] ) => reference.groundHeightAt( x, z, maxY, pad, slope, radius ) );
setMovementSupportKernel( kernel );
try {
	for ( let i = 0; i < queries.length; i ++ ) {
		const [ x, z, maxY, pad, slope, radius ] = queries[ i ];
		const actual = accelerated.groundHeightAt( x, z, maxY, pad, slope, radius );
		assert.ok( Object.is( actual, expected[ i ] ) || Math.abs( actual - expected[ i ] ) < 1e-10,
			`query ${ i } differs: ${ actual } versus ${ expected[ i ] }` );
	}
	const box = accelerated.boxes[ 0 ];
	accelerated.removeBox( box );
	assert.equal( accelerated.groundHeightAt( 4, 4, 4 ), - Infinity, 'snapshot revision uploads collider removals' );
} finally {
	setMovementSupportKernel( null );
}
console.log( `ok shared WebAssembly support kernel matches JavaScript for ${ queries.length } queries and refreshed collider snapshots` );
