import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SHORE_DEFAULT_RUNUP } from '../src/ocean/ShoreSwash.js';
import { SHORE_WATER_TURBIDITY } from '../src/ocean/WaterDefaults.js';

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
assert.equal( SHORE_WATER_TURBIDITY, 0.16, 'the shared surf turbidity preserves the WebGPU optical default' );
assert.match( webgpuSource, /turbidity: \[ 'f32', SHORE_WATER_TURBIDITY \]/, 'WebGPU shore material reads the shared surf turbidity' );
assert.match( webglSource, /shoreMedium = smoothstep\( 4\.5, 1\.2, signedDepth \).*uShoreTurbidity/, 'WebGL applies the same depth fade and shared surf turbidity' );
assert.match( webglSource, /\* exposure \* uShoreTurbidity/, 'WebGL uses the authored shoreline exposure directly, matching WebGPU' );
assert.match( webglSource, /uWaterAbsorption \+ vec3\( 0\.1, 0\.2, 0\.62 \) \* shoreMedium/, 'WebGL adds the WebGPU surf absorption coefficients' );
assert.match( webglSource, /uWaterScattering \+ vec3\( 0\.9, 1\.0, 0\.85 \) \* shoreMedium/, 'WebGL adds the WebGPU surf scattering coefficients' );

console.log( 'WebGL uses shared per-fragment swash state and surf-medium coefficients' );
