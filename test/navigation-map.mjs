import assert from 'node:assert/strict';
import { navigationMapPosition, normalizeNavigationHeading } from '../src/ui/NavigationMap.js';
import { App } from '../src/App.js';
import { PerspectiveCamera as EngineCamera } from '../src/engine/index.js';
import { PerspectiveCamera as ThreeCamera } from 'three';

const bounds = { minX: -20, maxX: 20, minZ: 10, maxZ: 50 };
assert.deepEqual( navigationMapPosition( bounds, { x: -20, z: 10 } ), { x: 0, y: 0, visible: true }, 'north-west world bound maps to the top-left of north-up art' );
assert.deepEqual( navigationMapPosition( bounds, { x: 20, z: 50 } ), { x: 1, y: 1, visible: true }, 'south-east world bound maps to the bottom-right' );
assert.deepEqual( navigationMapPosition( bounds, { x: 0, z: 30 } ), { x: 0.5, y: 0.5, visible: true }, 'the map center tracks the matching world position' );
assert.equal( navigationMapPosition( bounds, { x: 21, z: 30 } ).visible, false, 'the player marker hides when the player leaves authored map bounds' );
assert.equal( navigationMapPosition( bounds, null ), null );
assert.deepEqual( navigationMapPosition( bounds, { x: -10, z: 30 }, 2, 1 ), { x: 0, y: 0.5, visible: true }, 'wide map projection follows the centered cover crop' );
assert.equal( navigationMapPosition( bounds, { x: -20, z: 30 }, 2, 1 ).visible, false, 'a point cropped out of a wide map is hidden' );
assert.deepEqual( navigationMapPosition( bounds, { x: 0, z: 20 }, 1, 2 ), { x: 0.5, y: 0, visible: true }, 'tall map projection follows the centered cover crop' );
assert.equal( navigationMapPosition( bounds, { x: 0, z: 30 }, 0, 0 ), null, 'a map marker waits until the image dimensions are known' );
assert.equal( normalizeNavigationHeading( -90 ), 270 );
assert.equal( normalizeNavigationHeading( 450 ), 90 );
assert.equal( normalizeNavigationHeading( NaN ), 0 );

for ( const Camera of [ EngineCamera, ThreeCamera ] ) {
	const camera = new Camera();
	camera.lookAt( 1, 0, 0 );
	const experience = { navigation: { compass: { north: 'N', east: 'E', south: 'S', west: 'W' } } };
	const position = { x: 3, z: 4 };
	let hudState;
	App.prototype.updateNavigationHUD.call( { hud: { setNavigationHUD: state => { hudState = state; } } }, camera, { position }, experience );
	assert.equal( hudState.position, position, 'the HUD receives the player position' );
	assert.equal( hudState.navigation, experience.navigation, 'the HUD receives the active world configuration' );
	assert.ok( Math.abs( hudState.heading - 90 ) < 1e-6, 'both renderer cameras supply the same eastward heading' );
}

console.log( 'World navigation map projection and heading normalization pass.' );
