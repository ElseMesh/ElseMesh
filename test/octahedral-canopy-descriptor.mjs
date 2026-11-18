import assert from 'node:assert/strict';
import { decodeWorldComponentAsset } from '../src/network/WorldComponentAssetCodecRegistry.js';
import {
	OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND,
	OCTAHEDRAL_CANOPY_DESCRIPTOR_FORMAT,
	decodeOctahedralCanopyDescriptor,
} from '../src/network/OctahedralCanopyDescriptor.js';

const id = letter => `sha256:${letter.repeat( 64 )}`;
const setID = id( 'a' ), nearTreeID = id( 'b' ), nearShrubID = id( 'c' ), atlasColorID = id( 'd' ), atlasAuxID = id( 'e' );
const inventory = [
	{ assetId: setID, kind: 'static-model-instance-set/1' },
	{ assetId: nearTreeID, kind: 'glb' },
	{ assetId: nearShrubID, kind: 'glb' },
	{ assetId: atlasColorID, kind: 'image/ktx2' },
	{ assetId: atlasAuxID, kind: 'image/ktx2' },
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
	projection: { type: 'hemi-octahedral/1', framesPerSide: 6 },
	frameGrid: { columns: 30, rows: 6, frameWidth: 128, frameHeight: 128 },
	variantGroups: [
		{ id: 'trees', modelIds: [ 'tree-oak' ], atlasVariantRange: { start: 0, end: 3 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, bounds: { center: [ 0, 4, 0 ], radius: 8, horizontalRadius: 6, halfHeight: 8 } },
		{ id: 'shrubs', modelIds: [ 'shrub-low' ], atlasVariantRange: { start: 3, end: 5 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, bounds: { center: [ 0, 1, 0 ], radius: 2, horizontalRadius: 1.5, halfHeight: 2 } },
	],
	nearHandoff: { startDistance: 45, endDistance: 75 },
	drawRange: { startDistance: 40, fadeStartDistance: 300, endDistance: 320 },
	thinning: { startDistance: 140, endDistance: 320, removeFraction: 0.5 },
	windResponse: { direction: 1, speed: 0.7, gust: 1, heightExponent: 1, maximumDisplacement: 1.5 },
};
const options = { componentAssets: inventory, staticModelInstanceSetAssetId: setID, staticModelInstanceSet: instanceSet };
const bytes = value => new TextEncoder().encode( JSON.stringify( value ) );

assert.deepEqual( decodeOctahedralCanopyDescriptor( bytes( descriptor ), options ), descriptor, 'valid signed asset identities and renderer-neutral canopy settings are retained' );
assert.equal( decodeWorldComponentAsset( OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND, bytes( descriptor ), options ).instanceSetAssetId, setID, 'the engine codec registry dispatches the descriptor decoder' );

const invalid = [
	{ ...descriptor, extra: true },
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
	{ ...descriptor, nearHandoff: { startDistance: 75, endDistance: 45 } },
	{ ...descriptor, drawRange: { ...descriptor.drawRange, fadeStartDistance: 321 } },
	{ ...descriptor, thinning: { ...descriptor.thinning, endDistance: 130 } },
	{ ...descriptor, windResponse: { ...descriptor.windResponse, maximumDisplacement: -1 } },
];
for ( const value of invalid ) assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( value ), options ), /Invalid octahedral canopy descriptor/ );

assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, componentAssets: inventory.filter( asset => asset.assetId !== nearTreeID ) } ), /near GLB referenced by static model tree-oak is not a signed component asset/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, staticModelInstanceSetAssetId: id( 'f' ) } ), /does not match the signed descriptor reference/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, componentAssets: inventory.map( asset => asset.assetId === atlasAuxID ? { ...asset, kind: 'image/png' } : asset ) } ), /atlas reference is not a declared image\/ktx2 asset/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( bytes( descriptor ), { ...options, staticModelInstanceSet: { ...instanceSet, instances: [ { model: 'tree-oak' }, instanceSet.instances[ 1 ] ] } } ), /requires normalized per-instance variant data/ );
assert.throws( () => decodeOctahedralCanopyDescriptor( new Uint8Array(), options ), /non-empty binary data/ );

console.log( 'Engine octahedral canopy descriptor codec: signed identities and strict contract validation passed' );
