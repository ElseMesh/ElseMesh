import assert from 'node:assert/strict';
import { createOctahedralCanopyWebGPUMaterial } from '../src/engine/render/OctahedralCanopyWebGPUMaterial.js';
import { createWebGLOctahedralCanopyMaterial, updateWebGLOctahedralCanopyMaterial } from '../src/fallback/WebGLOctahedralCanopyMaterial.js';

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

class Vector {
	constructor( ...values ) { this.values = values; }
	set( ...values ) { this.values = values; return this; }
	copy( value ) { this.values = value.values; return this; }
}
class MeshPhysicalMaterial {
	constructor( values ) { Object.assign( this, values ); this.isMeshPhysicalMaterial = true; this.userData = {}; }
}
const THREE = { Vector2: Vector, Vector3: Vector, MeshPhysicalMaterial, DoubleSide: 2 };
const image = { width: 64, height: 32 };
const atlasA = { image }, atlasB = { image };

const webgpu = createOctahedralCanopyWebGPUMaterial( descriptor, { materialAtlas: atlasA, normalExposureAtlas: atlasB } );
assert.equal( webgpu.attributes.iCanopy2, 'vec4f' );
assert.match( webgpu.vertex, /canopyWindOffset\( center - rotatedCenter, canopy0\.x, canopy2\.x \)/ );
assert.match( webgpu.modules[ 0 ].code, /frame\.windVelocityIntegral \* 0\.7 \+ frame\.windDirectionIntegral \* 1\.5/ );
assert.match( webgpu.modules[ 0 ].code, /fn canopyGroupCenter/ );

const webgl = createWebGLOctahedralCanopyMaterial( THREE, descriptor, { materialAtlas: atlasA, normalExposureAtlas: atlasB } );
assert.equal( webgl.isMeshPhysicalMaterial, true, 'WebGL canopy surfaces use the engine physical lighting pipeline' );
assert.equal( webgl.roughness, descriptor.appearance.lighting.roughness );
assert.equal( webgl.specularIntensity, descriptor.appearance.lighting.specularIntensity );
const shader = {
	uniforms: {},
	vertexShader: '#include <common>\nvoid main() { #include <project_vertex> #include <worldpos_vertex> }',
	fragmentShader: '#include <common>\nvoid main() { #include <color_fragment> #include <normal_fragment_maps> #include <lights_physical_fragment> #include <lights_fragment_end> }',
};
webgl.onBeforeCompile( shader );
assert.match( shader.vertexShader, /attribute vec4 iCanopy2/ );
assert.match( shader.vertexShader, /canopyWindDisplacement\( iCanopy0\.x, iCanopy2\.x/ );
assert.match( shader.vertexShader, /worldPosition\.xyz \+= vCanopyWindOffset/ );
assert.match( shader.fragmentShader, /uWindVelocityIntegral \* 0\.700000000/ );
assert.match( shader.fragmentShader, /max\( vCanopy1\.x, 1e-6 \) \/ max\( vCanopy1\.y, 1e-6 \)/ );
assert.match( shader.fragmentShader, /directionalLights\[ 0 \]\.direction/ );
assert.match( shader.fragmentShader, /directionalShadowMap\[ i \].*canopyShadowData/s, 'transmission uses the same cascaded shadow maps as direct PBR lighting' );
assert.match( shader.fragmentShader, /directionalLights\[ 0 \]\.color \* canopySunShadow/ );
assert.match( shader.fragmentShader, /reflectedLight\.directDiffuse \+= canopyTranslucency \* canopyDirectRadiance/ );
assert.doesNotMatch( shader.fragmentShader, /gl_FrontFacing.*canopyWorldNormal/s, 'the WebGL atlas normal is not inverted on back faces without a corresponding source rule' );
assert.doesNotMatch( shader.fragmentShader, /cellMin|cellMax/, 'both backends address the atlas with the source global clamp sampler policy' );
updateWebGLOctahedralCanopyMaterial( webgl, { windDirectionIntegral: new Vector( 2, 3 ), windVelocityIntegral: new Vector( 4, 5 ) } );
assert.deepEqual( webgl.userData.octahedralCanopyUniforms.uWindDirectionIntegral.value.values, [ 2, 3 ] );
assert.deepEqual( webgl.userData.octahedralCanopyUniforms.uWindVelocityIntegral.value.values, [ 4, 5 ] );

console.log( 'octahedral canopy factories share authored sway, gust, grouping, and atlas inputs' );
