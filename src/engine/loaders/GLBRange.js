import { assembleKTX2LevelFromRanges, planKTX2LevelRanges } from './KTX2Level.js';
import { fetchKTX2Level, fetchKTX2LevelsFromIndex } from './KTX2Range.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const KTX2_HEADER_BYTES = 80;
const KTX2_LEVEL_INDEX_BYTES = 24;
const MAX_KTX2_LEVELS = 32;
const EXTERNAL_TEXTURE_ID = /^(?:sha256:[0-9a-f]{64}|source:[A-Za-z0-9_-]{1,2040})$/;

function textureAssetETag( assetId ) {
	return assetId.startsWith( 'source:' ) ? `"${assetId}"` : `"sha256-${assetId.slice( 7 )}"`;
}
const MAX_RANGES_PER_REQUEST = 64;

function align4( value ) { return ( value + 3 ) & ~3; }

async function requestRanges( connector, assetId, ranges, metadata, signal ) {
	const result = [];
	for ( let offset = 0; offset < ranges.length; offset += MAX_RANGES_PER_REQUEST ) {
		const batch = ranges.slice( offset, offset + MAX_RANGES_PER_REQUEST );
		result.push( ...await connector.getAssetRanges( assetId, batch, { ...metadata, signal } ) );
	}
	return result;
}

function bytesForRange( ranges, start, end ) {
	const bytes = new Uint8Array( end - start + 1 );
	let cursor = start;
	while ( cursor <= end ) {
		const range = ranges.find( item => item.start <= cursor && item.end >= cursor );
		if ( ! range ) throw new Error( 'Ranged GLB response omitted requested bytes' );
		const copyEnd = Math.min( end, range.end );
		bytes.set( range.bytes.subarray( cursor - range.start, copyEnd - range.start + 1 ), cursor - start );
		cursor = copyEnd + 1;
	}
	return bytes;
}

function buildGLB( json, geometry, images ) {
	const binLength = images.reduce( ( length, image ) => {
		const offset = align4( length );
		image.view.byteOffset = offset;
		image.view.byteLength = image.bytes.byteLength;
		return offset + image.bytes.byteLength;
	}, geometry.byteLength );
	const binChunkLength = align4( binLength );
	const bin = new Uint8Array( binChunkLength );
	bin.set( geometry );
	for ( const image of images ) bin.set( image.bytes, image.view.byteOffset );
	json.buffers[ 0 ].byteLength = binLength;
	const jsonBytes = new TextEncoder().encode( JSON.stringify( json ) );
	const jsonChunkLength = align4( jsonBytes.byteLength );
	const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
	const output = new Uint8Array( totalLength );
	const view = new DataView( output.buffer );
	view.setUint32( 0, GLB_MAGIC, true );
	view.setUint32( 4, 2, true );
	view.setUint32( 8, totalLength, true );
	view.setUint32( 12, jsonChunkLength, true );
	view.setUint32( 16, JSON_CHUNK, true );
	output.fill( 0x20, 20, 20 + jsonChunkLength );
	output.set( jsonBytes, 20 );
	const binHeader = 20 + jsonChunkLength;
	view.setUint32( binHeader, binChunkLength, true );
	view.setUint32( binHeader + 4, BIN_CHUNK, true );
	output.set( bin, binHeader + 8 );
	return output;
}

/** Fetch geometry and only the coarsest indexed mip for each embedded KTX2 image in a GLB. */
export async function fetchGLBWithCoarseKTX2( connector, assetId, { signal } = {} ) {
	if ( typeof connector?.getAssetRange !== 'function' || typeof connector?.getAssetRanges !== 'function' ) throw new TypeError( 'Progressive GLB loading requires a range-capable connector' );
	const first = await connector.getAssetRange( assetId, { start: 0, end: 19, signal } );
	if ( first.bytes.byteLength !== 20 ) throw new Error( 'GLB header range is incomplete' );
	const header = new DataView( first.bytes.buffer, first.bytes.byteOffset, first.bytes.byteLength );
	if ( header.getUint32( 0, true ) !== GLB_MAGIC || header.getUint32( 4, true ) !== 2 ) return null;
	const assetLength = header.getUint32( 8, true );
	const jsonLength = header.getUint32( 12, true );
	if ( first.totalLength !== assetLength || header.getUint32( 16, true ) !== JSON_CHUNK || jsonLength < 2 || jsonLength > assetLength - 28 ) throw new Error( 'GLB header lengths are invalid' );
	const metadata = { etag: first.etag, totalLength: assetLength };
	const jsonAndBinHeader = await connector.getAssetRange( assetId, { start: 20, end: 27 + jsonLength, ...metadata, signal } );
	if ( jsonAndBinHeader.bytes.byteLength !== jsonLength + 8 ) throw new Error( 'GLB JSON/BIN header range is incomplete' );
	const json = JSON.parse( new TextDecoder().decode( jsonAndBinHeader.bytes.subarray( 0, jsonLength ) ) );
	const imageViews = new Map();
	const externalImages = new Map();
	for ( const [ imageIndex, image ] of ( json.images || [] ).entries() ) {
		if ( image.uri ) return null;
		if ( image.mimeType !== 'image/ktx2' ) continue;
		if ( ! Number.isSafeInteger( image.bufferView ) ) {
			const assetId = image.extensions?.EXT_elsemesh_asset_reference?.assetId;
			if ( typeof assetId !== 'string' || ! EXTERNAL_TEXTURE_ID.test( assetId ) ) throw new Error( 'GLB external KTX2 image has no valid ElseMesh asset reference' );
			let external = externalImages.get( assetId );
			if ( ! external ) externalImages.set( assetId, external = { assetId, imageIndices: [] } );
			external.imageIndices.push( imageIndex );
			continue;
		}
		const bufferView = json.bufferViews?.[ image.bufferView ];
		if ( ! bufferView || bufferView.buffer !== 0 || ! Number.isSafeInteger( bufferView.byteOffset ) || ! Number.isSafeInteger( bufferView.byteLength ) ) throw new Error( 'GLB KTX2 image buffer view is invalid' );
		let imageView = imageViews.get( image.bufferView );
		if ( ! imageView ) imageViews.set( image.bufferView, imageView = { view: bufferView, imageIndices: [] } );
		imageView.imageIndices.push( imageIndex );
	}
	if ( imageViews.size === 0 && externalImages.size === 0 ) return null;
	const binHeader = new DataView( jsonAndBinHeader.bytes.buffer, jsonAndBinHeader.bytes.byteOffset + jsonLength, 8 );
	const binLength = binHeader.getUint32( 0, true );
	const binOffset = 28 + jsonLength;
	if ( binHeader.getUint32( 4, true ) !== BIN_CHUNK || binOffset + binLength > assetLength || json.buffers?.length !== 1 || json.buffers[ 0 ].byteLength > binLength ) throw new Error( 'GLB BIN chunk is invalid or unsupported' );
	const imageRanges = [ ...imageViews.entries() ].map( ( [ viewID, { view, imageIndices } ] ) => {
		if ( view.byteLength < KTX2_HEADER_BYTES || view.byteOffset + view.byteLength > binLength ) throw new Error( 'GLB KTX2 image is outside the BIN chunk' );
		return { viewID, view, imageIndices, start: binOffset + view.byteOffset, end: binOffset + view.byteOffset + view.byteLength - 1 };
	} );
	const imageViewIDs = new Set( imageViews.keys() );
	const geometryLength = ( json.bufferViews || [] ).reduce( ( length, view, index ) => {
		if ( imageViewIDs.has( index ) ) return length;
		if ( view.buffer !== 0 || ! Number.isSafeInteger( view.byteOffset ) || ! Number.isSafeInteger( view.byteLength ) ) throw new Error( 'GLB geometry buffer view is invalid' );
		return Math.max( length, view.byteOffset + view.byteLength );
	}, 0 );
	if ( geometryLength > binLength || geometryLength > 0 && imageRanges.some( range => range.view.byteOffset < geometryLength ) ) throw new Error( 'GLB geometry and texture ranges overlap' );
	const initialRanges = [ ...imageRanges.map( range => ( { start: range.start, end: range.start + KTX2_HEADER_BYTES - 1 } ) ) ];
	if ( geometryLength ) initialRanges.push( { start: binOffset, end: binOffset + geometryLength - 1 } );
	const initialBytes = await requestRanges( connector, assetId, initialRanges, metadata, signal );
	const geometry = geometryLength ? bytesForRange( initialBytes, binOffset, binOffset + geometryLength - 1 ) : new Uint8Array();
	for ( const image of imageRanges ) {
		image.header = bytesForRange( initialBytes, image.start, image.start + KTX2_HEADER_BYTES - 1 );
		const levels = new DataView( image.header.buffer, image.header.byteOffset, image.header.byteLength ).getUint32( 40, true );
		if ( levels < 1 || levels > MAX_KTX2_LEVELS ) throw new Error( 'KTX2 level count is invalid' );
		image.indexLength = KTX2_HEADER_BYTES + levels * KTX2_LEVEL_INDEX_BYTES;
		image.levelIndex = levels - 1;
		if ( image.indexLength > image.view.byteLength ) throw new Error( 'KTX2 level index exceeds the image buffer view' );
	}
	const indexRanges = imageRanges.filter( image => image.indexLength > KTX2_HEADER_BYTES ).map( image => ( {
		start: image.start + KTX2_HEADER_BYTES, end: image.start + image.indexLength - 1,
	} ) );
	const indexBytes = indexRanges.length ? await requestRanges( connector, assetId, indexRanges, metadata, signal ) : [];
	const payloadRanges = [];
	for ( const image of imageRanges ) {
		image.headerAndIndex = new Uint8Array( image.indexLength );
		image.headerAndIndex.set( image.header );
		if ( image.indexLength > KTX2_HEADER_BYTES ) image.headerAndIndex.set( bytesForRange( indexBytes, image.start + KTX2_HEADER_BYTES, image.start + image.indexLength - 1 ), KTX2_HEADER_BYTES );
		image.plan = planKTX2LevelRanges( image.headerAndIndex, image.levelIndex, {
			baseOffset: image.start, totalLength: image.view.byteLength,
		} );
		image.levelIndex = image.plan.levelIndex;
		payloadRanges.push( ...image.plan.ranges.map( range => ( {
			start: Math.max( range.start, image.start + image.indexLength ), end: range.end,
		} ) ).filter( range => range.start <= range.end ) );
	}
	const payloadBytes = payloadRanges.length ? await requestRanges( connector, assetId, payloadRanges, metadata, signal ) : [];
	const coarseImages = [];
	const progressiveImages = [];
	for ( const image of imageRanges ) {
		const bytesForImage = ( start, end ) => bytesForRange( [ { start: image.start, end: image.start + image.indexLength - 1, bytes: image.headerAndIndex }, ...payloadBytes ], start, end );
		const sections = Object.fromEntries( image.plan.parts.filter( part => ! [ 'header-index', 'level' ].includes( part.kind ) ).map( part => [
			part.kind.toUpperCase(), bytesForImage( part.start, part.end ),
		] ) );
		const level = image.plan.parts.find( part => part.kind === 'level' );
		const levelBytes = bytesForImage( level.start, level.end );
		coarseImages.push( { view: image.view, bytes: assembleKTX2LevelFromRanges( image.headerAndIndex, image.levelIndex, { sections, levelBytes, totalLength: image.view.byteLength } ) } );
		progressiveImages.push( {
			imageIndices: image.imageIndices,
			imageOffset: image.start,
			imageLength: image.view.byteLength,
			assetLength,
			etag: first.etag,
			headerAndIndex: image.headerAndIndex,
			sections,
			baseWidth: new DataView( image.headerAndIndex.buffer, image.headerAndIndex.byteOffset, image.headerAndIndex.byteLength ).getUint32( 20, true ),
			baseHeight: new DataView( image.headerAndIndex.buffer, image.headerAndIndex.byteOffset, image.headerAndIndex.byteLength ).getUint32( 24, true ),
			levelCount: image.plan.levelCount,
			levelIndex: image.levelIndex - 1,
		} );
	}
	let externalBytesRequested = 0;
	for ( const image of externalImages.values() ) {
		connector.registerExternalTextureAsset?.( assetId, image.assetId );
		const firstLevel = await connector.getAssetRange( image.assetId, { start: 0, end: KTX2_HEADER_BYTES - 1, signal } );
		if ( firstLevel.start !== 0 || firstLevel.end !== KTX2_HEADER_BYTES - 1 || firstLevel.bytes.byteLength !== KTX2_HEADER_BYTES
			|| ! Number.isSafeInteger( firstLevel.totalLength ) || firstLevel.totalLength < KTX2_HEADER_BYTES || ! firstLevel.etag )
			throw new Error( 'External KTX2 header range is incomplete' );
		if ( firstLevel.etag !== textureAssetETag( image.assetId ) ) throw new Error( 'External KTX2 ETag does not match its asset id' );
		const header = new DataView( firstLevel.bytes.buffer, firstLevel.bytes.byteOffset, firstLevel.bytes.byteLength );
		const levelCount = header.getUint32( 40, true );
		if ( levelCount < 1 || levelCount > MAX_KTX2_LEVELS ) throw new Error( 'External KTX2 level count is invalid' );
		const selected = await fetchKTX2Level( connector, image.assetId, {
			imageOffset: 0, imageLength: firstLevel.totalLength, levelIndex: levelCount - 1,
			assetLength: firstLevel.totalLength, etag: firstLevel.etag, signal,
		} );
		progressiveImages.push( {
			imageIndices: image.imageIndices,
			assetId: image.assetId,
			imageOffset: 0,
			imageLength: firstLevel.totalLength,
			assetLength: firstLevel.totalLength,
			etag: selected.etag,
			headerAndIndex: selected.headerAndIndex,
			sections: selected.sections,
			baseWidth: header.getUint32( 20, true ),
			baseHeight: header.getUint32( 24, true ),
			levelCount,
			levelIndex: levelCount - 2,
			textureAssetId: image.assetId,
			initialLevelBytes: selected.bytes,
		} );
		externalBytesRequested += firstLevel.bytes.byteLength + selected.requestedBytes;
	}
	const glb = buildGLB( json, geometry, coarseImages );
	return {
		bytes: glb,
		etag: first.etag,
		totalLength: assetLength,
		selectedLevel: 'coarsest',
		textures: progressiveImages,
		sourceBytesRequested: 20 + jsonAndBinHeader.bytes.byteLength + initialBytes.reduce( ( sum, range ) => sum + range.bytes.byteLength, 0 ) + indexBytes.reduce( ( sum, range ) => sum + range.bytes.byteLength, 0 ) + payloadBytes.reduce( ( sum, range ) => sum + range.bytes.byteLength, 0 ) + externalBytesRequested,
	};
}

/** Fetch the next finer indexed mip for every KTX2 image in a coarse GLB. */
export async function fetchNextGLBTextureLevels( connector, assetId, progressive, { signal, imageIndices = null } = {} ) {
	const wanted = imageIndices && new Set( imageIndices );
	const images = ( progressive?.textures || [] ).filter( image => image.levelIndex >= 0 && ( ! wanted || image.imageIndices.some( index => wanted.has( index ) ) ) );
	if ( images.length === 0 ) return [];
	const groups = new Map();
	for ( const image of images ) {
		const sourceAssetId = image.assetId || assetId;
		let group = groups.get( sourceAssetId );
		if ( ! group ) groups.set( sourceAssetId, group = [] );
		group.push( image );
	}
	const levels = [];
	for ( const [ sourceAssetId, group ] of groups ) {
		const selectedLevels = await fetchKTX2LevelsFromIndex( connector, sourceAssetId, group, { signal } );
		for ( const level of selectedLevels ) {
			const image = group.find( candidate => candidate.imageIndices.some( index => level.imageIndices.includes( index ) ) );
			if ( image ) image.levelIndex = level.levelIndex - 1;
		}
		levels.push( ...selectedLevels );
	}
	return levels;
}
