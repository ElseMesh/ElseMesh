import assert from 'node:assert/strict';
import { createWorldExtensionFrame } from '../src/network/WorldExtensionFrame.js';

const frame = createWorldExtensionFrame( {
	deltaSeconds: 0.2,
	worldTime: 8.5,
	timeOfDay: - 0.5,
	player: { position: { x: 3, y: 4, z: 5 }, velocity: { x: 1, y: 0, z: - 2 }, yaw: 1201, pitch: - 2, mode: 'boat' },
	input: {
		keys: new Set( [ 'KeyW', 'KeyA', ...Array.from( { length: 70 }, ( _, i ) => `Key${i}` ) ] ),
		pressed: new Set( [ 'KeyR' ] ),
		moveAxes: () => ( { x: 2, y: - 2, sprint: 3 } ),
		mouseDown: true,
		rightDown: false,
	},
	boat: {
		position: { x: 9, y: 1, z: 12 },
		quaternion: { toArray: () => [ 0, 0, 0, 1 ] },
		velocity: { x: 1, y: 0, z: 2 },
		angular: { x: 0, y: 0.1, z: 0 },
		speed: 2.2,
		driven: true,
		throttle: 0.7,
		steer: - 0.2,
	},
} );

assert.equal( frame.deltaSeconds, 0.1, 'extension steps receive a capped frame delta' );
assert.equal( frame.timeOfDay, 23.5, 'world clock wraps into a day' );
assert.deepEqual( frame.avatar.position, [ 3, 4, 5 ] );
assert.equal( frame.avatar.yaw, 1000, 'avatar heading is bounded' );
assert.equal( frame.avatar.pitch, - 1.5, 'avatar pitch is bounded' );
assert.ok( frame.controls.keys.length <= 64 && frame.controls.keys.every( ( key, i, all ) => i === 0 || all[ i - 1 ] <= key ), 'control key input is bounded and ordered' );
assert.deepEqual( frame.controls.move, { x: 1, y: - 1, sprint: 1 }, 'movement axes are bounded' );
assert.equal( frame.controls.leftMouse, true );
assert.deepEqual( frame.vehicle.orientation, [ 0, 0, 0, 1 ] );
assert.doesNotThrow( () => JSON.stringify( frame ), 'frame context is structured-cloneable JSON data' );
assert.equal( createWorldExtensionFrame( { deltaSeconds: 0, worldTime: 0, player: { position: { x: 2_000_000, y: 0, z: 0 } } } ).avatar.position, null, 'out-of-world coordinates are not passed to extensions' );

console.log( 'world extension frame: ok' );
