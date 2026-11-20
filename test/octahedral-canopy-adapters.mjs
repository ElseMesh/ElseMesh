import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import { OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT, OCTAHEDRAL_CANOPY_COMPONENT_TYPE } from '../src/network/OctahedralCanopyDescriptor.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { worldComponentDescriptor } from '../src/network/WorldComponentRegistry.js';
import '../src/network/WebGPUOctahedralCanopyAdapter.js';
import '../src/fallback/WebGLOctahedralCanopyAdapter.js';

assert.equal( worldComponentDescriptor( OCTAHEDRAL_CANOPY_COMPONENT_TYPE )?.vegetation, true, 'the backend-neutral canopy component uses generic vegetation visibility policy' );
const webgpuAdapter = worldComponentBackendAdapter( 'webgpu', OCTAHEDRAL_CANOPY_COMPONENT_TYPE );
const webglAdapter = worldComponentBackendAdapter( 'webgl', OCTAHEDRAL_CANOPY_COMPONENT_TYPE );
assert.equal( typeof webgpuAdapter, 'function', 'WebGPU registers the shared canopy contract' );
assert.equal( typeof webglAdapter, 'function', 'WebGL registers the same shared canopy contract' );

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
	result.writeUInt32BE( payload.length, 0 ); result.write( type, 4, 'ascii' ); payload.copy( result, 8 );
	result.writeUInt32BE( crc32( result.subarray( 4, payload.length + 8 ) ), payload.length + 8 );
	return result;
}
function dataPNG( width, height, pixel ) {
	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( width, 0 ); header.writeUInt32BE( height, 4 ); header[ 8 ] = 8; header[ 9 ] = 6;
	const rows = Buffer.alloc( height * ( width * 4 + 1 ) );
	for ( let y = 0; y < height; y ++ ) for ( let x = 0; x < width; x ++ ) rows.set( pixel, y * ( width * 4 + 1 ) + 1 + x * 4 );
	return Buffer.concat( [ Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ), chunk( 'IHDR', header ), chunk( 'IDAT', deflateSync( rows ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] );
}

const modelA = Buffer.from( 'tree' ), modelB = Buffer.from( 'shrub' );
const modelAID = sha( modelA ), modelBID = sha( modelB );
const set = {
	format: 'elsemesh.static-model-instance-set/1',
	models: [
		{ id: 'tree', bounds: { center: [ 0, 2, 0 ], radius: 4 }, geometryMirrorX: false, lods: [ { assetId: modelAID } ], lodThresholds: [], lodMetric: 'world-distance', lodFadeFraction: 0.1, shadowLodBias: 0, shadowMaxDistance: 0, drawMaxDistance: 200, drawFadeStartDistance: 200 },
		{ id: 'shrub', bounds: { center: [ 0, 1, 0 ], radius: 2 }, geometryMirrorX: false, lods: [ { assetId: modelBID } ], lodThresholds: [], lodMetric: 'world-distance', lodFadeFraction: 0.1, shadowLodBias: 0, shadowMaxDistance: 0, drawMaxDistance: 100, drawFadeStartDistance: 100 },
	],
	instances: [
		{ model: 'tree', position: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0, 0, 5, 0, 0, 0, 0, 0.1 ] },
		{ model: 'shrub', position: [ 1000, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0, 0, 1.5, 0, 0, 0, 0, 0.7 ] },
	],
};
const setBytes = Buffer.from( JSON.stringify( set ) ), setID = sha( setBytes );
const atlasA = dataPNG( 64, 32, [ 210, 255, 128, 255 ] ), atlasB = dataPNG( 64, 32, [ 128, 128, 255, 255 ] ), leafMask = dataPNG( 16, 16, [ 255, 255, 255, 255 ] );
const atlasAID = sha( atlasA ), atlasBID = sha( atlasB ), leafMaskID = sha( leafMask );
const descriptor = {
	format: 'elsemesh.octahedral-canopy/1', instanceSetAssetId: setID, atlasAssetIds: [ atlasAID, atlasBID ],
	atlasDataFormat: OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT,
	atlasChannels: { material: { r: 'brightness', g: 'leaf-flag', b: 'card-variation', a: 'coverage' }, normalExposure: { r: 'normal-x-encoded', g: 'normal-y-encoded', b: 'normal-z-encoded', a: 'ambient-exposure' } },
	leafMask: { assetId: leafMaskID, dataFormat: OCTAHEDRAL_CANOPY_ATLAS_DATA_FORMAT, layout: { type: 'row-major-atlas-uv/1', columns: 1, rows: 1, tileWidth: 16, tileHeight: 16 }, channels: { r: 'leaf-coverage', g: 'leaf-brightness-over-1.4', b: 'leaf-cell-random', a: 'opaque' } },
	materialGraph: { format: 'elsemesh.material-graph/1', nodes: [ { id: 'color', op: 'input', name: 'colorRGB' } ], outputs: { baseColor: 'color' } },
	appearance: {
		format: 'elsemesh.canopy-appearance/1',
		color: { instanceTintScale: 0.36, instanceTintBias: 0.74, leafDesaturation: 0.85, impostorBrightnessScale: 1.4, barkDark: 0x1c1a13, barkLight: 0x2e2b20, leafBlendStart: 0.05, leafBlendEnd: 0.55, impostorSaturation: 1.25 },
		lighting: { bakedOcclusionFloor: 0.26, bakedOcclusionExponent: 2, brightnessScale: 0.6, brightnessBias: 0.7, roughness: 0.85, specularIntensity: 0.12, translucency: 0.35 },
		wind: { gustAmplitude: 0.009, gustBias: 0.3, gustScale: 0.8, gustTravelSpeedScale: 0.7, gustTravelSpeedBias: 1.5, waveAmplitude: 0.0045, waveFrequency: 0.9, waveGustBias: 0.4, seedPhaseScale: 6.2832, heightScale: 0.45 },
		palette: { trees: [ { low: 0x283a1b, high: 0x364a23 } ], shrubs: [ { low: 0x3f5522, high: 0x52662a } ], bark: { dark: 0x302a22, mid: 0x5c5549, pale: 0x7b7b6a, paleStart: 0.64, paleEnd: 0.8, paleMix: 0.3 }, dryTree: { low: 0x5c5234, high: 0x6e5a3a, mix: 0.5 }, floweringTree: 0x8a4a2c },
		species: { treeSeedMultiplier: 5.31, shrubSeedMultiplier: 3.17, shrubVariantThresholds: [], dryTreeChance: 0.035, floweringTreeThreshold: 0.988 },
	},
	projection: { type: 'hemi-octahedral/1', framesPerSide: 2 }, frameGrid: { columns: 4, rows: 2, frameWidth: 16, frameHeight: 16 },
	variantGroups: [
		{ id: 'trees', modelIds: [ 'tree' ], atlasVariantRange: { start: 0, end: 1 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, windHeightDataIndex: 2, bounds: { center: [ 0, 2, 0 ], radius: 4, horizontalRadius: 3, halfHeight: 4 }, lod: { nearDistance: 10, maxDistance: 200, farFade: null } },
		{ id: 'shrubs', modelIds: [ 'shrub' ], atlasVariantRange: { start: 1, end: 2 }, variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 }, windHeightDataIndex: 2, bounds: { center: [ 0, 1, 0 ], radius: 2, horizontalRadius: 1.5, halfHeight: 2 }, lod: { nearDistance: 8, maxDistance: 100, farFade: null } },
	],
	frameBlendDistance: 100, lodBandFraction: 0.12,
	thinning: { startDistance: 140, endDistance: 320, removeFraction: 0.5, seedMultiplier: 91.7, scaleCompensation: 'inverse-square-root-retained-density/1' },
};
const descriptorBytes = Buffer.from( JSON.stringify( descriptor ) ), descriptorID = sha( descriptorBytes );
const references = [
	{ assetId: descriptorID, kind: 'octahedral-canopy/1' }, { assetId: setID, kind: 'static-model-instance-set/1' },
	{ assetId: modelAID, kind: 'glb' }, { assetId: modelBID, kind: 'glb' },
	{ assetId: atlasAID, kind: 'image/png' }, { assetId: atlasBID, kind: 'image/png' }, { assetId: leafMaskID, kind: 'image/png' },
];
const component = { type: OCTAHEDRAL_CANOPY_COMPONENT_TYPE, data: { descriptorAssetId: descriptorID }, assets: references };
const assets = new Map( [ [ descriptorID, descriptorBytes ], [ setID, setBytes ], [ modelAID, modelA ], [ modelBID, modelB ], [ atlasAID, atlasA ], [ atlasBID, atlasB ], [ leafMaskID, leafMask ] ] );
const connector = { manifest: { assets: references.map( ( { assetId, kind } ) => ( { id: assetId, kind } ) ) }, assets, async getAsset( assetId ) { return assets.get( assetId ); } };
const scene = new THREE.Scene();
const fallback = { THREE, scene, connector, beachDetailTexture: null };
const result = await webglAdapter( { fallback, connector, isCurrent: () => true }, component );
assert.equal( result.installed, true );
assert.equal( scene.children.filter( object => object.isInstancedMesh ).length, 1, 'WebGL installs the canopy as a single instanced batch' );
const mesh = scene.children.find( object => object.isInstancedMesh );
assert.equal( mesh.receiveShadow, true );
assert.equal( mesh.castShadow, false );
result.runtime.update( 1 / 60, { position: new THREE.Vector3( 50, 0, 0 ) }, null, 1 / 60 );
assert.equal( mesh.count, 1, 'the shared camera plan uploads the retained far-card draw' );
assert.equal( mesh.geometry.getAttribute( 'iCanopy0' ).data.stride, 20, 'the WebGL adapter uses the common interleaved material/LOD attributes' );
result.runtime.dispose();
assert.equal( scene.children.filter( object => object.isInstancedMesh ).length, 0, 'disposing the component removes its draw batch' );

console.log( 'WebGPU and WebGL canopy adapters register the shared contract; WebGL installs and disposes a planned far-card batch' );
