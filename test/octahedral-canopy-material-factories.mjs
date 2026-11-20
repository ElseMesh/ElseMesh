import assert from 'node:assert/strict';
import { createOctahedralCanopyWebGPUMaterial } from '../src/engine/render/OctahedralCanopyWebGPUMaterial.js';
import { createOctahedralCanopyShaderMaterial, updateOctahedralCanopyShaderMaterial } from '../src/fallback/OctahedralCanopyShaderMaterial.js';

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
class ShaderMaterial {
	constructor( values ) { Object.assign( this, values ); this.isShaderMaterial = true; this.userData = {}; }
}
const THREE = { Vector2: Vector, Vector3: Vector, ShaderMaterial };
const image = { width: 64, height: 32 };
const atlasA = { image }, atlasB = { image };

const webgpu = createOctahedralCanopyWebGPUMaterial( descriptor, { materialAtlas: atlasA, normalExposureAtlas: atlasB } );
assert.equal( webgpu.attributes.iCanopy2, 'vec4f' );
assert.match( webgpu.vertex, /canopyWindOffset\( center - rotatedCenter, canopy0\.x, canopy2\.x \)/ );
assert.match( webgpu.modules[ 0 ].code, /frame\.windVelocityIntegral \* 0\.7 \+ frame\.windDirectionIntegral \* 1\.5/ );
assert.match( webgpu.modules[ 0 ].code, /fn canopyGroupCenter/ );

const webgl = createOctahedralCanopyShaderMaterial( THREE, descriptor, { materialAtlas: atlasA, normalExposureAtlas: atlasB } );
assert.match( webgl.vertexShader, /attribute vec4 iCanopy2/ );
assert.match( webgl.vertexShader, /iCanopy2\.x, base\.xz, gust/ );
assert.match( webgl.fragmentShader, /uWindVelocityIntegral \* 0\.700000000/ );
assert.match( webgl.fragmentShader, /max\(vCanopy1\.x,1e-6\)\/max\(vCanopy1\.y,1e-6\)/ );
assert.match( webgl.fragmentShader, /dot\(-billboardNormal,sunDir\)/, 'WebGL translucency uses the same billboard normal as Tidewater and the WebGPU presenter' );
assert.doesNotMatch( webgl.fragmentShader, /if\s*\(!gl_FrontFacing\)\s*worldNormal/, 'the WebGL atlas normal is not inverted on back faces without a corresponding source rule' );
assert.doesNotMatch( webgl.fragmentShader, /cellMin|cellMax/, 'both backends address the atlas with the source global clamp sampler policy' );
updateOctahedralCanopyShaderMaterial( webgl, { windDirectionIntegral: new Vector( 2, 3 ), windVelocityIntegral: new Vector( 4, 5 ) } );
assert.deepEqual( webgl.uniforms.uWindDirectionIntegral.value.values, [ 2, 3 ] );
assert.deepEqual( webgl.uniforms.uWindVelocityIntegral.value.values, [ 4, 5 ] );

console.log( 'octahedral canopy factories share authored sway, gust, grouping, and atlas inputs' );
