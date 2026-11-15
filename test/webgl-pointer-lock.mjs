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

console.log( 'ok WebGL requests pointer lock once through Input' );
