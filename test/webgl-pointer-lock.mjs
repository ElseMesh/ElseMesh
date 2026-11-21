import assert from 'node:assert/strict';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';

const calls = [];
const fallback = Object.create( WebGLFallback.prototype );
fallback.input = { requestLock() { calls.push( 'input' ); } };
fallback.engine = { canvas: { requestPointerLock() { calls.push( 'canvas' ); } } };

fallback.requestLock();
assert.deepEqual( calls, [ 'input' ], 'the input lock request must not trigger a second canvas request' );

fallback.input = null;
fallback.requestLock();
assert.deepEqual( calls, [ 'input', 'canvas' ], 'canvas pointer lock remains a fallback when Input is unavailable' );

let flashlightToggles = 0, portalUses = 0, portalAvailable = false;
fallback.webglLocalLights = { toggleFlashlight() { flashlightToggles ++; } };
fallback.worldLink = {};
fallback._useNearestPortal = () => { portalUses ++; return portalAvailable; };
assert.equal( fallback._handleUnhandledKeyDown( { code: 'KeyL' } ), true, 'WebGL flashlight shortcut runs after world key handling declines it' );
assert.equal( flashlightToggles, 1 );
assert.equal( fallback._handleUnhandledKeyDown( { code: 'KeyE' } ), false, 'E remains available to normal gameplay when no portal is in range' );
portalAvailable = true;
assert.equal( fallback._handleUnhandledKeyDown( { code: 'KeyE' } ), true, 'nearby portal use claims E through the shared input route' );
assert.equal( portalUses, 2 );

console.log( 'ok WebGL pointer lock and post-world engine shortcuts use the shared Input route' );
