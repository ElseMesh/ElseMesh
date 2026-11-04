import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webglBeachDebris } from '../src/fallback/WebGLFallback.js';

const res = 64, size = 64, origin = - size / 2;
const heights = new Float32Array( res * res ).fill( 1 );
const splat = new Uint8Array( res * res * 4 );
for ( let i = 0; i < res * res; i ++ ) splat[ i * 4 ] = 255;
const terrain = {
	res, size, origin, texel: size / res, heights, splat,
	heightAt: () => 1,
};
const camera = { position: { x: 0, z: 0 } };
const debris = webglBeachDebris( THREE, terrain, camera, null, 0 );

assert( debris.isInstancedMesh, 'packaged terrain receives the WebGL beach debris mesh' );
assert( debris.count > 0, 'the packaged sand mask places camera-local pebble detail' );
debris.geometry.dispose();
debris.material.dispose();
console.log( 'WebGL beach debris samples packaged terrain sand and sea-level-relative height' );
