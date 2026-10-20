import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from '../src/engine/math/index.js';
import { Player } from '../src/player/Player.js';

const player = Object.create( Player.prototype );
player.boat = {
	position: new Vector3(),
	quaternion: new Quaternion(),
	design: {
		colliders: [ { center: new Vector3( 1, 0.8, 0 ), half: new Vector3( 0.1, 0.8, 1 ), solid: true } ],
		lines: { deckY: 0.5, zAft: - 4, wlEnd: 4, halfBeamAt: () => 1 },
	},
};

const swimmer = new Vector3( 0, 0, 0 );
player.resolveBoatCollision( swimmer, 1 );
assert.ok( Math.abs( swimmer.x ) >= 1.239, 'swimmers are pushed outside the hull side' );

const walker = new Vector3( 0.8, 0.8, 0 );
player.resolveBoatCollision( walker, 1.75 );
assert.ok( walker.x <= 0.69 || walker.x >= 1.31, 'walkers are blocked by solid boat-side geometry' );

console.log( 'ok boat-side collision keeps swimmers out and walkers from crossing solid geometry' );
