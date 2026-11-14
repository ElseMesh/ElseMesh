import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SHORE_DEFAULT_RUNUP } from '../src/ocean/ShoreSwash.js';

const [ webgpuSource, webglSource ] = await Promise.all( [
	readFile( new URL( '../src/ocean/ShoreWaves.js', import.meta.url ), 'utf8' ),
	readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' ),
] );

assert.equal( SHORE_DEFAULT_RUNUP, 1.0, 'the shared shoreline runup preserves the pre-split WebGPU value' );
assert.match( webgpuSource, /runup: \[ 'f32', SHORE_DEFAULT_RUNUP \]/, 'WebGPU shore uniforms use the shared runup value' );
assert.match( webglSource, /SHORE_DEFAULT_RUNUP\.toFixed\( 2 \)/, 'WebGL shoreline shaders use the same runup value' );

console.log( 'Shared WebGPU/WebGL shore runup matches the pre-split value' );
