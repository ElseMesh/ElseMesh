import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webglBeachDebris } from '../src/fallback/WebGLBeachDebris.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import '../src/fallback/WebGLGroundDetailFieldAdapter.js';

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

const densityMask = { res: 64, texel: 1, data: new Uint8Array( 64 * 64 * 4 ) };
const emptyField = webglBeachDebris( THREE, terrain, camera, null, 0, densityMask );
assert.equal( emptyField.count, 0, 'authored zero density suppresses all WebGL ground details' );
emptyField.geometry.dispose();
emptyField.material.dispose();
densityMask.data.fill( 255 );
const authoredField = webglBeachDebris( THREE, terrain, camera, null, 0, densityMask );
assert( authoredField.count > 0, 'authored RGBA densities place camera-local WebGL ground details' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.ground-detail-field/1' ), 'function' );
authoredField.geometry.dispose();
authoredField.material.dispose();
console.log( 'WebGL ground-detail field consumes authored density data' );
