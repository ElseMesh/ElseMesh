import assert from 'node:assert/strict';
import { GroundCoverCellPlanner } from '../src/engine/render/GroundCoverCellPlanner.js';

const terrain = { origin: - 4, size: 8, texel: 1, res: 9, heights: Float32Array.from( { length: 81 }, ( _, index ) => index % 9 ) };
const density = { origin: - 4, size: 8, res: 8, data: new Uint8Array( 8 * 8 * 4 ).fill( 255 ) };
const planner = new GroundCoverCellPlanner( {
	terrain,
	density,
	cellSize: 2,
	levels: [ { maxDistance: 1.5, capacity: 32 }, { maxDistance: 3.5, capacity: 32 }, { maxDistance: 5.5, capacity: 32 } ],
} );

const levels = planner.update( { x: - 3, z: - 3 } );
assert.ok( levels[ 0 ].count > 0, 'near cells are selected' );
assert.ok( levels[ 1 ].count > 0, 'middle-distance cells are selected' );
assert.ok( levels[ 2 ].count > 0, 'far cells are selected' );
const selected = levels.flatMap( level => Array.from( level.cells.subarray( 0, level.count ) ) );
assert.equal( new Set( selected ).size, selected.length, 'each occupied cell is assigned to one LOD level' );
assert.equal( planner.lodIndexAtDistance( 1 ), 0, 'near candidates use the highest detail' );
assert.equal( planner.lodIndexAtDistance( 1.41, 0 ), 0, 'LOD transitions retain the near detail at their start' );
assert.equal( planner.lodIndexAtDistance( 1.5, 0.49 ), 1, 'deterministic samples below the transition probability select middle detail' );
assert.equal( planner.lodIndexAtDistance( 1.5, 0.51 ), 0, 'deterministic samples above the transition probability retain near detail' );
assert.equal( planner.lodIndexAtDistance( 1.59, 1 ), 1, 'LOD transitions select the next band at their end' );
assert.equal( planner.lodIndexAtDistance( 3.29, 0 ), 1, 'the middle band remains selected at its transition start' );
assert.equal( planner.lodIndexAtDistance( 3.71, 1 ), 2, 'the far band is selected at its transition end' );
assert.equal( planner.lodIndexAtDistance( 5.6 ), - 1, 'candidates beyond the final range are hidden' );

const origin = [ 0, 0 ];
planner.cellOrigin( 0, origin );
assert.deepEqual( origin, [ - 4, - 4 ], 'cell coordinates are world-space and origin aligned' );

const culled = planner.update( { x: - 3, z: - 3 }, () => false );
assert.deepEqual( culled.map( level => level.count ), [ 0, 0, 0 ], 'backend frustum culling can reject every selected cell' );

const empty = new GroundCoverCellPlanner( {
	terrain,
	density: { ...density, data: new Uint8Array( density.data.length ) },
	cellSize: 2,
} );
assert.deepEqual( empty.update( { x: 0, z: 0 } ).map( level => level.count ), [ 0, 0, 0 ], 'empty density fields allocate no visible cells' );

console.log( 'ground-cover cell planner selection, LOD partition, origin, culling, and empty-field checks passed' );
