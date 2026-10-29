import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';

const joe = { x: 123, y: 4, z: -456 };
const marta = { x: 222, y: 5, z: -333 };
const game = { vendorLocations: new Map( [ [ 'joe', joe ], [ 'marta', marta ] ] ) };

assert.equal( Game.prototype.vendorPosition.call( game, 'joe' ), joe, 'Joe marker reads the active world vendor position' );
assert.equal( Game.prototype.vendorPosition.call( game, 'marta' ), marta, 'Marta marker reads the active world vendor position' );
assert.equal( Game.prototype.vendorPosition.call( game, 'unknown' ), null, 'missing world vendors have no stale built-in marker' );

console.log( 'game vendor locations: ok' );
