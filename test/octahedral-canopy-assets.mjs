import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { decodeOctahedralCanopyAtlas, decodeOctahedralCanopyLeafMask, loadOctahedralCanopyAssets } from '../src/network/OctahedralCanopyAssets.js';
import { OCTAHEDRAL_CANOPY_COMPONENT_TYPE, OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND, OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT } from '../src/network/OctahedralCanopyDescriptor.js';
import { worldComponentAssetIDs } from '../src/network/WorldComponentRegistry.js';

const sha = bytes => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const crcTable = Uint32Array.from( { length: 256 }, ( _, index ) => {
	let value = index;
	for ( let bit = 0; bit < 8; bit ++ ) value = value & 1 ? 0xedb88320 ^ ( value >>> 1 ) : value >>> 1;
	return value >>> 0;
} );
function crc32( bytes ) {
	let value = 0xffffffff;
	for ( const byte of bytes ) value = crcTable[ ( value ^ byte ) & 255 ] ^ ( value >>> 8 );
	return ( value ^ 0xffffffff ) >>> 0;
}
function chunk( type, payload ) {
	const result = Buffer.alloc( payload.length + 12 );
	result.writeUInt32BE( payload.length, 0 );
	result.write( type, 4, 'ascii' );
	payload.copy( result, 8 );
	result.writeUInt32BE( crc32( result.subarray( 4, payload.length + 8 ) ), payload.length + 8 );
	return result;
}
function dataPNG( width, height, byte ) {
	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( width, 0 ); header.writeUInt32BE( height, 4 );
	header[ 8 ] = 8; header[ 9 ] = 6;
	const rows = Buffer.alloc( height * ( width * 4 + 1 ) );
	for ( let y = 0; y < height; y ++ ) rows.fill( byte, y * ( width * 4 + 1 ) + 1, ( y + 1 ) * ( width * 4 + 1 ) );
	return Buffer.concat( [ Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ), chunk( 'IHDR', header ), chunk( 'IDAT', deflateSync( rows, { level: 1 } ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] );
}
function pixelPNG( width, height, pixels ) {
	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( width, 0 ); header.writeUInt32BE( height, 4 );
	header[ 8 ] = 8; header[ 9 ] = 6;
	const rows = Buffer.alloc( height * ( width * 4 + 1 ) );
	const pixelBytes = Buffer.from( pixels );
	for ( let y = 0; y < height; y ++ ) pixelBytes.copy( rows, y * ( width * 4 + 1 ) + 1, y * width * 4, ( y + 1 ) * width * 4 );
	return Buffer.concat( [ Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ), chunk( 'IHDR', header ), chunk( 'IDAT', deflateSync( rows, { level: 1 } ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] );
}

const treeGLB = Buffer.from( 'tree model bytes' ), shrubGLB = Buffer.from( 'shrub model bytes' );
const treeGLBID = sha( treeGLB ), shrubGLBID = sha( shrubGLB );
const set = {
	format: 'elsemesh.static-model-instance-set/1',
	models: [
		{ id: 'tree', bounds: { center: [ 0, 4, 0 ], radius: 8 }, geometryMirrorX: false, lods: [ { assetId: treeGLBID } ], lodThresholds: [], lodMetric: 'world-distance', lodFadeFraction: 0.1, shadowLodBias: 0, shadowMaxDistance: 0, drawMaxDistance: 2800, drawFadeStartDistance: 2600 },
		{ id: 'shrub', bounds: { center: [ 0, 1, 0 ], radius: 2 }, geometryMirrorX: false, lods: [ { assetId: shrubGLBID } ], lodThresholds: [], lodMetric: 'world-distance', lodFadeFraction: 0.1, shadowLodBias: 0, shadowMaxDistance: 0, drawMaxDistance: 180, drawFadeStartDistance: 180 },
	],
	instances: [
		{ model: 'tree', position: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0, 0, 0, 0, 0, 0, 0, 0.1337 ] },
		{ model: 'shrub', position: [ 1, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0, 0, 0, 0, 0, 0, 0, 0.7331 ] },
	],
};
const setBytes = Buffer.from( JSON.stringify( set ) );
const setID = sha( setBytes );
const atlasA = dataPNG( 3840, 768, 0 ), atlasB = dataPNG( 3840, 768, 128 );
const atlasAID = sha( atlasA ), atlasBID = sha( atlasB );
const leafMaskBytes = dataPNG( 1024, 1024, 192 );
const leafMaskID = sha( leafMaskBytes );
const descriptor = {
	format: 'elsemesh.octahedral-canopy/1', instanceSetAssetId: setID, atlasAssetIds: [ atlasAID, atlasBID ],
	atlasDataFormat: OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT,
	atlasChannels: {
		material: { r: 'brightness', g: 'leaf-flag', b: 'card-variation', a: 'coverage' },
		normalExposure: { r: 'normal-x-encoded', g: 'normal-y-encoded', b: 'normal-z-encoded', a: 'ambient-exposure' },
	},
	leafMask: {
		assetId: leafMaskID, dataFormat: OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT,
		layout: { type: 'row-major-atlas-uv/1', columns: 2, rows: 2, tileWidth: 512, tileHeight: 512 },
		channels: { r: 'leaf-coverage', g: 'leaf-brightness-over-1.4', b: 'leaf-cell-random', a: 'opaque' },
	},
	appearance: {
		format: 'elsemesh.canopy-appearance/1',
		color: { instanceTintScale: 0.36, instanceTintBias: 0.74, leafDesaturation: 0.85, impostorBrightnessScale: 1.4, barkDark: 0x1c1a13, barkLight: 0x2e2b20, leafBlendStart: 0.05, leafBlendEnd: 0.55, impostorSaturation: 1.25 },
		lighting: { bakedOcclusionFloor: 0.26, bakedOcclusionExponent: 2, brightnessScale: 0.6, brightnessBias: 0.7, roughness: 0.85, specularIntensity: 0.12, translucency: 0.35 },
		wind: { gustAmplitude: 0.009, gustBias: 0.3, gustScale: 0.8, waveAmplitude: 0.0045, waveFrequency: 0.9, waveGustBias: 0.4, seedPhaseScale: 6.2832, heightScale: 0.45 },
		palette: {
			trees: [ { low: 0x283a1b, high: 0x364a23, dry: 0x5e4a2e, dryStart: 0.96, dryEnd: 0.995, dryMix: 0.5 }, { low: 0x34491f, high: 0x485c27 } ],
			shrubs: [ { low: 0x3f5522, high: 0x52662a }, { low: 0x2c421e, high: 0x44561f }, { low: 0x34521c, high: 0x466624 } ],
			bark: { dark: 0x302a22, mid: 0x5c5549, pale: 0x7b7b6a, paleStart: 0.64, paleEnd: 0.8, paleMix: 0.3 },
			dryTree: { low: 0x5c5234, high: 0x6e5a3a, mix: 0.5 }, floweringTree: 0x8a4a2c,
		},
		species: { treeSeedMultiplier: 5.31, shrubSeedMultiplier: 3.17, shrubVariantThresholds: [ 0.45, 0.6 ], dryTreeChance: 0.035, floweringTreeThreshold: 0.988 },
	},
	materialGraph: {
		format: 'elsemesh.material-graph/1',
		nodes: [ { id: 'color', op: 'input', name: 'colorRGB' } ],
		outputs: { baseColor: 'color' },
	},
	projection: { type: 'hemi-octahedral/1', framesPerSide: 6 },
	frameGrid: { columns: 30, rows: 6, frameWidth: 128, frameHeight: 128 },
	variantGroups: [
		{ id: 'trees', modelIds: [ 'tree' ], atlasVariantRange: { start: 0, end: 3 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, bounds: { center: [ 0, 4, 0 ], radius: 8, horizontalRadius: 6, halfHeight: 8 }, lod: { nearDistance: 65, maxDistance: 2800, farFade: { startDistance: 2600, endDistance: 2800 } } },
		{ id: 'shrubs', modelIds: [ 'shrub' ], atlasVariantRange: { start: 3, end: 5 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, bounds: { center: [ 0, 1, 0 ], radius: 2, horizontalRadius: 1.5, halfHeight: 2 }, lod: { nearDistance: 45, maxDistance: 180, farFade: null } },
	],
	frameBlendDistance: 100, lodBandFraction: 0.12,
	thinning: { startDistance: 140, endDistance: 320, removeFraction: 0.5, seedMultiplier: 91.7, scaleCompensation: 'inverse-square-root-retained-density/1' },
};
const descriptorBytes = Buffer.from( JSON.stringify( descriptor ) );
const descriptorID = sha( descriptorBytes );
const component = {
	type: OCTAHEDRAL_CANOPY_COMPONENT_TYPE,
	data: { descriptorAssetId: descriptorID },
	assets: [
		{ assetId: descriptorID, kind: OCTAHEDRAL_CANOPY_DESCRIPTOR_ASSET_KIND },
		{ assetId: setID, kind: 'static-model-instance-set/1' },
		{ assetId: treeGLBID, kind: 'glb' }, { assetId: shrubGLBID, kind: 'glb' },
		{ assetId: atlasAID, kind: 'image/png' }, { assetId: atlasBID, kind: 'image/png' },
		{ assetId: leafMaskID, kind: 'image/png' },
	],
};
const assetBytes = new Map( [ [ descriptorID, descriptorBytes ], [ setID, setBytes ], [ treeGLBID, treeGLB ], [ shrubGLBID, shrubGLB ], [ atlasAID, atlasA ], [ atlasBID, atlasB ], [ leafMaskID, leafMaskBytes ] ] );
const connector = {
	manifest: { assets: component.assets.map( ( { assetId, kind } ) => ( { id: assetId, kind } ) ) },
	assets: new Map(),
	async getAsset( assetId ) { return assetBytes.get( assetId ); },
};

const assets = await loadOctahedralCanopyAssets( connector, component );
assert.equal( assets.descriptor.instanceSetAssetId, setID );
assert.equal( assets.instanceSet.instances.length, 2 );
assert.deepEqual( [ ...assets.atlases.values() ].map( atlas => [ atlas.width, atlas.height ] ), [ [ 3840, 768 ], [ 3840, 768 ] ] );
assert.deepEqual( [ assets.leafMask.width, assets.leafMask.height ], [ 1024, 1024 ], 'the source leaf mask is loaded as a signed raw-data PNG with its four-tile layout' );
assert.deepEqual( assets.leafMask.channels, descriptor.leafMask.channels, 'leaf-mask channel semantics survive signed descriptor loading' );
assert.deepEqual( await assets.loadModel( treeGLBID ), treeGLB, 'near model assets are loaded only through signed component references' );
await assert.rejects( assets.loadModel( sha( Buffer.from( 'unreferenced' ) ) ), /not referenced by the signed instance set/ );
assert.deepEqual( worldComponentAssetIDs( component ), [ descriptorID ], 'startup requests only the canopy descriptor; the set, atlases, and models are loaded by the adapter' );
const mismatchedDescriptorBytes = Buffer.from( JSON.stringify( { ...descriptor, leafMask: { ...descriptor.leafMask, layout: { ...descriptor.leafMask.layout, tileWidth: 256 } } } ) );
const mismatchedDescriptorID = sha( mismatchedDescriptorBytes );
const mismatchedComponent = {
	...component,
	data: { descriptorAssetId: mismatchedDescriptorID },
	assets: component.assets.map( asset => asset.assetId === descriptorID ? { ...asset, assetId: mismatchedDescriptorID } : asset ),
};
const mismatchedConnector = {
	...connector,
	manifest: { assets: mismatchedComponent.assets.map( ( { assetId, kind } ) => ( { id: assetId, kind } ) ) },
	async getAsset( assetId ) { return assetId === mismatchedDescriptorID ? mismatchedDescriptorBytes : assetBytes.get( assetId ); },
};
await assert.rejects( loadOctahedralCanopyAssets( mismatchedConnector, mismatchedComponent ), /leaf-mask dimensions 1024x1024 do not match 512x1024/ );
const previousCreateImageBitmap = globalThis.createImageBitmap;
globalThis.createImageBitmap = async ( blob, options ) => {
	assert.equal( blob.type, 'image/png' );
	assert.deepEqual( options, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }, 'data atlas decoding disables color conversion and alpha premultiplication' );
	return blob.size === leafMaskBytes.byteLength ? { width: 1024, height: 1024 } : { width: 3840, height: 768 };
};
try {
	assert.deepEqual( await decodeOctahedralCanopyAtlas( atlasA ), { width: 3840, height: 768 } );
	assert.deepEqual( await decodeOctahedralCanopyAtlas( leafMaskBytes ), { width: 1024, height: 1024 } );
} finally {
	if ( previousCreateImageBitmap === undefined ) delete globalThis.createImageBitmap;
	else globalThis.createImageBitmap = previousCreateImageBitmap;
}

const expectedMaskPixels = [ 0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255 ];
const rawMaskFixture = pixelPNG( 2, 2, expectedMaskPixels );
const decodedLeafMask = await decodeOctahedralCanopyLeafMask( { bytes: rawMaskFixture, width: 2, height: 2 } );
assert.deepEqual( Array.from( decodedLeafMask.data ), expectedMaskPixels, 'raw-data PNG decoding preserves every authored RGBA8 channel byte' );
assert.deepEqual( [ decodedLeafMask.width, decodedLeafMask.height, decodedLeafMask.format, decodedLeafMask.sampler ], [ 2, 2, 'rgba8unorm', 'linearClamp' ] );

console.log( 'signed canopy descriptor, instance set, raw PNG atlases, and lazy model loading pass' );
