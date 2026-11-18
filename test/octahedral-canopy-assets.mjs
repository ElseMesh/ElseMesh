import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { decodeOctahedralCanopyAtlas, loadOctahedralCanopyAssets } from '../src/network/OctahedralCanopyAssets.js';
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
const descriptor = {
	format: 'elsemesh.octahedral-canopy/1', instanceSetAssetId: setID, atlasAssetIds: [ atlasAID, atlasBID ],
	atlasDataFormat: OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT,
	atlasChannels: {
		material: { r: 'brightness', g: 'leaf-flag', b: 'card-variation', a: 'coverage' },
		normalExposure: { r: 'normal-x-encoded', g: 'normal-y-encoded', b: 'normal-z-encoded', a: 'ambient-exposure' },
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
	],
};
const assetBytes = new Map( [ [ descriptorID, descriptorBytes ], [ setID, setBytes ], [ treeGLBID, treeGLB ], [ shrubGLBID, shrubGLB ], [ atlasAID, atlasA ], [ atlasBID, atlasB ] ] );
const connector = {
	manifest: { assets: component.assets.map( ( { assetId, kind } ) => ( { id: assetId, kind } ) ) },
	assets: new Map(),
	async getAsset( assetId ) { return assetBytes.get( assetId ); },
};

const assets = await loadOctahedralCanopyAssets( connector, component );
assert.equal( assets.descriptor.instanceSetAssetId, setID );
assert.equal( assets.instanceSet.instances.length, 2 );
assert.deepEqual( [ ...assets.atlases.values() ].map( atlas => [ atlas.width, atlas.height ] ), [ [ 3840, 768 ], [ 3840, 768 ] ] );
assert.deepEqual( await assets.loadModel( treeGLBID ), treeGLB, 'near model assets are loaded only through signed component references' );
await assert.rejects( assets.loadModel( sha( Buffer.from( 'unreferenced' ) ) ), /not referenced by the signed instance set/ );
assert.deepEqual( worldComponentAssetIDs( component ), [ descriptorID ], 'startup requests only the canopy descriptor; the set, atlases, and models are loaded by the adapter' );
const previousCreateImageBitmap = globalThis.createImageBitmap;
globalThis.createImageBitmap = async ( blob, options ) => {
	assert.equal( blob.type, 'image/png' );
	assert.deepEqual( options, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }, 'data atlas decoding disables color conversion and alpha premultiplication' );
	return { width: 3840, height: 768 };
};
try {
	assert.deepEqual( await decodeOctahedralCanopyAtlas( atlasA ), { width: 3840, height: 768 } );
} finally {
	if ( previousCreateImageBitmap === undefined ) delete globalThis.createImageBitmap;
	else globalThis.createImageBitmap = previousCreateImageBitmap;
}

console.log( 'signed canopy descriptor, instance set, raw PNG atlases, and lazy model loading pass' );
