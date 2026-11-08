import assert from 'node:assert/strict';
import { GPU } from '../src/engine/gpu/GPU.js';
import { composeShader } from '../src/engine/gpu/Shader.js';
import { buildMeshShader } from '../src/engine/render/MeshShader.js';
import { parseGLB } from '../src/engine/loaders/GLTF.js';
import { loadWorldPackage, disposeWorldPackage } from '../src/network/WorldPackage.js';

await import('./headless.mjs');

function makeGLB( image, mimeType = 'image/png', assetId = null, materialExtras = undefined ) {
	const positions = new Float32Array( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ] );
	const embeddedImageBytes = assetId ? 0 : image.length;
	const binary = Buffer.alloc( Math.ceil( ( positions.byteLength + embeddedImageBytes ) / 4 ) * 4 );
	Buffer.from( positions.buffer ).copy( binary );
	if ( ! assetId ) image.copy( binary, positions.byteLength );
	const json = {
		asset: { version: '2.0' },
		buffers: [ { byteLength: binary.length } ],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
			...( assetId ? [] : [ { buffer: 0, byteOffset: positions.byteLength, byteLength: image.length } ] ),
		],
		accessors: [ { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' } ],
		images: [ assetId
			? { mimeType, extensions: { EXT_elsemesh_asset_reference: { assetId } } }
			: { bufferView: 1, mimeType } ],
		textures: [ mimeType === 'image/ktx2' ? { extensions: { KHR_texture_basisu: { source: 0 } } } : { source: 0 } ],
		materials: [ {
			...( materialExtras ? { extras: materialExtras } : {} ),
			emissiveFactor: [ 1, 0.1, 0 ], emissiveTexture: { index: 0 }, normalTexture: { index: 0, scale: 0.75 },
			pbrMetallicRoughness: { baseColorFactor: [ 0.5, 0.25, 0.1, 1 ], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
		} ],
		meshes: [ { primitives: [ { attributes: { POSITION: 0 }, material: 0, mode: 4 } ] } ],
		nodes: [ { name: 'Static imported node', mesh: 0, translation: [ 0.25, 0.5, - 0.75 ] } ], scenes: [ { nodes: [ 0 ] } ], scene: 0,
	};
	const requiredExtensions = [];
	if ( mimeType === 'image/ktx2' ) requiredExtensions.push( 'KHR_texture_basisu' );
	if ( assetId ) requiredExtensions.push( 'EXT_elsemesh_asset_reference' );
	if ( requiredExtensions.length ) {
		json.extensionsUsed = [ ...requiredExtensions ];
		json.extensionsRequired = [ ...requiredExtensions ];
	}
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
let graphRoot;
let ktx2Root;
let referencedKtx2Root;
const previousAssetImage = globalThis.__assetImage;
const previousAssetKTX2 = globalThis.__assetKTX2;
globalThis.__assetImage = async () => ( { width: 1, height: 1, data: new Uint8Array( [ 255, 255, 255, 255 ] ) } );
try {
	const connector = {
		worldId: 'elsemesh:emissive-texture-test',
		manifest: { portals: [], assets: [], objects: [ { id: 'fixture', kind: 'asset-instance', assetId: 'asset', transform: { position: [ 0, 0, 0 ] }, scale: [ 1, 1, 1 ] } ] },
	};
	root = await loadWorldPackage( connector, { assets: new Map( [ [ 'asset', makeGLB( Buffer.from( [ 0 ] ) ) ] ] ) } );
	let material;
	root.traverse( node => { if ( node.isMesh ) material = node.material; } );
	const instance = root.children[ 0 ];
	const importedNode = instance.children[ 0 ];
	assert.equal( importedNode.matrixAutoUpdate, false, 'static GLB node transforms cache their local matrix' );
	assert.equal( instance.matrixAutoUpdate, true, 'placed world-object roots remain movable' );
	root.updateMatrixWorld( true );
	assert.equal( importedNode.matrixWorld.elements[ 12 ], 0.25, 'cached GLB node translation remains in its world transform' );
	assert.ok( material, 'GLB scene contains its expected mesh' );
	assert.ok( material.bindings.worldEmissive?.texture?.isTexture, 'GLB emissive image is bound to the engine material' );
	assert.equal( material.bindings.worldNormal?.texture?.format, 'rgba8unorm', 'GLB normal maps use linear texture data' );
	assert.equal( material.defines.WORLD_HAS_EMISSIVE, 1, 'emissive texture sampling is enabled' );
	assert.equal( material.defines.WORLD_HAS_NORMAL, 1, 'normal texture sampling is enabled' );
	assert.match( material.surface, /perturbNormalByMap\( in\.P, in\.N, in\.uv/ );
	assert.match( material.surface, /normalSample\.xy \* 0\.75/ );
	assert.match( material.surface, /s\.emissive \*= textureSample\( worldEmissive/ );
	assert.ok( Math.abs( material.emissive.g - 0.1 ) < 1e-6, 'GLTF linear emissiveFactor stays linear' );
	assert.ok( Math.abs( material.color.r - 0.5 ) < 1e-6, 'GLTF linear baseColorFactor stays linear' );
	const meshShader = buildMeshShader( material, [ { name: 'position', wgsl: 'vec3f', location: 0 } ], { kind: 'depth' } );
	const composedShader = composeShader( { modules: meshShader.modules, bindings: meshShader.bindings, code: meshShader.code, defines: meshShader.defines, stage: 'render', label: material.name } );
	assert.match( composedShader.code, /textureSample\( worldNormal/ );
	assert.match( composedShader.code, /textureSample\( worldEmissive/ );
	const shaderModule = GPU.device.createShaderModule( { code: composedShader.code, label: 'world-package-texture-material-test' } );
	const compilation = await shaderModule.getCompilationInfo();
	const errors = compilation.messages.filter( message => message.type === 'error' );
	assert.deepEqual( errors, [], errors.map( message => message.message ).join( '\n' ) );
	const graph = {
		format: 'elsemesh.material-graph/1',
		nodes: [
			{ id: 'uv', op: 'input', name: 'uv' },
			{ id: 'lodUvWidth', op: 'fwidth', args: [ 'uv' ] },
			{ id: 'lodUvWidthX', op: 'x', args: [ 'lodUvWidth' ] },
			{ id: 'lodScale', op: 'constant', value: 1024 },
			{ id: 'lodWidth', op: 'multiply', args: [ 'lodUvWidthX', 'lodScale' ] },
			{ id: 'lodMinimum', op: 'constant', value: 1 },
			{ id: 'lodClamped', op: 'max', args: [ 'lodWidth', 'lodMinimum' ] },
			{ id: 'lod', op: 'log2', args: [ 'lodClamped' ] },
			{ id: 'sample', op: 'textureSampleLevel', slot: 'baseColor', uv: 'uv', lod: 'lod' },
			{ id: 'graphColor', op: 'rgb', args: [ 'sample' ] },
			{ id: 'worldPosition', op: 'input', name: 'worldPosition' },
			{ id: 'worldNormal', op: 'input', name: 'worldNormal' },
			{ id: 'pixelPosition', op: 'input', name: 'pixelPosition' },
			{ id: 'height', op: 'y', args: [ 'worldPosition' ] },
			{ id: 'uvWidth', op: 'fwidth', args: [ 'uv' ] },
			{ id: 'uvWidthX', op: 'x', args: [ 'uvWidth' ] },
			{ id: 'time', op: 'input', name: 'time' },
			{ id: 'windDirection', op: 'input', name: 'windDirection' },
			{ id: 'windSpeed', op: 'input', name: 'windSpeed' },
			{ id: 'windMagnitude', op: 'length', args: [ 'windDirection' ] },
			{ id: 'windStrength', op: 'multiply', args: [ 'windMagnitude', 'windSpeed' ] },
			{ id: 'scale', op: 'constant', value: 0.001 },
			{ id: 'windDetail', op: 'multiply', args: [ 'windStrength', 'scale' ] },
			{ id: 'timeWave', op: 'sin', args: [ 'time' ] },
			{ id: 'timeDetail', op: 'multiply', args: [ 'timeWave', 'scale' ] },
			{ id: 'roughnessBase', op: 'add', args: [ 'height', 'uvWidthX' ] },
			{ id: 'roughnessDetail', op: 'add', args: [ 'windDetail', 'timeDetail' ] },
			{ id: 'roughness', op: 'add', args: [ 'roughnessBase', 'roughnessDetail' ] },
			{ id: 'slope', op: 'constant', value: [ 0.04, - 0.02 ] },
			{ id: 'surfaceNormal', op: 'normalFromSlope', args: [ 'worldPosition', 'worldNormal', 'uv', 'slope' ] },
			{ id: 'pixelX', op: 'x', args: [ 'pixelPosition' ] },
			{ id: 'pixelScale', op: 'constant', value: 0.0001 },
			{ id: 'pixelDetail', op: 'multiply', args: [ 'pixelX', 'pixelScale' ] },
			{ id: 'roughnessWithPixel', op: 'add', args: [ 'roughness', 'pixelDetail' ] },
		],
		outputs: { baseColor: 'graphColor', roughness: 'roughnessWithPixel', surfaceNormal: 'surfaceNormal' },
	};
	const graphBytes = makeGLB( Buffer.from( [ 0 ] ), 'image/png', null, { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', graph } } );
	graphRoot = await loadWorldPackage( connector, { assets: new Map( [ [ 'asset', graphBytes ] ] ) } );
	let graphMaterial;
	graphRoot.traverse( node => { if ( node.isMesh ) graphMaterial = node.material; } );
	assert.ok( graphMaterial?.bindings.emgTexture_baseColor?.texture?.isTexture, 'signed GLB base-color texture is bound to graph sampling' );
	assert.equal( graphMaterial.defines.WORLD_HAS_ALBEDO, 0, 'graph-sampled base color is not applied twice' );
	assert.match( graphMaterial.surface, /textureSampleLevel\( emgTexture_baseColor, smpAnisoRepeat, in\.vs\.emg_uv, emg_lod \)/ );
	assert.match( graphMaterial.surface, /log2\( emg_lodClamped \)/ );
	assert.match( graphMaterial.surface, /let emg_height: f32 = in\.P\.y/ );
	assert.match( graphMaterial.surface, /fwidth\( in\.vs\.emg_uv \)/ );
	assert.match( graphMaterial.surface, /frame\.time/ );
	assert.match( graphMaterial.surface, /frame\.windDir/ );
	assert.match( graphMaterial.surface, /frame\.windSpeed/ );
	const graphShader = buildMeshShader( graphMaterial, [ { name: 'position', wgsl: 'vec3f', location: 0 } ], { kind: 'depth' } );
	const graphComposed = composeShader( { modules: graphShader.modules, bindings: graphShader.bindings, code: graphShader.code, defines: graphShader.defines, stage: 'render', label: graphMaterial.name } );
	const graphCompilation = await GPU.device.createShaderModule( { code: graphComposed.code, label: 'world-material-graph-texture-test' } ).getCompilationInfo();
	assert.deepEqual( graphCompilation.messages.filter( message => message.type === 'error' ), [], 'WebGPU compiles graph texture samples from package-loaded GLB textures' );
	let decodedKTX2Bytes;
	globalThis.__assetKTX2 = async bytes => {
		decodedKTX2Bytes = bytes;
		return { width: 1, height: 1, data: new Uint8Array( [ 18, 52, 86, 255 ] ) };
	};
	ktx2Root = await loadWorldPackage( connector, { assets: new Map( [ [ 'asset', makeGLB( Buffer.from( [ 1, 2, 3, 4 ] ), 'image/ktx2' ) ] ] ) } );
	let ktx2Material;
	ktx2Root.traverse( node => { if ( node.isMesh ) ktx2Material = node.material; } );
	assert.ok( ktx2Material?.bindings.worldNormal?.texture?.isTexture, 'KHR_texture_basisu source can bind a linear normal texture' );
	assert.ok( ktx2Material.bindings.worldEmissive?.texture?.isTexture, 'KHR_texture_basisu source can bind an emissive texture' );
	assert.ok( decodedKTX2Bytes instanceof Uint8Array, 'KTX2 extension routes embedded bytes through the KTX2 decoder' );
	const externalImageId = `sha256:${'a'.repeat( 64 )}`;
	const externalImageBytes = new Uint8Array( [ 9, 8, 7, 6 ] );
	connector.manifest.assets.push( { id: externalImageId, kind: 'image/ktx2', bytes: externalImageBytes.byteLength, priority: 'visible' } );
	connector.getAsset = async assetId => {
		assert.ok( connector.manifest.assets.some( asset => asset.id === assetId ), 'external image references resolve only declared manifest assets' );
		return externalImageBytes;
	};
	const referencedGLB = makeGLB( Buffer.alloc( 0 ), 'image/ktx2', externalImageId );
	assert.equal( parseGLB( referencedGLB ).images[ 0 ].assetId, externalImageId, 'GLB parser preserves the immutable image asset reference' );
	let externalDecodeCount = 0;
	let externalAssetFetchCount = 0;
	globalThis.__assetKTX2 = async bytes => {
		externalDecodeCount++;
		decodedKTX2Bytes = bytes;
		return { width: 1, height: 1, data: new Uint8Array( [ 18, 52, 86, 255 ] ) };
	};
	connector.getAsset = async assetId => {
		externalAssetFetchCount++;
		assert.ok( connector.manifest.assets.some( asset => asset.id === assetId ), 'external image references resolve only declared manifest assets' );
		return externalImageBytes;
	};
	connector.manifest.objects.push( { id: 'fixture-2', kind: 'asset-instance', assetId: 'asset-2', transform: { position: [ 2, 0, 0 ] }, scale: [ 1, 1, 1 ] } );
	referencedKtx2Root = await loadWorldPackage( connector, { assets: new Map( [ [ 'asset', referencedGLB ], [ 'asset-2', referencedGLB ] ] ) } );
	const referencedMaterials = [];
	referencedKtx2Root.traverse( node => { if ( node.isMesh ) referencedMaterials.push( node.material ); } );
	assert.equal( referencedMaterials.length, 2, 'two GLB region assets were loaded' );
	assert.ok( referencedMaterials[ 0 ]?.bindings.worldNormal?.texture?.isTexture, 'manifest-referenced KTX2 image binds as a normal texture' );
	assert.strictEqual( referencedMaterials[ 0 ].bindings.worldAlbedo.texture, referencedMaterials[ 0 ].bindings.worldEmissive.texture, 'identical image asset IDs share the same decoded GPU texture within a GLB' );
	assert.strictEqual( referencedMaterials[ 0 ].bindings.worldAlbedo.texture, referencedMaterials[ 1 ].bindings.worldAlbedo.texture, 'identical image asset IDs share a decoded GPU texture across GLB region assets' );
	assert.equal( externalDecodeCount, 2, 'shared sRGB and linear references each decode once across both GLBs' );
	assert.equal( externalAssetFetchCount, 2, 'the connector fetches the content-addressed image once for each color-space variant' );
	assert.deepEqual( decodedKTX2Bytes, externalImageBytes, 'WorldPackage obtains external image bytes through the connector before KTX2 decoding' );
	assert.throws( () => parseGLB( makeGLB( Buffer.alloc( 0 ), 'image/ktx2', 'untrusted-path' ) ), /invalid ElseMesh asset reference/, 'asset references reject non-content-addressed IDs' );
	console.log( 'World package: normal/emissive textures, linear color factors, and material WGSL verified' );
} finally {
	if ( root ) disposeWorldPackage( root );
	if ( graphRoot ) disposeWorldPackage( graphRoot );
	if ( ktx2Root ) disposeWorldPackage( ktx2Root );
	if ( referencedKtx2Root ) disposeWorldPackage( referencedKtx2Root );
	if ( previousAssetImage === undefined ) delete globalThis.__assetImage;
	else globalThis.__assetImage = previousAssetImage;
	if ( previousAssetKTX2 === undefined ) delete globalThis.__assetKTX2;
	else globalThis.__assetKTX2 = previousAssetKTX2;
}
