import assert from 'node:assert/strict';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';

const calls = [];
const fallback = Object.create( WebGLFallback.prototype );
fallback.worldLink = { worldId: 'elsemesh:review' };
fallback.reviewPose = { p: [ 46.08, 23.35, - 53.27 ], yaw: 1.87, pitch: - 0.57 };
fallback.camera = {
	position: { set: ( ...pose ) => calls.push( [ 'position', ...pose ] ) },
	rotation: { order: 'XYZ', set: ( ...pose ) => calls.push( [ 'rotation', ...pose ] ) },
	updateMatrixWorld: () => calls.push( [ 'matrix' ] ),
};

assert.equal( fallback._applyReviewCameraPose(), true, 'hosted WebGL applies the requested camera view after presence admission' );
assert.deepEqual( calls, [
	[ 'position', 46.08, 23.35, - 53.27 ],
	[ 'rotation', - 0.57, 1.87, 0, 'YXZ' ],
	[ 'matrix' ],
] );
assert.equal( fallback.reviewCameraOnly, true, 'review camera does not move the admitted player' );

fallback.worldLink = null;
assert.equal( fallback._applyReviewCameraPose(), false, 'built-in WebGL keeps its authored local spawn path' );

console.log( 'hosted WebGL review camera remains separate from presence spawn' );
