import * as THREE from 'three';
import { createWebGLOctahedralCanopyMaterial } from '../src/fallback/WebGLOctahedralCanopyMaterial.js';
import { createWebGLOctahedralCanopyTexture } from '../src/fallback/WebGLOctahedralCanopyTexture.js';
import { installWebGLSceneMaterialLighting } from '../src/fallback/WebGLMaterialLighting.js';
import { WebGLSunShadows } from '../src/fallback/WebGLSunShadows.js';

const result = document.querySelector( '#result' );
const canvas = document.querySelector( '#canvas' );
const atlasData = pixel => {
	const data = new Uint8Array( 64 * 32 * 4 );
	for ( let offset = 0; offset < data.length; offset += 4 ) data.set( pixel, offset );
	return { data, width: 64, height: 32, format: 'rgba8unorm' };
};
const descriptor = {
	format: 'elsemesh.octahedral-canopy/1',
	projection: { type: 'hemi-octahedral/1', framesPerSide: 2 },
	frameGrid: { columns: 4, rows: 2, frameWidth: 16, frameHeight: 16 },
	variantGroups: [
		{ id: 'trees', bounds: { center: [ 0, 2, 0 ], halfHeight: 2 } },
		{ id: 'shrubs', bounds: { center: [ 0, 1, 0 ], halfHeight: 1 } },
	],
	appearance: {
		color: { instanceTintScale: 0.36, instanceTintBias: 0.74, leafDesaturation: 0.85, impostorBrightnessScale: 1.4, barkDark: 0x1c1a13, barkLight: 0x2e2b20, leafBlendStart: 0.05, leafBlendEnd: 0.55, impostorSaturation: 1.25 },
		lighting: { bakedOcclusionFloor: 0.26, bakedOcclusionExponent: 2, brightnessScale: 0.6, brightnessBias: 0.7, roughness: 0.85, specularIntensity: 0.12, translucency: 0.35 },
		wind: { gustAmplitude: 0.009, gustBias: 0.3, gustScale: 0.8, gustTravelSpeedScale: 0.7, gustTravelSpeedBias: 1.5, waveAmplitude: 0.0045, waveFrequency: 0.9, waveGustBias: 0.4, seedPhaseScale: 6.2832, heightScale: 0.45 },
		palette: {
			trees: [ { low: 0x283a1b, high: 0x364a23, dry: 0x5e4a2e, dryStart: 0.96, dryEnd: 0.995, dryMix: 0.5 } ],
			shrubs: [ { low: 0x3f5522, high: 0x52662a }, { low: 0x2c421e, high: 0x44561f } ],
			dryTree: { low: 0x5c5234, high: 0x6e5a3a, mix: 0.5 }, floweringTree: 0x8a4a2c,
		},
		species: { treeSeedMultiplier: 5.31, shrubSeedMultiplier: 3.17, shrubVariantThresholds: [ 0.45 ], dryTreeChance: 0.035, floweringTreeThreshold: 0.988 },
	},
};

let renderer, geometry, material, materialWithoutTranslucency, shadows;
const textures = [];
try {
	const atlasA = createWebGLOctahedralCanopyTexture( THREE, atlasData( [ 200, 255, 128, 255 ] ), 'canopy-test-material' );
	const atlasB = createWebGLOctahedralCanopyTexture( THREE, atlasData( [ 128, 128, 255, 255 ] ), 'canopy-test-normal' );
	const gust = createWebGLOctahedralCanopyTexture( THREE, atlasData( [ 128, 128, 128, 128 ] ), 'canopy-test-gust' );
	textures.push( atlasA, atlasB, gust );
	renderer = new THREE.WebGLRenderer( { canvas, antialias: false, preserveDrawingBuffer: true } );
	renderer.setSize( canvas.width, canvas.height, false );
	renderer.shadowMap.enabled = true;
	renderer.debug.checkShaderErrors = true;
	const shaderErrors = [];
	renderer.debug.onShaderError = ( gl, program, vertexShader, fragmentShader ) => shaderErrors.push( {
		program: gl.getProgramInfoLog( program ),
		vertex: gl.getShaderInfoLog( vertexShader ),
		fragment: gl.getShaderInfoLog( fragmentShader ),
	} );
	material = createWebGLOctahedralCanopyMaterial( THREE, descriptor, {
		materialAtlas: atlasA, normalExposureAtlas: atlasB, gustTexture: gust,
		cameraPosition: [ 0, 0, 5 ],
		windDirection: [ 0.35, 0.94 ], windSpeed: 7, time: 1, frameIndex: 0,
	} );
	const noTranslucency = { ...descriptor, appearance: { ...descriptor.appearance, lighting: { ...descriptor.appearance.lighting, translucency: 0 } } };
	materialWithoutTranslucency = createWebGLOctahedralCanopyMaterial( THREE, noTranslucency, {
		materialAtlas: atlasA, normalExposureAtlas: atlasB, gustTexture: gust,
		cameraPosition: [ 0, 0, 5 ],
		windDirection: [ 0.35, 0.94 ], windSpeed: 7, time: 1, frameIndex: 0,
	} );
	geometry = new THREE.PlaneGeometry( 2, 2 );
	const packed = new THREE.InstancedInterleavedBuffer( new Float32Array( [ 0.25, 0, 5, 0, 1, 1, 1, 0, 12.5, 0, 0, 0, 0, 1, 2, 1, 0.6, 0.3, 0.1, 1 ] ), 20 );
	geometry.setAttribute( 'iCanopy0', new THREE.InterleavedBufferAttribute( packed, 4, 0 ) );
	geometry.setAttribute( 'iCanopy1', new THREE.InterleavedBufferAttribute( packed, 4, 4 ) );
	geometry.setAttribute( 'iCanopy2', new THREE.InterleavedBufferAttribute( packed, 4, 8 ) );
	geometry.setAttribute( 'iCanopyFrames', new THREE.InterleavedBufferAttribute( packed, 4, 12 ) );
	geometry.setAttribute( 'iCanopyWeights', new THREE.InterleavedBufferAttribute( packed, 4, 16 ) );
	const mesh = new THREE.InstancedMesh( geometry, material, 1 );
	const meshWithoutTranslucency = new THREE.InstancedMesh( geometry, materialWithoutTranslucency, 1 );
	mesh.frustumCulled = false;
	meshWithoutTranslucency.frustumCulled = false;
	meshWithoutTranslucency.visible = false;
	const scene = new THREE.Scene();
	scene.background = new THREE.Color( 0x17202a );
	scene.add( new THREE.HemisphereLight( 0x91a8c0, 0x393222, 0.8 ) );
	const irradianceTexture = new THREE.DataTexture( new Uint8Array( [ 142, 157, 177, 255 ] ), 1, 1, THREE.RGBAFormat );
	const horizonTexture = new THREE.DataTexture( new Uint8Array( [ 110, 98, 77, 255 ] ), 1, 1, THREE.RGBAFormat );
	irradianceTexture.needsUpdate = true;
	horizonTexture.needsUpdate = true;
	textures.push( irradianceTexture, horizonTexture );
	const camera = new THREE.PerspectiveCamera( 55, canvas.width / canvas.height, 0.1, 100 );
	camera.position.set( 0, 0, 5 ); camera.lookAt( 0, 0, 0 );
	const sunDirection = new THREE.Vector3( 0.1, 0.8, 0.6 ).normalize();
	shadows = new WebGLSunShadows( { renderer, scene, camera, direction: sunDirection } );
	for ( const light of shadows.lights ) light.intensity = 1.8;
	installWebGLSceneMaterialLighting( THREE, scene, { skyIrradianceTexture: irradianceTexture, horizonTexture }, shadows );
	mesh.receiveShadow = true;
	meshWithoutTranslucency.receiveShadow = true;
	scene.add( mesh, meshWithoutTranslucency );
	if ( material.defines?.USE_CSM !== 1 || material.defines?.CSM_CASCADES !== 3 ) throw new Error( 'WebGL canopy material did not receive the engine sun-shadow adapter' );
	if ( ! material.userData.elsemeshAtmosphereLighting ) throw new Error( 'WebGL canopy material did not receive the engine atmosphere-lighting adapter' );
	shadows.update( camera, sunDirection );
	renderer.render( scene, camera );
	const gl = renderer.getContext();
	const pixels = new Uint8Array( canvas.width * canvas.height * 4 );
	gl.readPixels( 0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels );
	mesh.visible = false;
	meshWithoutTranslucency.visible = true;
	renderer.render( scene, camera );
	const pixelsWithoutTranslucency = new Uint8Array( canvas.width * canvas.height * 4 );
	gl.readPixels( 0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixelsWithoutTranslucency );
	let backlightGain = 0;
	for ( let offset = 0; offset < pixels.length; offset += 4 ) for ( let channel = 0; channel < 3; channel ++ ) backlightGain += pixels[ offset + channel ] - pixelsWithoutTranslucency[ offset + channel ];
	const background = [ 0x17, 0x20, 0x2a ];
	let changedPixels = 0;
	for ( let offset = 0; offset < pixels.length; offset += 4 ) if ( Math.abs( pixels[ offset ] - background[ 0 ] ) + Math.abs( pixels[ offset + 1 ] - background[ 1 ] ) + Math.abs( pixels[ offset + 2 ] - background[ 2 ] ) > 18 ) changedPixels ++;
	const metrics = { changedPixels, backlightGain, programCount: renderer.info.programs?.length || 0, glError: gl.getError(), shaderErrors };
	if ( metrics.programCount < 1 || metrics.changedPixels < 20 || metrics.backlightGain <= 0 || metrics.glError !== gl.NO_ERROR || shaderErrors.length ) throw new Error( `WebGL canopy shader failed: ${JSON.stringify( metrics )}` );
	result.dataset.status = 'complete';
	result.textContent = JSON.stringify( metrics );
} catch ( error ) {
	result.dataset.status = 'failed';
	result.textContent = error.stack || String( error );
} finally {
	geometry?.dispose();
	material?.dispose();
	materialWithoutTranslucency?.dispose();
	shadows?.dispose();
	for ( const texture of textures ) texture.dispose();
	if ( renderer ) renderer.dispose();
}
