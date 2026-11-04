import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webglTerrainMaterial } from '../src/fallback/WebGLFallback.js';

const terrain = {
	res: 2, size: 2, origin: 0, texel: 1,
	heights: new Float32Array( 4 ),
};
const surface = {
	normal: new Uint8Array( 16 ),
	splat: new Uint8Array( [ 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0 ] ),
	detailWidth: 1, detailHeight: 1, detail: new Uint8Array( 4 ),
	shoreField: { res: 2, origin: 0, size: 2, data: new Float32Array( [ 0, 1, 0, 1, 1, 1, 0, 2, 2, 1, 0, 3, 3, 1, 0, 4 ] ) },
	metadata: { material: { roughness: 0.9, wetDarken: 0.58 } },
};

const material = webglTerrainMaterial( THREE, terrain, surface, { seaLevel: 1.5 } );
assert.equal( material.roughness, 0.9, 'WebGL uses the roughness declared by the signed terrain package' );
const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>' };
material.onBeforeCompile( shader );
assert.equal( shader.uniforms.uTerrainWetDarken.value, 0.58, 'WebGL uses the package wet-darken parameter' );
assert.equal( shader.uniforms.uTerrainSeaLevel.value, 1.5, "WebGL swash uses the hosted world's sea level" );
assert.match( shader.fragmentShader, /float dampSand =/ );
assert.match( shader.fragmentShader, /\) \* 0\.36;/, 'WebGL approximates the midpoint of WebGPU static dampness while swash uses the packaged arrival field' );
assert.match( shader.fragmentShader, /mix\( 1\.0, uTerrainWetDarken, terrainWetness \)/ );
assert.match( shader.fragmentShader, /uTerrainSwashField/ );
assert.match( shader.fragmentShader, /float swashArrival = mix\( uTerrainSwashTimeRange/ );
assert.match( shader.fragmentShader, /float runupFront =/ );
assert.match( shader.fragmentShader, /roughnessFactor = mix\( roughnessFactor, mix\( 0\.42, 0\.16, wetSand \), terrainWetness \)/ );
material.userData.updateTerrainTime( 5.25 );
assert.equal( shader.uniforms.uTerrainTime.value, 5.25, 'terrain swash animation follows the shared frame time' );

material.dispose();
for ( const texture of material.userData.terrainTextures ) texture.dispose();
console.log( 'WebGL terrain material consumes package roughness, wet-darken, and shore-arrival data' );
