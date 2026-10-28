import assert from 'node:assert/strict';
import { collisionLookaheadDistance, collisionPathReady, sweptCollisionCellKeys } from '../src/network/CollisionFrontier.js';

const from = [ 7.5, 0, 1 ];
const to = [ 8.5, 0, 1 ];
const cells = sweptCollisionCellKeys( from, to, { cellSizeMeters: 8 } );
assert.deepEqual( [ ...cells ].sort(), [ '0,0,0', '1,0,0' ], 'the player capsule spans cells on both sides of the boundary' );

const objectIDsByCell = new Map( [
	[ '0,0,0', new Set( [ 'collision-a' ] ) ],
	[ '1,0,0', new Set( [ 'collision-b' ] ) ],
] );
assert.equal( collisionPathReady( { from, to, cellSizeMeters: 8, objectIDsByCell, loadedObjectIDs: new Set( [ 'collision-a' ] ) } ), false, 'a missing next-cell collision payload closes the path' );
assert.equal( collisionPathReady( { from, to, cellSizeMeters: 8, objectIDsByCell, loadedObjectIDs: new Set( [ 'collision-a', 'collision-b' ] ) } ), true, 'the path opens when every swept cell payload is loaded' );
assert.equal( collisionPathReady( { from, to, cellSizeMeters: 8, objectIDsByCell, loadedObjectIDs: new Set( [ 'collision-a', 'collision-b' ] ), radius: 1.1 } ), false, 'larger capsules include additional cells' );
assert.throws( () => sweptCollisionCellKeys( [ 0, 0 ], to, { cellSizeMeters: 8 } ), /three finite coordinates/ );

const walkLookahead = collisionLookaheadDistance( 3, 2000, 8 );
const runLookahead = collisionLookaheadDistance( 6.2, 2000, 8 );
const flyLookahead = collisionLookaheadDistance( 48, 2000, 8 );
assert.ok( walkLookahead < runLookahead && runLookahead < flyLookahead, 'faster movement profiles request a farther collision frontier' );
assert.equal( collisionLookaheadDistance( 1000, 30000, 8 ), 512, 'lookahead remains bounded during high-latency fast flight' );

console.log( 'ok movement waits for collision payloads along the swept capsule path' );
