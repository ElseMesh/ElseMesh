import assert from 'node:assert/strict';
import { GPU } from '../src/engine/gpu/GPU.js';
import { loadWorldPackage, disposeWorldPackage } from '../src/network/WorldPackage.js';

await import('./headless.mjs');

function makeGLB( image ) {
	const positions = new Float32Array( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ] );
	const binary = Buffer.alloc( Math.ceil( ( positions.byteLength + image.length ) / 4 ) * 4 );
	Buffer.from( positions.buffer ).copy( binary );
	image.copy( binary, positions.byteLength );
	const json = {
		asset: { version: '2.0' },
		buffers: [ { byteLength: binary.length } ],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
			{ buffer: 0, byteOffset: positions.byteLength, byteLength: image.length },
		],
		accessors: [ { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' } ],
		images: [ { bufferView: 1, mimeType: 'image/png' } ],
		textures: [ { source: 0 } ],
		materials: [ {
			emissiveFactor: [ 1, 0.1, 0 ], emissiveTexture: { index: 0 },
			pbrMetallicRoughness: { baseColorFactor: [ 0.5, 0.25, 0.1, 1 ], metallicFactor: 0, roughnessFactor: 1 },
		} ],
		meshes: [ { primitives: [ { attributes: { POSITION: 0 }, material: 0, mode: 4 } ] } ],
		nodes: [ { mesh: 0 } ], scenes: [ { nodes: [ 0 ] } ], scene: 0,
	};
	const jsonBytes = Buffer.from( JSON.stringify( json ) );
	const jsonPadding = Buffer.alloc( ( 4 - jsonBytes.length % 4 ) % 4, 0x20 );
	const jsonChunk = Buffer.concat( [ jsonBytes, jsonPadding ] );
	const binaryChunk = binary;
	const glb = Buffer.alloc( 12 + 8 + jsonChunk.length + 8 + binaryChunk.length );
	glb.writeUInt32LE( 0x46546c67, 0 ); glb.writeUInt32LE( 2, 4 ); glb.writeUInt32LE( glb.length, 8 );
	glb.writeUInt32LE( jsonChunk.length, 12 ); glb.writeUInt32LE( 0x4e4f534a, 16 ); jsonChunk.copy( glb, 20 );
	const binaryHeader = 20 + jsonChunk.length;
	glb.writeUInt32LE( binaryChunk.length, binaryHeader ); glb.writeUInt32LE( 0x004e4942, binaryHeader + 4 );
	binaryChunk.copy( glb, binaryHeader + 8 );
	return glb;
}

await GPU.init( { headless: true } );
let root;
const previousAssetImage = globalThis.__assetImage;
globalThis.__assetImage = async () => ( { width: 1, height: 1, data: new Uint8Array( [ 255, 255, 255, 255 ] ) } );
try {
	const connector = {
		worldId: 'elsemesh:emissive-texture-test',
		manifest: { portals: [], objects: [ { id: 'fixture', kind: 'asset-instance', assetId: 'asset', transform: { position: [ 0, 0, 0 ] }, scale: [ 1, 1, 1 ] } ] },
	};
	root = await loadWorldPackage( connector, { assets: new Map( [ [ 'asset', makeGLB( Buffer.from( [ 0 ] ) ) ] ] ) } );
	let material;
	root.traverse( node => { if ( node.isMesh ) material = node.material; } );
	assert.ok( material, 'GLB scene contains its expected mesh' );
	assert.ok( material.bindings.worldEmissive?.texture?.isTexture, 'GLB emissive image is bound to the engine material' );
	assert.equal( material.defines.WORLD_HAS_EMISSIVE, 1, 'emissive texture sampling is enabled' );
	assert.match( material.surface, /s\.emissive \*= textureSample\( worldEmissive/ );
	assert.ok( Math.abs( material.emissive.g - 0.1 ) < 1e-6, 'GLTF linear emissiveFactor stays linear' );
	assert.ok( Math.abs( material.color.r - 0.5 ) < 1e-6, 'GLTF linear baseColorFactor stays linear' );
	console.log( 'World package: emissive texture is bound and GLTF linear color factors are preserved' );
} finally {
	if ( root ) disposeWorldPackage( root );
	if ( previousAssetImage === undefined ) delete globalThis.__assetImage;
	else globalThis.__assetImage = previousAssetImage;
}
