import assert from 'node:assert/strict';
import { Player } from '../src/player/Player.js';

const player = new Player( {
	camera: {}, input: {}, terrain: { heightAt: () => 0 },
	colliders: { groundHeightAt: () => - Infinity }, query: null, boat: null,
} );

assert.equal( player.slot, null, 'a dry-world player does not allocate a water-query slot' );
assert.equal( player.waterHeight(), 0, 'a dry-world player treats water height as absent' );

const vehicle = {
	driven: true, throttle: 1, speed: 0, moored: false,
	position: { x: 0, y: 0, z: 0, distanceTo: () => 0 },
	toWorld: () => ( { x: 0, y: 0, z: 0 } ), getYaw: () => 0,
};
player.boat = vehicle;
player.exitBoat( { out: { x: 1, z: 2 }, g: 0 }, 1 );
assert.equal( vehicle.moored, false, 'a vehicle without an authored dock is not marked moored just because it stopped' );

console.log( 'Dry-world player does not require a water query.' );
