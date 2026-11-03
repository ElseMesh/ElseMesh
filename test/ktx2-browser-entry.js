import { canUploadBCTexture, decodeKTX2 } from '../src/engine/loaders/KTX2.js';
import { fetchKTX2Level } from '../src/engine/loaders/KTX2Range.js';
import { fetchGLBWithCoarseKTX2, fetchNextGLBTextureLevels } from '../src/engine/loaders/GLBRange.js';
import { GPU } from '../src/engine/webgpu.js';
import { disposeWorldPackage, loadWorldPackage, updateWorldPackageLOD } from '../src/network/WorldPackage.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';

const result = document.querySelector( '#result' );
const testWarnings = [];
const originalWarn = console.warn.bind( console );
console.warn = ( ...args ) => { testWarnings.push( args.map( value => value instanceof Error ? value.stack || value.message : String( value ) ).join( ' ' ) ); originalWarn( ...args ); };

function makeGLB( imageBytes, externalTextureAssetId = null ) {
	const positions = new Float32Array( [ -1, -1, 0, 1, -1, 0, 0, 1, 0 ] );
	const uvs = new Float32Array( [ 0, 0, 1, 0, 0.5, 1 ] );
	const imageOffset = ( positions.byteLength + uvs.byteLength + 3 ) & ~3;
	const storedImageBytes = externalTextureAssetId ? new Uint8Array() : imageBytes;
	const binary = new Uint8Array( ( imageOffset + storedImageBytes.byteLength + 3 ) & ~3 );
	binary.set( new Uint8Array( positions.buffer ), 0 );
	binary.set( new Uint8Array( uvs.buffer ), positions.byteLength );
	binary.set( storedImageBytes, imageOffset );
	const bufferViews = [
		{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
		{ buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength },
	];
	const image = externalTextureAssetId
		? { mimeType: 'image/ktx2', extensions: { EXT_elsemesh_asset_reference: { assetId: externalTextureAssetId } } }
		: { bufferView: 2, mimeType: 'image/ktx2' };
	if ( ! externalTextureAssetId ) bufferViews.push( { buffer: 0, byteOffset: imageOffset, byteLength: imageBytes.byteLength } );
	const json = {
		asset: { version: '2.0' },
		buffers: [ { byteLength: binary.byteLength } ],
		bufferViews,
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
			{ bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
		],
		images: [ image ],
		textures: [ { extensions: { KHR_texture_basisu: { source: 0 } } } ],
		materials: [ { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } ],
		meshes: [ { primitives: [ { attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 } ] } ],
		nodes: [ { mesh: 0 } ], scenes: [ { nodes: [ 0 ] } ], scene: 0,
		extensionsUsed: [ 'KHR_texture_basisu', ...( externalTextureAssetId ? [ 'EXT_elsemesh_asset_reference' ] : [] ) ],
		extensionsRequired: [ 'KHR_texture_basisu', ...( externalTextureAssetId ? [ 'EXT_elsemesh_asset_reference' ] : [] ) ],
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
	const coarseProgressiveState = structuredClone( coarseGLB );
	const coarseJSONLength = new DataView( coarseGLB.bytes.buffer, coarseGLB.bytes.byteOffset, coarseGLB.bytes.byteLength ).getUint32( 12, true );
	const coarseBinStart = 28 + coarseJSONLength;
	const coarseJSON = JSON.parse( new TextDecoder().decode( coarseGLB.bytes.subarray( 20, 20 + coarseJSONLength ) ) );
	const coarseView = coarseJSON.bufferViews[ coarseJSON.images[ 0 ].bufferView ];
	const coarseKTX2 = coarseGLB.bytes.subarray( coarseBinStart + coarseView.byteOffset, coarseBinStart + coarseView.byteOffset + coarseView.byteLength );
	const coarseImage = await decodeKTX2( coarseKTX2 );
	if ( coarseImage.width !== 1 || coarseImage.height !== 1 || coarseImage.mipmaps?.length > 1 ) throw new Error( 'coarse GLB did not decode as one coarsest texture level' );
	const finerLevels = await fetchNextGLBTextureLevels( rangedGLBConnector, 'fixture-glb', coarseGLB );
	if ( finerLevels.length !== 1 ) throw new Error( 'coarse GLB did not expose one next-finer mip' );
	const finerImage = await decodeKTX2( finerLevels[ 0 ].bytes );
	if ( finerImage.width <= coarseImage.width || finerImage.height <= coarseImage.height || finerImage.mipmaps?.length > 1 ) throw new Error( 'next-finer KTX2 range did not decode as a larger one-level image' );
	const externalTextureAssetId = `sha256:${'1'.repeat( 64 )}`;
	const externalTextureETag = `"sha256-${externalTextureAssetId.slice( 7 )}"`;
	const externalSourceGLB = makeGLB( ktx2Bytes, externalTextureAssetId );
	const externalRangeRequests = [];
	const externalConnector = {
		getAssetRange: async ( assetId, { start, end, signal } ) => {
			const bytes = assetId === 'external-glb' ? externalSourceGLB : assetId === externalTextureAssetId ? ktx2Bytes : null;
			if ( ! bytes ) throw new Error( `unexpected external asset ${assetId}` );
			externalRangeRequests.push( { assetId, start, end } );
			return { bytes: bytes.slice( start, end + 1 ), etag: assetId === 'external-glb' ? '"external-glb"' : externalTextureETag, start, end, totalLength: bytes.byteLength };
		},
		getAssetRanges: async ( assetId, ranges ) => {
			const bytes = assetId === 'external-glb' ? externalSourceGLB : assetId === externalTextureAssetId ? ktx2Bytes : null;
			if ( ! bytes ) throw new Error( `unexpected external asset ${assetId}` );
			for ( const range of ranges ) externalRangeRequests.push( { assetId, ...range } );
			return ranges.map( range => ( { bytes: bytes.slice( range.start, range.end + 1 ), etag: assetId === 'external-glb' ? '"external-glb"' : externalTextureETag, ...range, totalLength: bytes.byteLength } ) );
		},
	};
	const externalCoarseGLB = await fetchGLBWithCoarseKTX2( externalConnector, 'external-glb' );
	if ( ! externalCoarseGLB ) throw new Error( 'external content-addressed KTX2 image was not processed progressively' );
	const externalProgressiveForPackage = structuredClone( externalCoarseGLB );
	const externalProgressive = structuredClone( externalCoarseGLB );
	const externalCoarseTexture = await decodeKTX2( externalProgressive.textures[ 0 ].initialLevelBytes );
	if ( externalCoarseTexture.width !== 1 || externalCoarseTexture.height !== 1 ) throw new Error( 'external KTX2 did not start from its coarsest standalone mip' );
	const externalNextLevels = await fetchNextGLBTextureLevels( externalConnector, 'external-glb', externalCoarseGLB );
	const externalNextTexture = await decodeKTX2( externalNextLevels[ 0 ].bytes );
	if ( externalNextTexture.width <= externalCoarseTexture.width || externalNextTexture.height <= externalCoarseTexture.height ) throw new Error( 'external KTX2 mip upgrade did not advance to a larger image' );
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
		let validationError;
		const connector = {
			worldId: 'elsemesh:ktx2-webgpu-test',
			manifest: { assets: [], portals: [], objects: [ { id: 'fixture', kind: 'asset-instance', assetId: 'fixture', transform: { position: [ 0, 0, 0 ] }, scale: [ 1, 1, 1 ] } ] },
		};
		const root = await loadWorldPackage( connector, { assets: new Map( [ [ 'fixture', makeGLB( ktx2Bytes ) ] ] ) } );
		let texture;
		root.traverse( node => { if ( node.isMesh ) texture = node.material.bindings.worldAlbedo?.texture; } );
		if ( texture?.format !== image.format ) throw new Error( `WorldPackage did not retain the decoded BC7 format (${texture?.format})` );
		if ( texture?.mipLevelCount !== image.mipmaps.length ) throw new Error( `WorldPackage created ${texture?.mipLevelCount} mip levels; expected ${image.mipmaps.length}` );
		const progressiveConnector = {
			...rangedGLBConnector,
			worldId: connector.worldId,
			manifest: { ...connector.manifest, objects: [ { ...connector.manifest.objects[ 0 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 1 } } ] },
		};
		const coarseRoot = await loadWorldPackage( progressiveConnector, {
			assets: new Map( [ [ 'fixture', coarseGLB.bytes ] ] ),
			progressiveAssets: new Map( [ [ 'fixture', coarseProgressiveState ] ] ),
		} );
		let coarseTexture;
		coarseRoot.traverse( node => { if ( node.isMesh ) coarseTexture = node.material.bindings.worldAlbedo?.texture; } );
		const coarseFormatMatches = coarseTexture?.format?.startsWith( 'rgba8' );
		if ( ! coarseFormatMatches || coarseTexture?.mipLevelCount !== 1 ) throw new Error( `WorldPackage did not install the coarse single-level texture (format ${coarseTexture?.format || 'missing'} vs ${coarseImage.format || 'rgba8'}, levels ${coarseTexture?.mipLevelCount})` );
		const camera = new PerspectiveCamera( 62, 1, 0.1, 100 );
		camera.position.set( 0, 0, 3 ); camera.updateProjectionMatrix(); camera.updateMatrixWorld( true );
		const progressiveTarget = [ ...coarseRoot.userData.worldPackage.progressiveTextureTargets.values() ].find( target => target.sourceAssets.has( 'fixture' ) );
		if ( ! progressiveTarget ) throw new Error( 'WorldPackage did not retain the coarse image source for progressive upgrades' );
		camera.position.set( 0, 0, 1000 ); camera.updateMatrixWorld( true );
		for ( let attempt = 0; attempt < 100 && Math.min( ...progressiveTarget.levels.keys() ) > 3; attempt ++ ) {
			updateWorldPackageLOD( coarseRoot, camera );
			await new Promise( resolve => setTimeout( resolve, 5 ) );
		}
		if ( progressiveTarget.levels.size !== 2 || Math.min( ...progressiveTarget.levels.keys() ) !== 3 ) throw new Error( `distant screen-space demand should retain only the required coarse levels (resident ${[ ...progressiveTarget.levels.keys() ]})` );
		camera.position.set( 0, 0, 3 ); camera.updateMatrixWorld( true );
		for ( let attempt = 0; attempt < 100 && Math.min( ...progressiveTarget.levels.keys() ) > 0; attempt ++ ) {
			updateWorldPackageLOD( coarseRoot, camera );
			await new Promise( resolve => setTimeout( resolve, 5 ) );
		}
		if ( Math.min( ...progressiveTarget.levels.keys() ) !== 0 || coarseTexture.width !== 16 || coarseTexture.height !== 16 || coarseTexture.mipLevelCount !== sourceLevelCount ) throw new Error( `screen-space texture streaming did not install all required levels (${coarseTexture.width}x${coarseTexture.height}, ${coarseTexture.mipLevelCount} mips)` );
		camera.position.set( 0, 0, 1000 ); camera.updateMatrixWorld( true );
		updateWorldPackageLOD( coarseRoot, camera );
		if ( progressiveTarget.levels.size !== 2 || Math.min( ...progressiveTarget.levels.keys() ) !== 3 || coarseTexture.width !== 2 || coarseTexture.height !== 2 || coarseTexture.mipLevelCount !== 2 ) throw new Error( `distant view did not demote decoded and GPU texture tiers (${[ ...progressiveTarget.levels.keys() ]}, ${coarseTexture.width}x${coarseTexture.height}, ${coarseTexture.mipLevelCount} mips)` );
		camera.position.set( 0, 0, 3 ); camera.updateMatrixWorld( true );
		for ( let attempt = 0; attempt < 100 && Math.min( ...progressiveTarget.levels.keys() ) > 0; attempt ++ ) {
			updateWorldPackageLOD( coarseRoot, camera );
			await new Promise( resolve => setTimeout( resolve, 5 ) );
		}
		if ( Math.min( ...progressiveTarget.levels.keys() ) !== 0 || coarseTexture.width !== 16 || coarseTexture.mipLevelCount !== sourceLevelCount ) throw new Error( 'near view did not restore evicted mip tiers from connector ranges' );
		const externalProgressiveConnector = {
			...externalConnector,
			worldId: 'elsemesh:ktx2-external-webgpu-test',
			manifest: { ...connector.manifest, objects: [
				{ ...connector.manifest.objects[ 0 ], id: 'external-fixture-a', assetId: 'external-fixture', streamingBounds: { center: [ 0, 0, 0 ], radius: 1 } },
				{ ...connector.manifest.objects[ 0 ], id: 'external-fixture-b', assetId: 'external-fixture-b', transform: { position: [ 5, 0, 0 ] }, streamingBounds: { center: [ 0, 0, 0 ], radius: 1 } },
			] },
		};
		const externalRoot = await loadWorldPackage( externalProgressiveConnector, {
			assets: new Map( [ [ 'external-fixture', externalCoarseGLB.bytes ], [ 'external-fixture-b', externalCoarseGLB.bytes ] ] ),
			progressiveAssets: new Map( [ [ 'external-fixture', externalProgressiveForPackage ], [ 'external-fixture-b', externalProgressiveForPackage ] ] ),
		} );
		const externalTextures = new Set();
		externalRoot.traverse( node => { if ( node.isMesh ) externalTextures.add( node.material.bindings.worldAlbedo?.texture ); } );
		const externalTexture = [ ...externalTextures ][ 0 ];
		if ( externalTextures.size !== 1 ) throw new Error( 'mesh LODs that share an external KTX2 identity did not share one GPU texture' );
		if ( externalTexture?.width !== 1 || ! [ ...externalRoot.userData.worldPackage.textureAssets.keys() ].some( key => key.startsWith( externalTextureAssetId ) ) ) throw new Error( 'WorldPackage did not seed and share the coarse external texture asset' );
		const externalTarget = [ ...externalRoot.userData.worldPackage.progressiveTextureTargets.values() ].find( target => target.texture === externalTexture );
		if ( ! externalTarget ) throw new Error( 'WorldPackage did not retain the external texture mip range target' );
		if ( externalTarget.sourceAssets.size !== 2 ) throw new Error( 'shared texture residency did not register both mesh LOD owners' );
		camera.position.set( 0, 0, 3 ); camera.updateMatrixWorld( true );
		for ( let attempt = 0; attempt < 100 && Math.min( ...externalTarget.levels.keys() ) > 0; attempt ++ ) {
			updateWorldPackageLOD( externalRoot, camera );
			await new Promise( resolve => setTimeout( resolve, 5 ) );
		}
		if ( Math.min( ...externalTarget.levels.keys() ) !== 0 || externalTexture.width !== 16 || externalTexture.mipLevelCount !== sourceLevelCount ) throw new Error( `WorldPackage did not install all external KTX2 mips (${externalTexture.width}x${externalTexture.height}, ${externalTexture.mipLevelCount} mips)` );
		await GPU.queue.onSubmittedWorkDone();
		validationError = await device.popErrorScope();
		if ( validationError ) throw new Error( `WebGPU rejected texture creation/upload: ${validationError.message}` );
		disposeWorldPackage( externalRoot );
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
		nextMipDimensions: [ finerImage.width, finerImage.height ],
		webgpuBC: hasBC,
		colors,
	} );
} catch ( error ) {
	result.dataset.status = 'failed';
	result.textContent = [ error.stack || String( error ), ...testWarnings ].join( '\n' );
}
