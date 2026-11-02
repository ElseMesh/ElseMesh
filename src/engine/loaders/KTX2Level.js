const IDENTIFIER = [ 0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A ];
const HEADER_BYTES = 80;
const LEVEL_INDEX_BYTES = 24;

function align( value, boundary ) {
	return Math.ceil( value / boundary ) * boundary;
}

function asBytes( value ) {
	if ( value instanceof Uint8Array ) return value;
	if ( value instanceof ArrayBuffer ) return new Uint8Array( value );
	throw new TypeError( 'KTX2 input must be an ArrayBuffer or Uint8Array' );
}

function checkedRange( offset, length, total, label ) {
	if ( ! Number.isSafeInteger( offset ) || ! Number.isSafeInteger( length ) || offset < 0 || length < 0 || offset + length > total )
		throw new Error( `KTX2 ${label} range is outside the file` );
	return [ offset, offset + length ];
}

function readLayout( input, { totalLength = input.byteLength } = {} ) {
	const bytes = asBytes( input );
	if ( bytes.byteLength < HEADER_BYTES ) throw new Error( 'KTX2 header is truncated' );
	for ( let i = 0; i < IDENTIFIER.length; i ++ ) if ( bytes[ i ] !== IDENTIFIER[ i ] ) throw new Error( 'KTX2 identifier is invalid' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const levelCount = view.getUint32( 40, true );
	if ( levelCount < 1 || levelCount > 32 ) throw new Error( 'KTX2 level count is invalid' );
	const indexEnd = HEADER_BYTES + levelCount * LEVEL_INDEX_BYTES;
	if ( bytes.byteLength < indexEnd ) throw new Error( 'KTX2 level index is truncated' );
	if ( view.getUint32( 28, true ) !== 0 ) throw new Error( 'KTX2 level selection currently supports only 2D textures' );
	const width = view.getUint32( 20, true ), height = view.getUint32( 24, true );
	if ( width < 1 || height < 1 || ! Number.isSafeInteger( totalLength ) || totalLength < indexEnd ) throw new Error( 'KTX2 dimensions or length are invalid' );
	const sections = [
		{ name: 'DFD', offset: view.getUint32( 48, true ), length: view.getUint32( 52, true ), alignment: 4 },
		{ name: 'KVD', offset: view.getUint32( 56, true ), length: view.getUint32( 60, true ), alignment: 4 },
		{ name: 'SGD', offset: Number( view.getBigUint64( 64, true ) ), length: Number( view.getBigUint64( 72, true ) ), alignment: 8 },
	];
	for ( const section of sections ) checkedRange( section.offset, section.length, totalLength, section.name );
	if ( levelCount > 1 && sections[ 2 ].length > 0 ) throw new Error( 'KTX2 level selection does not support multilevel containers with supercompression global data' );
	const levels = Array.from( { length: levelCount }, ( _, index ) => {
		const offset = HEADER_BYTES + index * LEVEL_INDEX_BYTES;
		const imageOffset = Number( view.getBigUint64( offset, true ) );
		const imageLength = Number( view.getBigUint64( offset + 8, true ) );
		const uncompressedLength = Number( view.getBigUint64( offset + 16, true ) );
		checkedRange( imageOffset, imageLength, totalLength, `level ${index}` );
		if ( imageOffset < indexEnd || imageLength < 1 || ! Number.isSafeInteger( uncompressedLength ) ) throw new Error( `KTX2 level ${index} has invalid lengths` );
		return { index, offset: imageOffset, length: imageLength, uncompressedLength };
	} );
	return { bytes, view, indexEnd, levelCount, width, height, sections, levels, totalLength };
}

function mergeRanges( ranges ) {
	const sorted = ranges.filter( range => range.end >= range.start ).sort( ( a, b ) => a.start - b.start );
	const merged = [];
	for ( const range of sorted ) {
		const previous = merged.at( - 1 );
		if ( previous && range.start <= previous.end + 1 ) previous.end = Math.max( previous.end, range.end );
		else merged.push( { ...range } );
	}
	return merged;
}

/** Plan only the KTX2 metadata and payload ranges needed to extract one mip. */
export function planKTX2LevelRanges( input, levelIndex, { baseOffset = 0, totalLength = input.byteLength } = {} ) {
	const layout = readLayout( input, { totalLength } );
	if ( ! Number.isSafeInteger( levelIndex ) || levelIndex < 0 || levelIndex >= layout.levelCount ) throw new RangeError( 'KTX2 level index is out of range' );
	if ( ! Number.isSafeInteger( baseOffset ) || baseOffset < 0 || ! Number.isSafeInteger( baseOffset + totalLength ) ) throw new RangeError( 'KTX2 base offset is invalid' );
	const selected = layout.levels[ levelIndex ];
	const parts = [
		{ start: baseOffset, end: baseOffset + layout.indexEnd - 1, kind: 'header-index' },
		...layout.sections.filter( section => section.length > 0 ).map( section => ( { start: baseOffset + section.offset, end: baseOffset + section.offset + section.length - 1, kind: section.name.toLowerCase() } ) ),
		{ start: baseOffset + selected.offset, end: baseOffset + selected.offset + selected.length - 1, kind: 'level', level: levelIndex },
	];
	return {
		levelIndex, levelCount: layout.levelCount,
		width: Math.max( 1, layout.width >> levelIndex ), height: Math.max( 1, layout.height >> levelIndex ),
		levelLength: selected.length, uncompressedLength: selected.uncompressedLength,
		parts, ranges: mergeRanges( parts ),
	};
}

/** Reassemble a one-level KTX2 from its header/index, metadata, and selected payload ranges. */
export function assembleKTX2LevelFromRanges( input, levelIndex, { sections = {}, levelBytes, totalLength = input.byteLength } = {} ) {
	const layout = readLayout( input, { totalLength } );
	if ( ! Number.isSafeInteger( levelIndex ) || levelIndex < 0 || levelIndex >= layout.levelCount ) throw new RangeError( 'KTX2 level index is out of range' );
	const selected = layout.levels[ levelIndex ];
	const payload = asBytes( levelBytes );
	if ( payload.byteLength !== selected.length ) throw new Error( 'KTX2 selected level payload length does not match its index' );
	const outputSections = layout.sections.map( section => {
		if ( section.length === 0 ) return { ...section, data: new Uint8Array() };
		const data = asBytes( sections[ section.name ] );
		if ( data.byteLength !== section.length ) throw new Error( `KTX2 ${section.name} range length does not match its metadata` );
		return { ...section, data };
	} );
	let outputLength = HEADER_BYTES + LEVEL_INDEX_BYTES;
	for ( const section of outputSections ) {
		section.outputOffset = section.length ? align( outputLength, section.alignment ) : 0;
		if ( section.length ) outputLength = section.outputOffset + section.length;
	}
	const outputImageOffset = align( outputLength, 8 );
	const result = new Uint8Array( outputImageOffset + payload.byteLength );
	result.set( layout.bytes.subarray( 0, layout.indexEnd ) );
	const view = new DataView( result.buffer );
	view.setUint32( 20, Math.max( 1, layout.width >> levelIndex ), true );
	view.setUint32( 24, Math.max( 1, layout.height >> levelIndex ), true );
	view.setUint32( 40, 1, true );
	for ( const section of outputSections ) {
		if ( section.length ) result.set( section.data, section.outputOffset );
		if ( section.name === 'DFD' ) { view.setUint32( 48, section.outputOffset, true ); view.setUint32( 52, section.length, true ); }
		if ( section.name === 'KVD' ) { view.setUint32( 56, section.outputOffset, true ); view.setUint32( 60, section.length, true ); }
		if ( section.name === 'SGD' ) { view.setBigUint64( 64, BigInt( section.outputOffset ), true ); view.setBigUint64( 72, BigInt( section.length ), true ); }
	}
	view.setBigUint64( HEADER_BYTES, BigInt( outputImageOffset ), true );
	view.setBigUint64( HEADER_BYTES + 8, BigInt( payload.byteLength ), true );
	view.setBigUint64( HEADER_BYTES + 16, BigInt( selected.uncompressedLength ), true );
	result.set( payload, outputImageOffset );
	return result;
}

/**
 * Return a valid one-level KTX2 container containing only `levelIndex` image
 * bytes plus the container metadata needed to decode that level. This is a
 * container operation only; callers must fetch the source ranges separately
 * to save network traffic.
 */
export function extractKTX2Level( input, levelIndex ) {
	const layout = readLayout( input );
	if ( ! Number.isSafeInteger( levelIndex ) || levelIndex < 0 || levelIndex >= layout.levelCount ) throw new RangeError( 'KTX2 level index is out of range' );
	const selected = layout.levels[ levelIndex ];
	const sections = Object.fromEntries( layout.sections.map( section => [ section.name,
		section.length ? layout.bytes.subarray( section.offset, section.offset + section.length ) : new Uint8Array(),
	] ) );
	return assembleKTX2LevelFromRanges( layout.bytes.subarray( 0, layout.indexEnd ), levelIndex, {
		sections, levelBytes: layout.bytes.subarray( selected.offset, selected.offset + selected.length ), totalLength: layout.totalLength,
	} );
}
