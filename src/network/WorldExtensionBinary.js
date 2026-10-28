function readU32LEB128( bytes, cursor ) {
	let value = 0;
	for ( let index = 0; index < 5; index ++ ) {
		if ( cursor.offset >= bytes.length ) throw new Error( 'Truncated WebAssembly section length' );
		const byte = bytes[ cursor.offset ++ ];
		if ( index === 4 && ( byte & 0xf0 ) !== 0 ) throw new Error( 'WebAssembly section length exceeds the supported range' );
		value += ( byte & 0x7f ) * 2 ** ( index * 7 );
		if ( ( byte & 0x80 ) === 0 ) return value;
	}
	throw new Error( 'Invalid WebAssembly section length' );
}

// Extensions receive one host-created memory. Reject module-defined memories and
// tables so a module cannot allocate resources outside its declared memory cap.
export function validateWorldExtensionBinary( bytes ) {
	if ( ! ( bytes instanceof Uint8Array ) || bytes.byteLength < 8 || bytes.byteLength > 8 * 1024 * 1024 ) throw new Error( 'World extension module has an invalid size' );
	if ( bytes[ 0 ] !== 0x00 || bytes[ 1 ] !== 0x61 || bytes[ 2 ] !== 0x73 || bytes[ 3 ] !== 0x6d || bytes[ 4 ] !== 0x01 || bytes[ 5 ] !== 0x00 || bytes[ 6 ] !== 0x00 || bytes[ 7 ] !== 0x00 ) throw new Error( 'World extension is not a WebAssembly 1.0 module' );
	const cursor = { offset: 8 };
	while ( cursor.offset < bytes.length ) {
		const sectionID = bytes[ cursor.offset ++ ];
		const payloadLength = readU32LEB128( bytes, cursor );
		const sectionEnd = cursor.offset + payloadLength;
		if ( sectionEnd > bytes.length ) throw new Error( 'WebAssembly section exceeds the module size' );
		if ( sectionID === 4 || sectionID === 5 ) {
			const sectionCursor = { offset: cursor.offset };
			const definedCount = readU32LEB128( bytes, sectionCursor );
			if ( sectionCursor.offset > sectionEnd ) throw new Error( 'WebAssembly resource section is truncated' );
			if ( definedCount !== 0 ) throw new Error( sectionID === 4 ? 'World extensions cannot define tables' : 'World extensions cannot define memory outside the host memory limit' );
		}
		cursor.offset = sectionEnd;
	}
	return bytes;
}
