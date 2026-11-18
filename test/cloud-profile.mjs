import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLOUD_PROFILE } from '../src/sky/CloudProfile.js';

assert.deepEqual( CLOUD_PROFILE, { coverage: 0.45, densityScale: 0.07, bottom: 750, top: 2400 }, 'shared cloud defaults match original Tidewater WebGPU' );

const [ webgpu, webgl ] = await Promise.all( [
	readFile( new URL( '../src/sky/Clouds.js', import.meta.url ), 'utf8' ),
	readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' ),
] );
for ( const field of [ 'coverage', 'densityScale', 'bottom', 'top' ] ) {
	assert.match( webgpu, new RegExp( `${field}: \\[ 'f32', CLOUD_PROFILE\\.${field} \\]` ), `WebGPU consumes shared cloud ${field}` );
	assert.match( webgl, new RegExp( `uCloud${field[0].toUpperCase()}${field.slice(1)}: \\{ value: CLOUD_PROFILE\\.${field} \\}` ), `WebGL consumes shared cloud ${field}` );
}

console.log( 'WebGPU and WebGL consume the original Tidewater cloud profile' );
