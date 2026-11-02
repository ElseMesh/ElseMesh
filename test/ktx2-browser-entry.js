import { canUploadBCTexture, decodeKTX2 } from '../src/engine/loaders/KTX2.js';
import { GPU } from '../src/engine/webgpu.js';
import { disposeWorldPackage, loadWorldPackage } from '../src/network/WorldPackage.js';

const result = document.querySelector( '#result' );

function makeGLB( imageBytes ) {
	const positions = new Float32Array( [ -1, -1, 0, 1, -1, 0, 0, 1, 0 ] );
	const uvs = new Float32Array( [ 0, 0, 1, 0, 0.5, 1 ] );
	const imageOffset = ( positions.byteLength + uvs.byteLength + 3 ) & ~3;
	const binary = new Uint8Array( ( imageOffset + imageBytes.byteLength + 3 ) & ~3 );
	binary.set( new Uint8Array( positions.buffer ), 0 );
	binary.set( new Uint8Array( uvs.buffer ), positions.byteLength );
	binary.set( imageBytes, imageOffset );
	const json = {
		asset: { version: '2.0' },
		buffers: [ { byteLength: binary.byteLength } ],
		bufferViews: [
			{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
			{ buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength },
			{ buffer: 0, byteOffset: imageOffset, byteLength: imageBytes.byteLength },
		],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
			{ bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
		],
		images: [ { bufferView: 2, mimeType: 'image/ktx2' } ],
		textures: [ { extensions: { KHR_texture_basisu: { source: 0 } } } ],
		materials: [ { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } ],
		meshes: [ { primitives: [ { attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 } ] } ],
		nodes: [ { mesh: 0 } ], scenes: [ { nodes: [ 0 ] } ], scene: 0,
		extensionsUsed: [ 'KHR_texture_basisu' ], extensionsRequired: [ 'KHR_texture_basisu' ],
	};
	const jsonBytes = new TextEncoder().encode( JSON.stringify( json ) );
	const jsonLength = ( jsonBytes.byteLength + 3 ) & ~3;
	const glb = new ArrayBuffer( 12 + 8 + jsonLength + 8 + binary.byteLength );
	const view = new DataView( glb );
	view.setUint32( 0, 0x46546c67, true ); view.setUint32( 4, 2, true ); view.setUint32( 8, glb.byteLength, true );
	view.setUint32( 12, jsonLength, true ); view.setUint32( 16, 0x4e4f534a, true );
	const jsonChunk = new Uint8Array( glb, 20, jsonLength );
	jsonChunk.set( jsonBytes );
	jsonChunk.fill( 0x20, jsonBytes.byteLength );
	const binaryHeader = 20 + jsonLength;
	view.setUint32( binaryHeader, binary.byteLength, true ); view.setUint32( binaryHeader + 4, 0x004e4942, true );
	new Uint8Array( glb, binaryHeader + 8 ).set( binary );
	return new Uint8Array( glb );
}

try {
	const requireWebGPU = new URLSearchParams( location.search ).get( 'webgpu' ) === '1';
	if ( requireWebGPU ) await GPU.init( { headless: true } );
	const hasBC = GPU.features.has( 'texture-compression-bc' );
	if ( requireWebGPU && ! hasBC ) throw new Error( 'WebGPU adapter does not expose texture-compression-bc' );

	const response = await fetch( '/test/fixtures/ktx2-checker.ktx2' );
	if ( ! response.ok ) throw new Error( `fixture request failed: ${response.status}` );
	const ktx2Bytes = new Uint8Array( await response.arrayBuffer() );
	const image = await decodeKTX2( ktx2Bytes );
	if ( image.width !== 16 || image.height !== 16 ) throw new Error( `unexpected dimensions ${image.width}x${image.height}` );
	if ( ! canUploadBCTexture( 16, 16 ) || canUploadBCTexture( 15, 13 ) || canUploadBCTexture( 2, 2 ) ) throw new Error( 'BC texture block-alignment selection is invalid' );
	let colors = null;
	if ( image.format ) {
		if ( image.format !== 'bc7-rgba-unorm' && image.format !== 'bc7-rgba-unorm-srgb' ) throw new Error( `unexpected compressed texture format ${image.format}` );
		if ( ! image.mipmaps?.length ) throw new Error( 'compressed texture has no mip levels' );
		const device = GPU.device;
		device.pushErrorScope( 'validation' );
		const connector = {
			worldId: 'elsemesh:ktx2-webgpu-test',
			manifest: { assets: [], portals: [], objects: [ { id: 'fixture', kind: 'asset-instance', assetId: 'fixture', transform: { position: [ 0, 0, 0 ] }, scale: [ 1, 1, 1 ] } ] },
		};
		const root = await loadWorldPackage( connector, { assets: new Map( [ [ 'fixture', makeGLB( ktx2Bytes ) ] ] ) } );
		let texture;
		root.traverse( node => { if ( node.isMesh ) texture = node.material.bindings.worldAlbedo?.texture; } );
		if ( texture?.format !== image.format ) throw new Error( `WorldPackage did not retain the decoded BC7 format (${texture?.format})` );
		if ( texture?.mipLevelCount !== image.mipmaps.length ) throw new Error( `WorldPackage created ${texture?.mipLevelCount} mip levels; expected ${image.mipmaps.length}` );
		await GPU.queue.onSubmittedWorkDone();
		let validationError = await device.popErrorScope();
		if ( validationError ) throw new Error( `WebGPU rejected BC7 texture creation/upload: ${validationError.message}` );
		disposeWorldPackage( root );
	} else {
		if ( image.data.length !== 16 * 16 * 4 ) throw new Error( `unexpected RGBA byte count ${image.data.length}` );
		const pixel = ( x, y ) => Array.from( image.data.subarray( ( y * image.width + x ) * 4, ( y * image.width + x ) * 4 + 4 ) );
		const green = pixel( 1, 1 );
		const red = pixel( 5, 1 );
		if ( green[ 1 ] < 160 || red[ 0 ] < 160 || Math.abs( green[ 1 ] - red[ 1 ] ) < 80 )
			throw new Error( `transcoded checker colors are wrong: ${JSON.stringify( { green, red } )}` );
		if ( green[ 3 ] < 240 || red[ 3 ] < 240 ) throw new Error( `transcoded alpha is wrong: ${JSON.stringify( { green, red } )}` );
		colors = { green, red };
	}
	result.dataset.status = 'passed';
	result.textContent = JSON.stringify( {
		width: image.width,
		height: image.height,
		format: image.format || 'rgba8',
		mipLevels: image.mipmaps?.length || 1,
		webgpuBC: hasBC,
		colors,
	} );
} catch ( error ) {
	result.dataset.status = 'failed';
	result.textContent = error.stack || String( error );
}
