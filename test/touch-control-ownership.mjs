import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const input = await readFile( new URL( '../src/core/Input.js', import.meta.url ), 'utf8' );
const fallback = await readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' );

assert.match( input, /controls\.className = 'tw-touch-controls'/, 'the engine input layer owns the move/look touch controls' );
assert.match( input, /root\.querySelector\( '\.tw-touch-controls' \)\?\.remove\(\)/, 'recreating input replaces the existing control layer' );
assert.doesNotMatch( fallback, /elsemesh-touch-pad|touchPads/, 'the WebGL fallback does not render a second set' );

console.log( 'ok one engine-owned move/look touch control layer across renderer backends' );
