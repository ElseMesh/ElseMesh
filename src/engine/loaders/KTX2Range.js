import { assembleKTX2LevelFromRanges, planKTX2LevelRanges } from './KTX2Level.js';

const KTX2_HEADER_BYTES = 80;
const KTX2_LEVEL_INDEX_BYTES = 24;
const MAX_KTX2_LEVELS = 32;

/** Fetch only KTX2 metadata and one indexed level from a range-capable asset connector. */
export async function fetchKTX2Level( connector, assetId, {
	imageOffset, imageLength, levelIndex, etag, assetLength, signal,
} = {} ) {
	if ( ! Number.isSafeInteger( imageOffset ) || imageOffset < 0 || ! Number.isSafeInteger( imageLength ) || imageLength < KTX2_HEADER_BYTES || ! Number.isSafeInteger( imageOffset + imageLength ) ) throw new RangeError( 'KTX2 image range is invalid' );
	if ( assetLength !== undefined && ( ! Number.isSafeInteger( assetLength ) || imageOffset + imageLength > assetLength ) ) throw new RangeError( 'KTX2 image is outside its containing asset' );
	if ( ! Number.isSafeInteger( levelIndex ) || levelIndex < 0 || levelIndex >= MAX_KTX2_LEVELS ) throw new RangeError( 'KTX2 level index is invalid' );
	if ( typeof connector?.getAssetRange !== 'function' ) throw new TypeError( 'KTX2 level fetch requires a range-capable asset connector' );
	const request = ( start, end, expectedETag ) => connector.getAssetRange( assetId, {
		start, end, ...( expectedETag ? { etag: expectedETag } : {} ),
		...( assetLength !== undefined ? { totalLength: assetLength } : {} ), signal,
	} );
	const first = await request( imageOffset, imageOffset + KTX2_HEADER_BYTES - 1, etag );
	if ( first.start !== imageOffset || first.end !== imageOffset + KTX2_HEADER_BYTES - 1 || first.bytes.byteLength !== KTX2_HEADER_BYTES ) throw new Error( 'KTX2 container header range is incomplete' );
	const prefixView = new DataView( first.bytes.buffer, first.bytes.byteOffset, first.bytes.byteLength );
	const levelCount = prefixView.getUint32( 40, true );
	if ( levelCount < 1 || levelCount > MAX_KTX2_LEVELS || levelIndex >= levelCount ) throw new Error( 'KTX2 level index is missing or invalid' );
	const indexEnd = KTX2_HEADER_BYTES + levelCount * KTX2_LEVEL_INDEX_BYTES;
	if ( indexEnd > imageLength ) throw new Error( 'KTX2 image is shorter than its level index' );
	const index = first.bytes.byteLength >= indexEnd
		? first
		: await request( imageOffset, imageOffset + indexEnd - 1, first.etag );
	if ( index.start !== imageOffset || index.end !== imageOffset + indexEnd - 1 || index.bytes.byteLength !== indexEnd ) throw new Error( 'KTX2 container level index range is incomplete' );
	const headerAndIndex = index.bytes.subarray( 0, indexEnd );
	const plan = planKTX2LevelRanges( headerAndIndex, levelIndex, { baseOffset: imageOffset, totalLength: imageLength } );
	const containerETag = first.etag;
	if ( ! containerETag || index.etag !== containerETag || index.totalLength !== first.totalLength ) throw new Error( 'KTX2 container changed while its level index was being read' );
	const prefixEnd = imageOffset + headerAndIndex.byteLength - 1;
	const ranges = plan.ranges.map( range => ( {
		start: Math.max( range.start, prefixEnd + 1 ), end: range.end,
	} ) ).filter( range => range.start <= range.end );
	const fetched = await Promise.all( ranges.map( range => request( range.start, range.end, containerETag ) ) );
	for ( const result of fetched ) {
		if ( result.etag !== containerETag || result.totalLength !== first.totalLength || result.start < imageOffset || result.end >= imageOffset + imageLength )
			throw new Error( 'KTX2 metadata or selected mip range does not match the original container' );
	}
	const bytesFor = ( start, end ) => {
		const output = new Uint8Array( end - start + 1 );
		let cursor = start;
		while ( cursor <= end ) {
			if ( cursor >= imageOffset && cursor < imageOffset + headerAndIndex.byteLength ) {
				const sourceEnd = Math.min( end, imageOffset + headerAndIndex.byteLength - 1 );
				output.set( headerAndIndex.subarray( cursor - imageOffset, sourceEnd - imageOffset + 1 ), cursor - start );
				cursor = sourceEnd + 1;
				continue;
			}
			const result = fetched.find( item => item.start <= cursor && item.end >= cursor );
			if ( ! result ) throw new Error( 'KTX2 selected-level range response is incomplete' );
			const sourceEnd = Math.min( end, result.end );
			output.set( result.bytes.subarray( cursor - result.start, sourceEnd - result.start + 1 ), cursor - start );
			cursor = sourceEnd + 1;
		}
		return output;
	};
	const sections = Object.fromEntries( plan.parts.filter( part => ! [ 'header-index', 'level' ].includes( part.kind ) ).map( part => [
		part.kind.toUpperCase(), bytesFor( part.start, part.end ),
	] ) );
	const levelPart = plan.parts.find( part => part.kind === 'level' );
	const levelBytes = bytesFor( levelPart.start, levelPart.end );
	return {
		bytes: assembleKTX2LevelFromRanges( headerAndIndex, levelIndex, { sections, levelBytes, totalLength: imageLength } ),
		etag: containerETag, totalLength: first.totalLength, levelIndex,
		width: plan.width, height: plan.height,
		requestedBytes: first.bytes.byteLength + fetched.reduce( ( total, result ) => total + result.bytes.byteLength, 0 ),
	};
}
