import { canUploadBCTexture, decodeKTX2 } from '../src/engine/loaders/KTX2.js';
import { fetchKTX2Level } from '../src/engine/loaders/KTX2Range.js';
import { fetchGLBWithCoarseKTX2 } from '../src/engine/loaders/GLBRange.js';
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
	const sourceLevelCount = new DataView( ktx2Bytes.buffer, ktx2Bytes.byteOffset, ktx2Bytes.byteLength ).getUint32( 40, true );
	const rangeETag = `"sha256-${'0'.repeat( 64 )}"`;
	const sourceGLB = makeGLB( ktx2Bytes );
	const requestedGLBRanges = [];
	const rangedGLBConnector = {
		getAssetRange: async ( _assetId, { start, end } ) => {
			requestedGLBRanges.push( { start, end } );
			return { bytes: sourceGLB.slice( start, end + 1 ), etag: rangeETag, start, end, totalLength: sourceGLB.byteLength };
		},
		getAssetRanges: async ( _assetId, ranges ) => {
			for ( const range of ranges ) requestedGLBRanges.push( { ...range } );
			return ranges.map( range => ( { bytes: sourceGLB.slice( range.start, range.end + 1 ), etag: rangeETag, ...range, totalLength: sourceGLB.byteLength } ) );
		},
	};
	const coarseGLB = await fetchGLBWithCoarseKTX2( rangedGLBConnector, 'fixture-glb' );
	if ( ! coarseGLB || coarseGLB.bytes.byteLength >= sourceGLB.byteLength ) throw new Error( 'coarse GLB range assembly did not reduce the texture payload' );
	const coarseJSONLength = new DataView( coarseGLB.bytes.buffer, coarseGLB.bytes.byteOffset, coarseGLB.bytes.byteLength ).getUint32( 12, true );
	const coarseBinStart = 28 + coarseJSONLength;
	const coarseJSON = JSON.parse( new TextDecoder().decode( coarseGLB.bytes.subarray( 20, 20 + coarseJSONLength ) ) );
	const coarseView = coarseJSON.bufferViews[ coarseJSON.images[ 0 ].bufferView ];
	const coarseKTX2 = coarseGLB.bytes.subarray( coarseBinStart + coarseView.byteOffset, coarseBinStart + coarseView.byteOffset + coarseView.byteLength );
	const coarseImage = await decodeKTX2( coarseKTX2 );
	if ( coarseImage.width !== 1 || coarseImage.height !== 1 || coarseImage.mipmaps?.length > 1 ) throw new Error( 'coarse GLB did not decode as one coarsest texture level' );
	const rangeBase = 96;
	const rangeAsset = new Uint8Array( rangeBase + ktx2Bytes.byteLength + 32 );
	rangeAsset.set( ktx2Bytes, rangeBase );
	const rangeConnector = { getAssetRange: async ( _assetId, { start, end } ) => ( {
		bytes: rangeAsset.slice( start, end + 1 ), etag: rangeETag, start, end, totalLength: rangeAsset.byteLength,
	} ) };
	for ( const level of [ 0, sourceLevelCount - 1 ] ) {
		const ranged = await fetchKTX2Level( rangeConnector, 'fixture-glb', {
			imageOffset: rangeBase, imageLength: ktx2Bytes.byteLength, assetLength: rangeAsset.byteLength, levelIndex: level, etag: rangeETag,
		} );
		if ( ranged.requestedBytes >= ktx2Bytes.byteLength ) throw new Error( 'selected mip range plan did not reduce the fixture payload bytes' );
		const singleLevel = await decodeKTX2( ranged.bytes );
		const expectedWidth = Math.max( 1, 16 >> level ), expectedHeight = Math.max( 1, 16 >> level );
		if ( singleLevel.width !== expectedWidth || singleLevel.height !== expectedHeight ) throw new Error( `single KTX2 mip ${level} decoded as ${singleLevel.width}x${singleLevel.height}, expected ${expectedWidth}x${expectedHeight}` );
		if ( singleLevel.mipmaps?.length > 1 ) throw new Error( `single KTX2 mip ${level} unexpectedly decoded ${singleLevel.mipmaps.length} levels` );
	}
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
		const coarseRoot = await loadWorldPackage( connector, { assets: new Map( [ [ 'fixture', coarseGLB.bytes ] ] ) } );
		let coarseTexture;
		coarseRoot.traverse( node => { if ( node.isMesh ) coarseTexture = node.material.bindings.worldAlbedo?.texture; } );
		const coarseFormatMatches = coarseImage.format ? coarseTexture?.format === coarseImage.format : coarseTexture?.format?.startsWith( 'rgba8' );
		if ( ! coarseFormatMatches || coarseTexture?.mipLevelCount !== 1 ) throw new Error( `WorldPackage did not install the coarse single-level texture (format ${coarseTexture?.format || 'missing'} vs ${coarseImage.format || 'rgba8'}, levels ${coarseTexture?.mipLevelCount})` );
		await GPU.queue.onSubmittedWorkDone();
		let validationError = await device.popErrorScope();
		if ( validationError ) throw new Error( `WebGPU rejected BC7 texture creation/upload: ${validationError.message}` );
		disposeWorldPackage( coarseRoot );
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
		if ( coarseImage.data.length !== 4 ) throw new Error( 'coarse RGBA texture does not contain one pixel' );
	}
	result.dataset.status = 'passed';
	result.textContent = JSON.stringify( {
		width: image.width,
		height: image.height,
		format: image.format || 'rgba8',
		mipLevels: image.mipmaps?.length || 1,
		coarseMipLevels: coarseImage.mipmaps?.length || 1,
		webgpuBC: hasBC,
		colors,
	} );
} catch ( error ) {
	result.dataset.status = 'failed';
	result.textContent = error.stack || String( error );
}
