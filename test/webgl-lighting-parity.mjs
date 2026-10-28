import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webglLightingForTime } from '../src/fallback/WebGLLighting.js';

const noon = webglLightingForTime( THREE, 12 );
assert.ok( noon.night < 0.01, 'noon remains fully day lit' );
assert.equal( noon.keyIntensity, 2.4, 'daylight keeps the WebGL sun key' );
assert.equal( noon.ambientIntensity, 1.5, 'daylight keeps the WebGL sky fill' );

const night = webglLightingForTime( THREE, 21 );
assert.ok( night.night > 0.99, '21:00 uses the same night threshold as the primary renderer' );
assert.ok( night.keyDirection.y > 0, 'the moon becomes the WebGL key light below the horizon' );
assert.ok( night.keyIntensity < 0.13, 'night key intensity falls to moonlight levels' );
assert.ok( night.ambientIntensity < 0.07, 'night sky fill no longer remains at full daylight strength' );

const dusk = webglLightingForTime( THREE, 18.5 );
assert.ok( dusk.night > 0 && dusk.night < 1, 'WebGL transitions through twilight' );

console.log( 'WebGL lighting follows shared sun, twilight and night levels' );
