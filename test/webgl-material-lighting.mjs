import assert from 'node:assert/strict';
import * as THREE from 'three';
import { adaptWebGLMaterialLighting, installWebGLSceneMaterialLighting } from '../src/fallback/WebGLMaterialLighting.js';

const skyIrradianceTexture = new THREE.DataTexture( new Uint8Array( [ 80, 120, 180, 255 ] ), 1, 1, THREE.RGBAFormat );
const horizonTexture = new THREE.DataTexture( new Uint8Array( [ 100, 120, 150, 255 ] ), 1, 1, THREE.RGBAFormat );
const atmosphere = { skyIrradianceTexture, horizonTexture };

const material = new THREE.MeshStandardMaterial();
const priorHook = material.onBeforeCompile;
material.onBeforeCompile = shader => { shader.fragmentShader += '\n// prior material hook'; };
material.customProgramCacheKey = () => 'test-profile';
assert.equal( adaptWebGLMaterialLighting( THREE, material, atmosphere ), true );
assert.equal( adaptWebGLMaterialLighting( THREE, material, atmosphere ), false, 'adaptation is idempotent' );

const shader = {
	fragmentShader: '#include <lights_fragment_maps>',
	uniforms: {},
};
material.onBeforeCompile( shader, {} );
assert.match( shader.fragmentShader, /emAtmosphereWorldNormal/ );
assert.match( shader.fragmentShader, /emAtmosphereSkyIrradianceTexture/ );
assert.match( shader.fragmentShader, /getIBLRadiance\( geometryViewDir, geometryNormal, material\.roughness \)/, 'PMREM reflection remains intact' );
assert.match( shader.fragmentShader, /prior material hook/, 'existing material hooks still run' );
assert.equal( shader.uniforms.emAtmosphereSkyIrradianceTexture.value, skyIrradianceTexture );
assert.equal( shader.uniforms.emAtmosphereHorizonTexture.value, horizonTexture );
assert.equal( material.customProgramCacheKey(), 'test-profile|elsemesh-atmosphere-diffuse-v1' );
assert.notEqual( priorHook, material.onBeforeCompile );

const scene = new THREE.Scene();
const initialMaterial = new THREE.MeshStandardMaterial();
scene.add( new THREE.Mesh( new THREE.BoxGeometry(), initialMaterial ) );
assert.equal( installWebGLSceneMaterialLighting( THREE, scene, atmosphere ), 1, 'existing scene materials are adapted' );

const streamedMaterial = new THREE.MeshPhysicalMaterial();
const streamedRoot = new THREE.Group();
streamedRoot.add( new THREE.Mesh( new THREE.BoxGeometry(), streamedMaterial ) );
scene.add( streamedRoot );
assert.equal( streamedMaterial.userData.elsemeshAtmosphereLighting, true, 'added world and LOD content is adapted at insertion' );

const noAtmosphereMaterial = new THREE.MeshStandardMaterial();
assert.equal( adaptWebGLMaterialLighting( THREE, noAtmosphereMaterial, null ), false, 'worlds without atmospheric inputs keep their existing lighting' );

const grassMaterial = new THREE.MeshLambertMaterial();
assert.equal( adaptWebGLMaterialLighting( THREE, grassMaterial, atmosphere ), true, 'diffuse-only engine and world materials receive atmosphere irradiance' );
const grassShader = { fragmentShader: '#include <common>\n#include <lights_fragment_begin>', uniforms: {} };
grassMaterial.onBeforeCompile( grassShader, {} );
assert.match( grassShader.fragmentShader, /irradiance \+= emAtmosphereDiffuse/ );
assert.match( grassShader.fragmentShader, /getHemisphereLightIrradiance/, 'the Three.js direct lighting code remains intact' );

skyIrradianceTexture.dispose();
horizonTexture.dispose();
console.log( 'WebGL material lighting replaces diffuse PMREM only and preserves composed hooks' );
