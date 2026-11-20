import assert from 'node:assert/strict';
import { setupLife } from './life-harness.mjs';
import { PlaneGeometry } from '../src/engine/geometry/PrimitiveGeometries.js';
import { InstancedInterleavedBuffer, InterleavedBufferAttribute } from '../src/engine/geometry/BufferAttribute.js';
import { InstancedMesh } from '../src/engine/scene/Mesh.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { createOctahedralCanopyWebGPUMaterial } from '../src/engine/render/OctahedralCanopyWebGPUMaterial.js';
import { createWebGPUOctahedralCanopyTexture, uploadWebGPUOctahedralCanopyTexture } from '../src/network/WebGPUOctahedralCanopyTexture.js';

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

const imageData = ( pixel ) => {
	const data = new Uint8Array( 64 * 32 * 4 );
	for ( let i = 0; i < data.length; i += 4 ) data.set( pixel, i );
	return { data, width: 64, height: 32, format: 'rgba8unorm' };
};
const errors = [];
const L = await setupLife( { W: 128, H: 128, shadowSplits: [ 12 ] } );
let atlasA, atlasB, geometry, material, mesh;
try {
	GPU.device.addEventListener( 'uncapturederror', event => errors.push( event.error?.message || 'unknown GPU error' ) );
	atlasA = uploadWebGPUOctahedralCanopyTexture( createWebGPUOctahedralCanopyTexture( imageData( [ 200, 255, 128, 255 ] ), 'canopy-test-material' ) );
	atlasB = uploadWebGPUOctahedralCanopyTexture( createWebGPUOctahedralCanopyTexture( imageData( [ 128, 128, 255, 255 ] ), 'canopy-test-normal' ) );
	material = createOctahedralCanopyWebGPUMaterial( descriptor, { materialAtlas: atlasA, normalExposureAtlas: atlasB } );
	geometry = new PlaneGeometry( 2, 2 );
	const attributes = new InstancedInterleavedBuffer( new Float32Array( [ 0.25, 0, 5, 0, 1, 1, 1, 0, 12.5, 0, 0, 0, 0, 1, 2, 1, 0.6, 0.3, 0.1, 1 ] ), 20 );
	geometry.setAttribute( 'iCanopy0', new InterleavedBufferAttribute( attributes, 4, 0 ) );
	geometry.setAttribute( 'iCanopy1', new InterleavedBufferAttribute( attributes, 4, 4 ) );
	geometry.setAttribute( 'iCanopy2', new InterleavedBufferAttribute( attributes, 4, 8 ) );
	geometry.setAttribute( 'iCanopyFrames', new InterleavedBufferAttribute( attributes, 4, 12 ) );
	geometry.setAttribute( 'iCanopyWeights', new InterleavedBufferAttribute( attributes, 4, 16 ) );
	mesh = new InstancedMesh( geometry, material, 1 );
	mesh.frustumCulled = false;
	L.scene.add( mesh );
	L.camera.position.set( 0, 0, 5 );
	L.camera.lookAt( 0, 0, 0 );
	await L.run( 2 );
	assert.deepEqual( errors, [], `WebGPU canopy color pipeline compiles and renders without validation errors: ${errors.join( '; ' )}` );
	console.log( 'WebGPU octahedral canopy material compiled and rendered one shared far-card instance' );
} finally {
	mesh?.parent?.remove( mesh );
	geometry?.dispose();
	material?.dispose();
	atlasA?.destroy();
	atlasB?.destroy();
	GPU.device?.destroy();
}
await new Promise( resolve => setTimeout( resolve, 200 ) );
