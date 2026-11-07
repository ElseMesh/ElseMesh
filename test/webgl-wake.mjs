import assert from 'node:assert/strict';
import { WebGLWakeSim, WEBGL_WAKE_READER_GLSL } from '../src/ocean/WebGLWakeSim.js';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';
import { WebGLWaterQuery } from '../src/fallback/WebGLWaterQuery.js';

assert.match( WEBGL_WAKE_READER_GLSL, /webglWakeHeight\(vec2 xz\)/ );
assert.match( WEBGL_WAKE_READER_GLSL, /webglWakeSample\(vec2 xz\)/ );
assert.match( WEBGL_WAKE_READER_GLSL, /webglWakeFragment\(vec2 xz\)/ );
assert.match( WebGLFallback.prototype._createWebGLWake.toString(), /new WebGLWakeSim/ );
assert.match( WebGLFallback.prototype._createWebGLWake.toString(), /setWakeReader\( this\.wake\.readerUniforms \)/,
	'WebGL boat water queries receive the shared simulated wake reader' );
assert.match( WebGLWaterQuery.prototype.setWakeReader.toString(), /Object\.assign\( this\.material\.uniforms, uniforms \)/ );
assert.match( WebGLFallback.prototype._bindWakeToWater.toString(), /readerUniforms/,
	'visible WebGL water receives the same wake textures and uniforms as the boat query' );
assert.match( WebGLFallback.prototype._frame.toString(), /this\.wake\?\.update\( dt, simulationTime \)/,
	'the simulation advances by elapsed simulation delta' );
const frameSource = WebGLFallback.prototype._frame.toString();
assert( frameSource.indexOf( 'this.boat?.update( dt )' ) < frameSource.indexOf( 'this.wake?.update( dt, simulationTime )' ),
	'WakeSim consumes the boat state after the controller update, matching WebGPU ordering' );
assert.match( WebGLWakeSim.prototype.update.toString(), /Number\.isFinite\(\s*simulationTime\s*\)\s*\?\s*simulationTime\s*:\s*this\.time\s*\+\s*dt/,
	'fixed simulation time drives wake noise without changing the solver delta' );

console.log( 'WebGL wake reader integration: ok' );
