import assert from 'node:assert/strict';
import { selectLocalRegionStartupObjects } from '../src/network/LocalRegionStartup.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';

const camera = new PerspectiveCamera( 60, 1, 0.1, 200 );
camera.position.set( 0, 1.62, 0 );
camera.lookAt( 0, 1.62, -1 );
camera.updateMatrixWorld( true );
let collisionPath;
const connector = {
	localOnly: true,
	cellSizeMeters: 8,
	collisionObjectIDsAlongPath: ( from, to ) => {
		collisionPath = { from, to };
		return [ 'spawn-collision' ];
	},
};
const manifest = {
	assets: [],
	rules: { spawnRadius: 0 },
	objects: [
		{ id: 'visible-floor', assetId: 'visual-floor', priority: 'visible', transform: { position: [ 0, 0, -6 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 2 } },
		{ id: 'off-view-visual', assetId: 'visual-off-view', priority: 'visible', transform: { position: [ 80, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 2 } },
		{ id: 'nearby-collision', assetId: 'collision-nearby', priority: 'visible', collisionPayload: true, transform: { position: [ 0, 0, -6 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 2 } },
		{ id: 'spawn-collision', assetId: 'collision-spawn', priority: 'background', collisionPayload: true, transform: { position: [ 80, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 2 } },
		{ id: 'background-visual', assetId: 'visual-background', priority: 'background', transform: { position: [ 0, 0, -6 ], yaw: 0 }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 2 } },
	],
};
const selected = selectLocalRegionStartupObjects( connector, manifest, camera, { position: [ 0, 1.62, 0 ] } );
const selectedIDs = selected.map( object => object.id );

assert.ok( selectedIDs.includes( 'visible-floor' ), 'visible startup geometry loads before the rest of the world' );
assert.ok( selectedIDs.includes( 'spawn-collision' ), 'collision intersecting the spawn capsule is selected even when outside the camera view' );
assert.ok( ! selectedIDs.includes( 'nearby-collision' ), 'unneeded nearby collision does not delay initial rendering' );
assert.ok( ! selectedIDs.includes( 'off-view-visual' ), 'off-view visuals do not delay startup' );
assert.ok( ! selectedIDs.includes( 'background-visual' ), 'background-priority visuals remain deferred' );
assert.equal( collisionPath.from.y, 0, 'initial collision frontier starts at the player feet, not the camera eye' );
assert.deepEqual( collisionPath.from, collisionPath.to, 'initial collision request covers the spawn capsule position' );
console.log( 'ok local startup prioritizes visible geometry and collision at the player spawn' );
