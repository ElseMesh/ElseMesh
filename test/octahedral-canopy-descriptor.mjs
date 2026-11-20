import assert from 'node:assert/strict';
import { decodeWorldComponentAsset } from '../src/network/WorldComponentAssetCodecRegistry.js';
import {
	OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND,
	OCTAHEDRAL_CANOPY_DESCRIPTOR_FORMAT,
	OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT,
	OCTAHEDRAL_CANOPY_APPEARANCE_FORMAT,
	decodeOctahedralCanopyDescriptor,
} from '../src/network/OctahedralCanopyDescriptor.js';

const id = letter => `sha256:${letter.repeat( 64 )}`;
const setID = id( 'a' ), nearTreeID = id( 'b' ), nearShrubID = id( 'c' ), atlasColorID = id( 'd' ), atlasAuxID = id( 'e' ), leafMaskID = id( '6' );
const inventory = [
	{ assetId: setID, kind: 'static-model-instance-set/1' },
	{ assetId: nearTreeID, kind: 'glb' },
	{ assetId: nearShrubID, kind: 'glb' },
	{ assetId: atlasColorID, kind: 'image/png' },
	{ assetId: atlasAuxID, kind: 'image/png' },
	{ assetId: leafMaskID, kind: 'image/png' },
];
const instanceSet = {
	format: 'elsemesh.static-model-instance-set/1',
	models: [
		{ id: 'tree-oak', lods: [ { assetId: nearTreeID } ] },
		{ id: 'shrub-low', lods: [ { assetId: nearShrubID } ] },
	],
	instances: [
		{ model: 'tree-oak', materialData: [ 0, 0, 0, 0, 0, 0, 0, 0.1337 ] },
		{ model: 'shrub-low', materialData: [ 0, 0, 0, 0, 0, 0, 0, 0.7331 ] },
	],
};
const descriptor = {
	format: OCTAHEDRAL_CANOPY_DESCRIPTOR_FORMAT,
	instanceSetAssetId: setID,
	atlasAssetIds: [ atlasColorID, atlasAuxID ],
	atlasDataFormat: OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT,
	atlasChannels: {
		material: { r: 'brightness', g: 'leaf-flag', b: 'card-variation', a: 'coverage' },
		normalExposure: { r: 'normal-x-encoded', g: 'normal-y-encoded', b: 'normal-z-encoded', a: 'ambient-exposure' },
	},
	leafMask: {
		assetId: leafMaskID,
		dataFormat: 'rgba8unorm-data/1',
		layout: { type: 'row-major-atlas-uv/1', columns: 2, rows: 2, tileWidth: 512, tileHeight: 512 },
		channels: { r: 'leaf-coverage', g: 'leaf-brightness-over-1.4', b: 'leaf-cell-random', a: 'opaque' },
	},
	materialGraph: {
		format: 'elsemesh.material-graph/1',
		nodes: [
			{ id: 'color', op: 'input', name: 'colorRGB' },
			{ id: 'roughness', op: 'constant', value: 0.85 },
		],
		outputs: { baseColor: 'color', roughness: 'roughness' },
	},
	appearance: {
		format: OCTAHEDRAL_CANOPY_APPEARANCE_FORMAT,
		color: { instanceTintScale: 0.36, instanceTintBias: 0.74, leafDesaturation: 0.85, impostorBrightnessScale: 1.4, barkDark: 0x1c1a13, barkLight: 0x2e2b20, leafBlendStart: 0.05, leafBlendEnd: 0.55, impostorSaturation: 1.25 },
		lighting: { bakedOcclusionFloor: 0.26, bakedOcclusionExponent: 2, brightnessScale: 0.6, brightnessBias: 0.7, roughness: 0.85, specularIntensity: 0.12, translucency: 0.35 },
		wind: { gustAmplitude: 0.009, gustBias: 0.3, gustScale: 0.8, waveAmplitude: 0.0045, waveFrequency: 0.9, waveGustBias: 0.4, seedPhaseScale: 6.2832, heightScale: 0.45 },
		palette: {
			trees: [ { low: 0x283a1b, high: 0x364a23, dry: 0x5e4a2e, dryStart: 0.96, dryEnd: 0.995, dryMix: 0.5 }, { low: 0x34491f, high: 0x485c27 } ],
			shrubs: [ { low: 0x3f5522, high: 0x52662a } ],
			bark: { dark: 0x302a22, mid: 0x5c5549, pale: 0x7b7b6a, paleStart: 0.64, paleEnd: 0.8, paleMix: 0.3 },
			dryTree: { low: 0x5c5234, high: 0x6e5a3a, mix: 0.5 }, floweringTree: 0x8a4a2c,
		},
		species: { treeSeedMultiplier: 5.31, shrubSeedMultiplier: 3.17, shrubVariantThresholds: [ 0.45, 0.6 ], dryTreeChance: 0.035, floweringTreeThreshold: 0.988 },
	},
	projection: { type: 'hemi-octahedral/1', framesPerSide: 6 },
	frameGrid: { columns: 30, rows: 6, frameWidth: 128, frameHeight: 128 },
	variantGroups: [
		{ id: 'trees', modelIds: [ 'tree-oak' ], atlasVariantRange: { start: 0, end: 3 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, bounds: { center: [ 0, 4, 0 ], radius: 8, horizontalRadius: 6, halfHeight: 8 }, lod: { nearDistance: 65, maxDistance: 2800, farFade: { startDistance: 2600, endDistance: 2800 } } },
		{ id: 'shrubs', modelIds: [ 'shrub-low' ], atlasVariantRange: { start: 3, end: 5 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, bounds: { center: [ 0, 1, 0 ], radius: 2, horizontalRadius: 1.5, halfHeight: 2 }, lod: { nearDistance: 45, maxDistance: 180, farFade: null } },
	],
	frameBlendDistance: 100,
	lodBandFraction: 0.12,
	thinning: { startDistance: 140, endDistance: 320, removeFraction: 0.5, seedMultiplier: 91.7, scaleCompensation: 'inverse-square-root-retained-density/1' },
};
const options = { componentAssets: inventory, staticModelInstanceSetAssetId: setID, staticModelInstanceSet: instanceSet };
const bytes = value => new TextEncoder().encode( JSON.stringify( value ) );

assert.deepEqual( decodeOctahedralCanopyDescriptor( bytes( descriptor ), options ), descriptor, 'valid signed asset identities and renderer-neutral canopy settings are retained' );
assert.equal( decodeWorldComponentAsset( OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND, bytes( descriptor ), options ).instanceSetAssetId, setID, 'the engine codec registry dispatches the descriptor decoder' );

const invalid = [
	{ ...descriptor, extra: true },
	{ ...descriptor, atlasDataFormat: 'rgba8-srgb/1' },
	{ ...descriptor, atlasChannels: { ...descriptor.atlasChannels, material: { ...descriptor.atlasChannels.material, a: 'opacity' } } },
	{ ...descriptor, leafMask: { ...descriptor.leafMask, dataFormat: 'rgba8-srgb/1' } },
	{ ...descriptor, leafMask: { ...descriptor.leafMask, layout: { ...descriptor.leafMask.layout, type: 'atlas-uv/1' } } },
	{ ...descriptor, leafMask: { ...descriptor.leafMask, channels: { ...descriptor.leafMask.channels, r: 'alpha' } } },
	{ ...descriptor, materialGraph: { ...descriptor.materialGraph, format: 'shader-source/1' } },
	{ ...descriptor, materialGraph: { ...descriptor.materialGraph, outputs: { roughness: 'roughness' } } },
	{ ...descriptor, appearance: { ...descriptor.appearance, color: { ...descriptor.appearance.color, barkDark: -1 } } },
	{ ...descriptor, appearance: { ...descriptor.appearance, wind: { ...descriptor.appearance.wind, gustAmplitude: -1 } } },
	{ ...descriptor, appearance: { ...descriptor.appearance, palette: undefined } },
	{ ...descriptor, appearance: { ...descriptor.appearance, palette: { ...descriptor.appearance.palette, trees: [ { ...descriptor.appearance.palette.trees[ 0 ], dryEnd: descriptor.appearance.palette.trees[ 0 ].dryStart } ] } } },
	{ ...descriptor, appearance: { ...descriptor.appearance, species: { ...descriptor.appearance.species, shrubVariantThresholds: [ 0.6, 0.45 ] } } },
	{ ...descriptor, appearance: { ...descriptor.appearance, palette: { ...descriptor.appearance.palette, bark: { ...descriptor.appearance.palette.bark, pale: 0x1000000 } } } },
	{ ...descriptor, instanceSetAssetId: id( 'f' ) },
	{ ...descriptor, atlasAssetIds: [ atlasColorID, atlasColorID ] },
	{ ...descriptor, atlasAssetIds: [ atlasColorID, nearTreeID ] },
	{ ...descriptor, projection: { ...descriptor.projection, framesPerSide: 17 } },
	{ ...descriptor, frameGrid: { ...descriptor.frameGrid, columns: 13 } },
	{ ...descriptor, variantGroups: [ { ...descriptor.variantGroups[ 0 ], atlasVariantRange: { start: 3, end: 6 } }, descriptor.variantGroups[ 1 ] ] },
	{ ...descriptor, variantGroups: [ { ...descriptor.variantGroups[ 0 ], modelIds: [ 'missing-model' ] }, descriptor.variantGroups[ 1 ] ] },
	{ ...descriptor, variantGroups: [ { ...descriptor.variantGroups[ 0 ], variantSelection: { ...descriptor.variantGroups[ 0 ].variantSelection, index: 9 } }, descriptor.variantGroups[ 1 ] ] },
	{ ...descriptor, variantGroups: [ { ...descriptor.variantGroups[ 0 ], variantSelection: { ...descriptor.variantGroups[ 0 ].variantSelection, multiplier: 0 } }, descriptor.variantGroups[ 1 ] ] },
	{ ...descriptor, variantGroups: [ { ...descriptor.variantGroups[ 0 ], bounds: { ...descriptor.variantGroups[ 0 ].bounds, horizontalRadius: 9 } }, descriptor.variantGroups[ 1 ] ] },
	{ ...descriptor, variantGroups: [ { ...descriptor.variantGroups[ 0 ], lod: { ...descriptor.variantGroups[ 0 ].lod, maxDistance: 2000 } }, descriptor.variantGroups[ 1 ] ] },
	{ ...descriptor, variantGroups: [ descriptor.variantGroups[ 0 ], { ...descriptor.variantGroups[ 1 ], lod: { ...descriptor.variantGroups[ 1 ].lod, farFade: { startDistance: 150, endDistance: 170 } } } ] },
	{ ...descriptor, frameBlendDistance: -1 },
	{ ...descriptor, lodBandFraction: 0 },
	{ ...descriptor, thinning: { ...descriptor.thinning, endDistance: 130 } },
	{ ...descriptor, thinning: { ...descriptor.thinning, removeFraction: 1 } },
	{ ...descriptor, thinning: { ...descriptor.thinning, scaleCompensation: 'none' } },
];
for ( const value of invalid ) assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( value ), options ), /Invalid octahedral canopy descriptor/ );

assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, componentAssets: inventory.filter( asset => asset.assetId !== nearTreeID ) } ), /near GLB referenced by static model tree-oak is not a signed component asset/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, staticModelInstanceSetAssetId: id( 'f' ) } ), /does not match the signed descriptor reference/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, componentAssets: inventory.map( asset => asset.assetId === atlasAuxID ? { ...asset, kind: 'image/ktx2' } : asset ) } ), /atlas reference is not a declared image\/png data asset/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, componentAssets: inventory.filter( asset => asset.assetId !== leafMaskID ) } ), /leaf-mask reference is not a declared image\/png data asset/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, staticModelInstanceSet: { ...instanceSet, instances: [ { model: 'tree-oak' }, instanceSet.instances[ 1 ] ] } } ), /requires normalized per-instance variant data/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( new Uint8Array(), options ), /non-empty binary data/ );

console.log( 'Engine octahedral canopy descriptor codec: signed identities and strict contract validation passed' );
