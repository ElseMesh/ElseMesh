import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webglBeachDebris } from '../src/fallback/WebGLBeachDebris.js';
import { stonePart as tidewaterStonePart } from '../src/world/debris/DebrisShapes.js';
import { stonePart as groundDetailStonePart } from '../src/engine/render/GroundDetailGeometry.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import '../src/fallback/WebGLGroundDetailFieldAdapter.js';

for ( const variant of [ [ 20, 0, 0.8 ], [ 21, 0, 0.1 ], [ 30, 1, 0.05 ], [ 31, 1, 0.5 ], [ 35, 1, 0.5 ] ] ) {
	const expected = tidewaterStonePart( ...variant ), actual = groundDetailStonePart( ...variant );
	assert.deepEqual( actual.idx, expected.idx, 'ground-detail stone topology matches Tidewater geometry' );
	for ( const key of [ 'p', 'n', 'uv' ] ) {
		assert.equal( actual[ key ].length, expected[ key ].length );
		for ( let i = 0; i < actual[ key ].length; i ++ ) assert( Math.abs( actual[ key ][ i ] - expected[ key ][ i ] ) < 1e-6, `ground-detail ${key}[${i}] matches Tidewater geometry` );
	}
}

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

assert( debris.isMesh, 'packaged terrain receives the WebGL beach debris mesh' );
assert.equal( debris.isInstancedMesh, undefined, 'ground detail batches to one merged draw mesh' );
assert( debris.count > 0, 'the packaged sand mask places camera-local pebble detail' );
debris.geometry.dispose();
debris.material.dispose();

const densityMask = { res: 64, texel: 1, data: new Uint8Array( 64 * 64 * 4 ) };
const emptyField = webglBeachDebris( THREE, terrain, camera, null, 0, densityMask );
assert.equal( emptyField.count, 0, 'authored zero density suppresses all WebGL ground details' );
emptyField.geometry.dispose();
emptyField.material.dispose();
densityMask.data.fill( 255 );
const terrainDetailTexture = new THREE.DataTexture( new Uint8Array( [ 128, 128, 128, 128 ] ), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType );
terrainDetailTexture.needsUpdate = true;
const authoredField = webglBeachDebris( THREE, terrain, camera, null, 0, densityMask, terrainDetailTexture );
assert( authoredField.count > 0, 'authored RGBA densities place camera-local WebGL ground details' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.ground-detail-field/1' ), 'function' );
assert.equal( authoredField.material.roughness, 0.8, 'ground-detail stones use the Tidewater field base roughness' );
assert.equal( authoredField.material.flatShading, false, 'ground-detail stones use smooth vertex normals' );
assert.equal( authoredField.material.userData.beachTerrainDetailTexture, terrainDetailTexture, 'the WebGL pebble material receives the world terrain detail texture' );
assert.equal( authoredField.geometry.attributes.aGroundDetailSeed.count, authoredField.geometry.attributes.position.count, 'the WebGL pebble shader receives Tidewater seed data for material variants' );
assert.equal( authoredField.geometry.attributes.aGroundDetailGroundY.count, authoredField.geometry.attributes.position.count, 'the WebGL pebble shader receives ground height for contact shading' );
assert.equal( authoredField.geometry.attributes.aGroundDetailPalette.count, authoredField.geometry.attributes.position.count, 'the WebGL pebble shader receives authored palette density' );
const shader = {
	uniforms: {},
	vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
	fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <aomap_fragment>\n}',
};
authoredField.material.onBeforeCompile( shader );
assert.match( shader.vertexShader, /aGroundDetailRadius/ );
assert.match( shader.fragmentShader, /texture2D\( uBeachTerrainDetail/ );
assert.match( shader.fragmentShader, /roughnessFactor = mix\( roughnessFactor, 0\.22/ );
assert.match( shader.fragmentShader, /beachDetailPits/ );
assert.match( shader.fragmentShader, /beachGlass/ );
assert.match( shader.fragmentShader, /beachDetailAO/ );
assert.equal( shader.uniforms.uBeachTerrainDetail.value, terrainDetailTexture );
const wetTerrain = { ...terrain, heightAt: () => 0.2 };
const wetField = webglBeachDebris( THREE, wetTerrain, camera, null, 0, densityMask );
assert.equal( wetField.count, authoredField.count, 'wetness changes shading without changing authored placement' );
assert( wetField.geometry.attributes.position.array[ 1 ] < authoredField.geometry.attributes.position.array[ 1 ], 'nearshore shading follows the pebble world height' );
authoredField.geometry.dispose();
authoredField.material.dispose();
wetField.geometry.dispose();
wetField.material.dispose();
terrainDetailTexture.dispose();
console.log( 'WebGL ground-detail field consumes authored density data' );
