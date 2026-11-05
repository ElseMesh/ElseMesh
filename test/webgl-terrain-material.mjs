import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyHostedTerrainMaterial, prepareWebGLLODFade, webglTerrainMaterial } from '../src/fallback/WebGLFallback.js';

const terrain = {
	res: 2, size: 2, origin: 0, texel: 1,
	heights: new Float32Array( 4 ),
	rock: new Float32Array( 4 ), gully: new Uint8Array( 4 ), sand: new Uint8Array( [ 255, 255, 255, 255 ] ),
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
assert.match( shader.fragmentShader, /float dampMottle = smoothstep\( 0\.3, 0\.7,/ );
assert.match( shader.fragmentShader, /float damp = \( 1\.0 - smoothstep\( 0\.5, 1\.7, terrainHeight \+ terrainMid\.a \* 0\.3 \) \) \* sandWeight \* landWeight \* mix\( 0\.22, 0\.5, dampMottle \)/ );
assert.match( shader.fragmentShader, /float sandWeight = smoothstep\( 0\.3, 0\.72, terrainSample\.a \+ \( terrainMid\.b - 0\.5 \) \* 0\.5 \+ \( terrainMacro - 0\.5 \) \* 0\.35 \) \* notRock/ );
assert.match( shader.fragmentShader, /&& sandWeight > 0\.05/ );
assert.match( shader.fragmentShader, /wet \*= \( 1\.0 - jungleWeight \* 0\.8 \) \* landWeight/ );
assert.match( shader.fragmentShader, /\* notRock;/, 'wet shading excludes the same baked rock mask as the WebGPU terrain shader' );
assert.ok( shader.uniforms.uTerrainFlags, 'WebGL binds the baked terrain rock and jungle masks' );
assert.match( shader.fragmentShader, /float dryEdge = smoothstep\( 0\.0, 0\.6, wet \) \* \( 1\.0 - smoothstep\( 0\.6, 1\.0, wet \) \)/ );
assert.match( shader.fragmentShader, /float rillK = smoothstep\( 0\.2, 0\.9, wet \) \* smoothstep\( 0\.05, 0\.6, terrainHeight \) \* sandWeight/ );
assert.match( shader.fragmentShader, /terrainLuminance = dot\( terrainDryAlbedo \* uTerrainWetDarken, vec3\( 0\.2126, 0\.7152, 0\.0722 \) \)/ );
assert.match( shader.fragmentShader, /uTerrainSwashField/ );
assert.match( shader.fragmentShader, /float swashArrival = mix\( uTerrainSwashTimeRange/ );
assert.match( shader.fragmentShader, /float runupFront =/ );
assert.match( shader.fragmentShader, /runupMax = amp \* 2\.1 \* 0\.65 \*/, 'WebGL uses the reduced shared run-up scale for a tighter wet-sand front' );
assert.match( shader.fragmentShader, /wet = max\( wet, swashWet \)/, 'WebGL feeds its analytic swash estimate through the shared wet-surface blend' );
assert.doesNotMatch( shader.fragmentShader, /0\.36;/, 'WebGL no longer substitutes a fixed midpoint for WebGPU static dampness' );
assert.match( shader.fragmentShader, /terrainPixelWorld = max\( length\( dFdx\( terrainXZ \) \), length\( dFdy\( terrainXZ \) \) \)/, 'high-frequency sand detail fades with the projected pixel footprint instead of forming distant bands' );
assert.match( shader.fragmentShader, /terrainDetailContrast = mix\( terrainClumpContrast, 0\.85, sandCoverage \) \* mix\( 1\.0, terrainDetailVisibility, sandCoverage \)/, 'sand detail contrast is filtered by its projected pixel footprint' );
assert.match( shader.fragmentShader, /roughnessFactor = mix\( roughnessFactor, mix\( 0\.42, 0\.16, wet \), wetK \)/ );
material.userData.updateTerrainTime( 5.25 );
assert.equal( shader.uniforms.uTerrainTime.value, 5.25, 'terrain swash animation follows the shared frame time' );

const root = new THREE.Group();
const terrainMesh = new THREE.Mesh( new THREE.BufferGeometry(), new THREE.MeshStandardMaterial() );
const replacedMaterial = terrainMesh.material;
terrainMesh.castShadow = true;
root.add( terrainMesh );
applyHostedTerrainMaterial( root, material );
assert.equal( terrainMesh.material, material, 'hosted terrain assignment preserves the custom terrain shader instead of cloning it away' );
assert.equal( terrainMesh.castShadow, false, 'hosted terrain avoids self-shadow bands while remaining a shadow receiver' );
assert.equal( terrainMesh.receiveShadow, true, 'hosted terrain continues to receive object shadows' );
prepareWebGLLODFade( root );
const fadedMaterial = root.children[ 0 ].material;
const fadedShader = {
	uniforms: {},
	vertexShader: '#include <common>\n#include <begin_vertex>',
	fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <alphahash_fragment>',
};
fadedMaterial.onBeforeCompile( fadedShader );
assert.match( fadedShader.fragmentShader, /uniform sampler2D uTerrainColor/, 'authored LOD fading preserves the terrain material shader hook' );
assert.match( fadedShader.fragmentShader, /diffuseColor\.a \*= elsemeshLODFade/, 'terrain material keeps the authored LOD fade hook' );
assert.equal( fadedMaterial.customProgramCacheKey(), `${material.customProgramCacheKey()}|elsemesh-authored-lod-fade-v1`, 'the shader cache key includes both terrain shading and LOD fading' );
root.children[ 0 ].geometry.dispose();
replacedMaterial.dispose();
fadedMaterial.dispose();

material.dispose();
for ( const texture of material.userData.terrainTextures ) texture.dispose();

const surfaceWithoutShore = { ...surface, shoreField: null };
const builtInMaterial = webglTerrainMaterial( THREE, terrain, surfaceWithoutShore, { seaLevel: 1.5 } );
const builtInShader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>' };
builtInMaterial.onBeforeCompile( builtInShader );
assert.equal( builtInShader.uniforms.uTerrainSeaLevel.value, 1.5, 'built-in WebGL terrain binds sea level for the damp-sand blend without shore textures' );
assert.match( builtInShader.fragmentShader, /float dampMottle =/ );
assert.doesNotMatch( builtInShader.fragmentShader, /uTerrainShoreField/ );
builtInMaterial.dispose();
for ( const texture of builtInMaterial.userData.terrainTextures ) texture.dispose();
console.log( 'WebGL terrain material consumes package roughness, wet-darken, and shore-arrival data' );
