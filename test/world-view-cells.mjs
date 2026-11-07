import assert from 'node:assert/strict';
import { Euler, PerspectiveCamera } from '../src/engine/index.js';
import { worldViewCellCoordinates } from '../src/network/WorldViewCells.js';

const camera = new PerspectiveCamera( 60, 1.8, 0.1, 1000 );
camera.position.set( 0, 8.62, 90 );
camera.quaternion.setFromEuler( new Euler( - 0.1, Math.PI, 0, 'YXZ' ) );

const cells = worldViewCellCoordinates( camera, 8, 32 );
const keys = new Set( cells.map( cell => cell.join( ',' ) ) );
assert.ok( keys.has( '0,0,15' ), 'a cell whose center is just beyond max view distance is included when its bounds intersect the visible frustum' );
assert.ok( ! keys.has( '0,0,6' ), 'cells behind the camera are excluded' );
assert.ok( cells.some( cell => cell[ 2 ] >= 15 ), 'visible cells beyond the old four-cell spherical prefetch are queried' );

camera.quaternion.setFromEuler( new Euler( 0, Math.PI / 2, 0, 'YXZ' ) );
const sideView = new Set( worldViewCellCoordinates( camera, 8, 32 ).map( cell => cell.join( ',' ) ) );
assert.ok( ! sideView.has( '0,0,15' ), 'the cell set follows camera orientation when the player looks away' );

assert.throws( () => worldViewCellCoordinates( camera, 8, 10000 ), /candidate cells; limit is/, 'pathological view distances fail before scanning an unbounded grid' );

console.log( 'ok view-frustum cell query includes visible far cells and bounds candidate scanning' );
