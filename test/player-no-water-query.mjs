import assert from 'node:assert/strict';
import { Player } from '../src/player/Player.js';

const player = new Player( {
	camera: {}, input: {}, terrain: { heightAt: () => 0 },
	colliders: { groundHeightAt: () => - Infinity }, query: null, boat: null,
} );

assert.equal( player.slot, null, 'a dry-world player does not allocate a water-query slot' );
assert.equal( player.waterHeight(), 0, 'a dry-world player treats water height as absent' );

console.log( 'Dry-world player does not require a water query.' );
