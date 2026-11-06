import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webglLightingForTime } from '../src/fallback/WebGLLighting.js';

const noon = webglLightingForTime( THREE, 12 );
assert.ok( noon.night < 0.01, 'noon remains fully day lit' );
assert.equal( noon.keyIntensity, 11, 'daylight uses the atmosphere model sun illuminance' );
assert.equal( noon.ambientIntensity, 1.5, 'daylight keeps the WebGL sky fill' );
assert.ok( noon.keyColor.r > noon.keyColor.g && noon.keyColor.g > noon.keyColor.b, 'daylight transmittance keeps blue wavelengths attenuated more strongly' );

const afternoon = webglLightingForTime( THREE, 16.2 );
const afternoonRadiance = [ afternoon.keyColor.r, afternoon.keyColor.g, afternoon.keyColor.b ].map( value => value * afternoon.keyIntensity );
const gpuSunRadianceAtBeachTime = [ 9.6354, 8.0871, 6.0994 ]; // Atmosphere GPU readback at 16.2, from the matched live capture.
for ( let i = 0; i < 3; i ++ ) assert.ok( Math.abs( afternoonRadiance[ i ] - gpuSunRadianceAtBeachTime[ i ] ) < 0.05, `WebGL sun radiance channel ${i} follows the shared atmospheric transmission` );

const night = webglLightingForTime( THREE, 21 );
assert.ok( night.night > 0.99, '21:00 uses the same night threshold as the primary renderer' );
assert.ok( night.keyDirection.y > 0, 'the moon becomes the WebGL key light below the horizon' );
assert.ok( night.keyIntensity < 0.13, 'night key intensity falls to moonlight levels' );
assert.ok( night.ambientIntensity < 0.07, 'night sky fill no longer remains at full daylight strength' );
assert.deepEqual( [ night.keyColor.r, night.keyColor.g, night.keyColor.b ], [ 0.6, 0.7, 1 ], 'moonlight uses the same blue-biased key color as WebGPU' );

const dusk = webglLightingForTime( THREE, 18.5 );
assert.ok( dusk.night > 0 && dusk.night < 1, 'WebGL transitions through twilight' );

console.log( 'WebGL lighting follows shared sun, twilight and night levels' );
