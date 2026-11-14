import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SHORE_DEFAULT_RUNUP } from '../src/ocean/ShoreSwash.js';

const [ webgpuSource, webglSource ] = await Promise.all( [
	readFile( new URL( '../src/ocean/ShoreWaves.js', import.meta.url ), 'utf8' ),
	readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' ),
] );
const webglSwashMath = await readFile( new URL( '../src/fallback/WebGLShoreWaveMath.js', import.meta.url ), 'utf8' );

assert.equal( SHORE_DEFAULT_RUNUP, 1.0, 'the shared shoreline runup preserves the pre-split WebGPU value' );
assert.match( webgpuSource, /runup: \[ 'f32', SHORE_DEFAULT_RUNUP \]/, 'WebGPU shore uniforms use the shared runup value' );
assert.match( webglSource, /SHORE_DEFAULT_RUNUP\.toFixed\( 2 \)/, 'WebGL shoreline shaders use the same runup value' );
assert.match( webglSwashMath, /void webglShoreSwashState\( vec2 p, float groundHeight, out float front, out float tau \)/, 'WebGL computes the swash front from fragment position and terrain height' );
assert.match( webglSource, /webglShoreSwashState\( p, groundHeight, swashFront, swashTau \)/, 'WebGL evaluates the swash front per fragment' );
assert.match( webglSource, /if \( swashFront <= 0\.0 \) discard/, 'WebGL clips the shoreline at the per-fragment swash front' );
assert.match( webglSource, /webglShoreSwashFoam\( swashFront, swashTau \)/, 'WebGL foam follows the same per-fragment swash state' );
assert.doesNotMatch( webglSource, /varying float vSwashFront|varying float vSwashFoam/, 'WebGL does not interpolate the swash edge or foam across water triangles' );

console.log( 'WebGL evaluates the shared shore runup per fragment, matching WebGPU edge and foam inputs' );
