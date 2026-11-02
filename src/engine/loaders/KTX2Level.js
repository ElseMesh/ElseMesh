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

/**
 * Return a valid one-level KTX2 container containing only `levelIndex` image
 * bytes plus the container metadata needed to decode that level. This is a
 * container operation only; callers must fetch the source ranges separately
 * to save network traffic.
 */
export function extractKTX2Level( input, levelIndex ) {
	const bytes = asBytes( input );
	if ( bytes.byteLength < HEADER_BYTES ) throw new Error( 'KTX2 header is truncated' );
	for ( let i = 0; i < IDENTIFIER.length; i ++ ) if ( bytes[ i ] !== IDENTIFIER[ i ] ) throw new Error( 'KTX2 identifier is invalid' );
	const sourceView = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const levelCount = sourceView.getUint32( 40, true );
	if ( levelCount < 1 || levelCount > 32 || HEADER_BYTES + levelCount * LEVEL_INDEX_BYTES > bytes.byteLength ) throw new Error( 'KTX2 level index is invalid or truncated' );
	if ( ! Number.isSafeInteger( levelIndex ) || levelIndex < 0 || levelIndex >= levelCount ) throw new RangeError( 'KTX2 level index is out of range' );
	if ( sourceView.getUint32( 28, true ) !== 0 ) throw new Error( 'KTX2 level extraction currently supports only 2D textures' );

	const sourceWidth = sourceView.getUint32( 20, true );
	const sourceHeight = sourceView.getUint32( 24, true );
	if ( sourceWidth < 1 || sourceHeight < 1 ) throw new Error( 'KTX2 dimensions are invalid' );
	const sourceRanges = [
		{ name: 'DFD', offset: sourceView.getUint32( 48, true ), length: sourceView.getUint32( 52, true ), alignment: 4 },
		{ name: 'KVD', offset: sourceView.getUint32( 56, true ), length: sourceView.getUint32( 60, true ), alignment: 4 },
		{ name: 'SGD', offset: Number( sourceView.getBigUint64( 64, true ) ), length: Number( sourceView.getBigUint64( 72, true ) ), alignment: 8 },
	];
	for ( const section of sourceRanges ) checkedRange( section.offset, section.length, bytes.byteLength, section.name );
	if ( levelCount > 1 && sourceRanges[ 2 ].length > 0 )
		throw new Error( 'KTX2 level extraction does not support multilevel containers with supercompression global data' );

	const levelIndexOffset = HEADER_BYTES + levelIndex * LEVEL_INDEX_BYTES;
	const imageOffset = Number( sourceView.getBigUint64( levelIndexOffset, true ) );
	const imageLength = Number( sourceView.getBigUint64( levelIndexOffset + 8, true ) );
	const uncompressedLength = Number( sourceView.getBigUint64( levelIndexOffset + 16, true ) );
	checkedRange( imageOffset, imageLength, bytes.byteLength, `level ${levelIndex}` );
	if ( imageLength === 0 || ! Number.isSafeInteger( uncompressedLength ) ) throw new Error( `KTX2 level ${levelIndex} has invalid lengths` );

	const outputSections = [];
	let outputLength = HEADER_BYTES + LEVEL_INDEX_BYTES;
	for ( const section of sourceRanges ) {
		if ( section.length === 0 ) {
			outputSections.push( { ...section, outputOffset: 0, data: new Uint8Array() } );
			continue;
		}
		outputLength = align( outputLength, section.alignment );
		outputSections.push( { ...section, outputOffset: outputLength, data: bytes.subarray( section.offset, section.offset + section.length ) } );
		outputLength += section.length;
	}
	outputLength = align( outputLength, 8 );
	const outputImageOffset = outputLength;
	outputLength += imageLength;
	const result = new Uint8Array( outputLength );
	result.set( bytes.subarray( 0, HEADER_BYTES ) );
	const view = new DataView( result.buffer );
	view.setUint32( 20, Math.max( 1, sourceWidth >> levelIndex ), true );
	view.setUint32( 24, Math.max( 1, sourceHeight >> levelIndex ), true );
	view.setUint32( 40, 1, true );
	for ( const section of outputSections ) {
		if ( section.length === 0 ) {
			if ( section.name === 'DFD' ) { view.setUint32( 48, 0, true ); view.setUint32( 52, 0, true ); }
			if ( section.name === 'KVD' ) { view.setUint32( 56, 0, true ); view.setUint32( 60, 0, true ); }
			if ( section.name === 'SGD' ) { view.setBigUint64( 64, 0n, true ); view.setBigUint64( 72, 0n, true ); }
			continue;
		}
		result.set( section.data, section.outputOffset );
		if ( section.name === 'DFD' ) { view.setUint32( 48, section.outputOffset, true ); view.setUint32( 52, section.length, true ); }
		if ( section.name === 'KVD' ) { view.setUint32( 56, section.outputOffset, true ); view.setUint32( 60, section.length, true ); }
		if ( section.name === 'SGD' ) { view.setBigUint64( 64, BigInt( section.outputOffset ), true ); view.setBigUint64( 72, BigInt( section.length ), true ); }
	}
	view.setBigUint64( HEADER_BYTES, BigInt( outputImageOffset ), true );
	view.setBigUint64( HEADER_BYTES + 8, BigInt( imageLength ), true );
	view.setBigUint64( HEADER_BYTES + 16, BigInt( uncompressedLength ), true );
	result.set( bytes.subarray( imageOffset, imageOffset + imageLength ), outputImageOffset );
	return result;
}
