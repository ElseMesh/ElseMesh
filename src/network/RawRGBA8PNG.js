const PNG_SIGNATURE = [ 137, 80, 78, 71, 13, 10, 26, 10 ];
const COLOR_PROFILE_CHUNKS = new Set( [ 'cHRM', 'gAMA', 'iCCP', 'sRGB' ] );

function fail( message ) {
	throw new Error( `Invalid raw RGBA8 data PNG: ${message}` );
}

/** Inspect a content-addressed PNG intended to be sampled as byte data. */
export function inspectRawRGBA8PNG( input ) {
	const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array( input ) : null;
	if ( ! bytes || bytes.length < 45 || PNG_SIGNATURE.some( ( byte, index ) => bytes[ index ] !== byte ) ) fail( 'asset is not a complete PNG image' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	if ( view.getUint32( 8 ) !== 13 || String.fromCharCode( ...bytes.subarray( 12, 16 ) ) !== 'IHDR' ) fail( 'PNG must begin with a canonical IHDR chunk' );
	const width = view.getUint32( 16 ), height = view.getUint32( 20 );
	if ( ! width || ! height || bytes[ 24 ] !== 8 || bytes[ 25 ] !== 6 || bytes[ 26 ] !== 0 || bytes[ 27 ] !== 0 || bytes[ 28 ] !== 0 ) fail( 'PNG must use non-interlaced RGBA8 encoding' );
	let offset = 8, hasData = false, ended = false;
	while ( offset + 12 <= bytes.length ) {
		const length = view.getUint32( offset );
		const type = String.fromCharCode( ...bytes.subarray( offset + 4, offset + 8 ) );
		const end = offset + 12 + length;
		if ( end > bytes.length ) fail( 'PNG contains a truncated chunk' );
		if ( COLOR_PROFILE_CHUNKS.has( type ) ) fail( 'PNG must not contain color-space conversion metadata' );
		if ( type === 'IDAT' ) hasData = true;
		if ( type === 'IEND' ) {
			if ( length !== 0 || end !== bytes.length ) fail( 'PNG has malformed trailing data' );
			ended = true;
			break;
		}
		offset = end;
	}
	if ( ! hasData || ! ended ) fail( 'PNG is missing image data or its end marker' );
	return { width, height };
}

function paethPredictor( left, up, upperLeft ) {
	const prediction = left + up - upperLeft;
	const leftDistance = Math.abs( prediction - left );
	const upDistance = Math.abs( prediction - up );
	const upperLeftDistance = Math.abs( prediction - upperLeft );
	if ( leftDistance <= upDistance && leftDistance <= upperLeftDistance ) return left;
	return upDistance <= upperLeftDistance ? up : upperLeft;
}

/** Decode a raw RGBA8 PNG without browser color conversion or alpha premultiplication. */
export async function decodeRawRGBA8PNG( input, width, height ) {
	const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array( input ) : null;
	if ( ! bytes || ! Number.isSafeInteger( width ) || width < 1 || ! Number.isSafeInteger( height ) || height < 1 ) fail( 'valid PNG bytes and dimensions are required' );
	const dimensions = inspectRawRGBA8PNG( bytes );
	if ( dimensions.width !== width || dimensions.height !== height ) fail( 'dimensions do not match the PNG header' );
	if ( typeof DecompressionStream !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function' ) throw new Error( 'Raw PNG decoding requires browser decompression streams' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const compressedChunks = [];
	let compressedLength = 0;
	for ( let offset = 8; offset + 12 <= bytes.length; ) {
		const length = view.getUint32( offset );
		const type = String.fromCharCode( ...bytes.subarray( offset + 4, offset + 8 ) );
		const start = offset + 8, end = start + length;
		if ( type === 'IDAT' ) {
			compressedChunks.push( bytes.subarray( start, end ) );
			compressedLength += length;
		}
		if ( type === 'IEND' ) break;
		offset = end + 4;
	}
	const compressed = new Uint8Array( compressedLength );
	let compressedOffset = 0;
	for ( const chunk of compressedChunks ) {
		compressed.set( chunk, compressedOffset );
		compressedOffset += chunk.length;
	}
	const rowBytes = width * 4;
	const filteredLength = ( rowBytes + 1 ) * height;
	if ( ! Number.isSafeInteger( filteredLength ) || filteredLength > 0x7fffffff ) fail( 'dimensions exceed the decoder limit' );
	const filtered = new Uint8Array( await new Response( new Blob( [ compressed ] ).stream().pipeThrough( new DecompressionStream( 'deflate' ) ) ).arrayBuffer() );
	if ( filtered.length !== filteredLength ) fail( 'decompressed data has an invalid length' );
	const pixels = new Uint8Array( rowBytes * height );
	for ( let y = 0; y < height; y ++ ) {
		const sourceRow = y * ( rowBytes + 1 );
		const filter = filtered[ sourceRow ];
		if ( filter > 4 ) fail( `PNG uses unsupported row filter ${filter}` );
		const targetRow = y * rowBytes;
		for ( let x = 0; x < rowBytes; x ++ ) {
			const left = x >= 4 ? pixels[ targetRow + x - 4 ] : 0;
			const up = y > 0 ? pixels[ targetRow + x - rowBytes ] : 0;
			const upperLeft = y > 0 && x >= 4 ? pixels[ targetRow + x - rowBytes - 4 ] : 0;
			let predictor = 0;
			if ( filter === 1 ) predictor = left;
			else if ( filter === 2 ) predictor = up;
			else if ( filter === 3 ) predictor = Math.floor( ( left + up ) / 2 );
			else if ( filter === 4 ) predictor = paethPredictor( left, up, upperLeft );
			pixels[ targetRow + x ] = ( filtered[ sourceRow + 1 + x ] + predictor ) & 255;
		}
	}
	return pixels;
}
