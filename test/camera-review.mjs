import assert from 'node:assert/strict';
import { VIEWS, cameraPoseFromSearch, installDebugViews } from '../src/core/DebugViews.js';

assert.deepEqual( cameraPoseFromSearch( '?view=tValley' ), VIEWS.tValley, 'named mountain valley camera can be selected by URL' );
assert.equal( cameraPoseFromSearch( '?view=missing' ), null, 'unknown named cameras are ignored' );
assert.deepEqual( cameraPoseFromSearch( `?pose=${ encodeURIComponent( JSON.stringify( { p: [ 1, 2, 3 ], yaw: 0.5, pitch: - 0.2, time: 12 } ) ) }` ), { p: [ 1, 2, 3 ], yaw: 0.5, pitch: - 0.2, time: 12 }, 'recorded camera poses can be restored from URL parameters' );
assert.equal( cameraPoseFromSearch( '?pose=%7Bbad-json' ), null, 'malformed poses are ignored' );
assert.equal( cameraPoseFromSearch( `?pose=${ encodeURIComponent( JSON.stringify( { p: [ 1, 2, Infinity ], yaw: 0, pitch: 0 } ) ) }` ), null, 'non-finite camera coordinates are rejected' );
assert.equal( cameraPoseFromSearch( `?pose=${ encodeURIComponent( JSON.stringify( { p: [ 1, 2, 3 ], yaw: 0, pitch: 2 } ) ) }` ), null, 'out-of-range camera pitch is rejected' );

const originalWindow = globalThis.window;
const originalLocation = globalThis.location;
const cameraPose = {};
const velocity = {};
const app = {
	settings: { timeOfDay: 0 },
	camera: { position: { x: 0, y: 0, z: 0 }, quaternion: {} },
	setFreeCam( enabled ) { this.freeCam = enabled; },
	fly: {
		setPose( position, yaw, pitch ) { Object.assign( cameraPose, { position: position.toArray(), yaw, pitch } ); },
		velocity: { set( x, y, z ) { Object.assign( velocity, { x, y, z } ); } },
	},
};
globalThis.window = { location: { search: '?view=beach' } };
globalThis.location = globalThis.window.location;
try {
	installDebugViews( app );
	assert.equal( app.freeCam, true, 'review views detach the camera from player movement' );
	assert.deepEqual( cameraPose, { position: VIEWS.beach.p, yaw: VIEWS.beach.yaw, pitch: VIEWS.beach.pitch }, 'the shared review view is applied to the active renderer camera' );
	assert.deepEqual( velocity, { x: 0, y: 0, z: 0 }, 'review views clear previous camera motion' );
	assert.equal( app.settings.timeOfDay, VIEWS.beach.time, 'review views also synchronize time of day' );
} finally {
	if ( originalWindow === undefined ) delete globalThis.window; else globalThis.window = originalWindow;
	if ( originalLocation === undefined ) delete globalThis.location; else globalThis.location = originalLocation;
}

console.log( 'ok deterministic named and captured camera review poses' );
