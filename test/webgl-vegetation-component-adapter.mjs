import assert from 'node:assert/strict';
import '../src/fallback/WebGLVegetationComponentAdapter.js';
import { worldComponentBackendBatchAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { encodeGrassDensityAsset } from '../src/network/GrassDensityAsset.js';

const type = 'elsemesh.static-vegetation/1';
const components = [
	{ id: 'canopy-a', type, placementAssetId: 'plants-a', grassMaskAssetId: 'grass-a' },
	{ id: 'canopy-b', type, placementAssetId: 'plants-b' },
];
const calls = [], removed = [];
const fallback = {
	hostedTerrainData: { size: 20, origin: - 10 },
	scene: { remove: group => removed.push( group ) },
	_loadVegetation: async options => {
		calls.push( options );
		return { traverse: visit => visit( { isGroup: true } ) };
	},
};
const grassMask = encodeGrassDensityAsset( { data: new Uint8Array( 4 * 4 * 4 ), res: 4, size: 20, origin: - 10 } );
const grassMaskBuffer = grassMask.buffer.slice( grassMask.byteOffset, grassMask.byteOffset + grassMask.byteLength );
const assets = new Map( [ [ 'plants-a', new Uint8Array( [ 1 ] ) ], [ 'plants-b', new Uint8Array( [ 2 ] ) ], [ 'grass-a', grassMaskBuffer ] ] );
const adapter = worldComponentBackendBatchAdapter( 'webgl', type );
const result = await adapter( { fallback, assets, manifest: { spawn: { position: [ 12, 2, - 8 ] } } }, components );

assert.deepEqual( result.componentIDs, [ 'canopy-a', 'canopy-b' ] );
assert.deepEqual( calls.map( call => call.centerPosition ), [ [ 12, - 8 ], [ 12, - 8 ] ] );
assert.equal( fallback.hostedGrassMask.size, 20, 'ArrayBuffer grass masks remain valid package assets' );
result.runtime.dispose();
assert.equal( removed.length, 2, 'world teardown removes each static vegetation group' );
console.log( 'WebGL static vegetation components batch through the backend registry' );
