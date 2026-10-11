function invariant( value, message ) { if ( ! value ) throw new Error( message ); }

export async function verifySignedDocument( document, protocol ) {
	invariant( document?.protocol === protocol && typeof document.signer === 'string' && typeof document.publicKey === 'string' && typeof document.signature === 'string' && document.payload, 'Invalid signed world document' );
	const protobufKey = decodeBase64( document.publicKey );
	invariant( protobufKey.length === 36 && protobufKey[ 0 ] === 8 && protobufKey[ 1 ] === 1 && protobufKey[ 2 ] === 18 && protobufKey[ 3 ] === 32, 'Unsupported world signing key' );
	invariant( peerIdFromEd25519( protobufKey ) === document.signer, 'World signer does not match its public key' );
	const unsigned = { protocol: document.protocol, signer: document.signer, publicKey: document.publicKey, payload: document.payload };
	const key = await crypto.subtle.importKey( 'raw', protobufKey.subarray( 4 ), { name: 'Ed25519' }, false, [ 'verify' ] );
	const valid = await crypto.subtle.verify( 'Ed25519', key, decodeBase64( document.signature ), new TextEncoder().encode( canonicalJSON( unsigned ) ) );
	invariant( valid, 'World signature verification failed' );
}

function decodeBase64( value ) {
	const normalized = value.replace( /-/g, '+' ).replace( /_/g, '/' );
	const binary = atob( normalized + '='.repeat( ( 4 - normalized.length % 4 ) % 4 ) );
	return Uint8Array.from( binary, ( char ) => char.charCodeAt( 0 ) );
}

function canonicalJSON( value ) {
	if ( Array.isArray( value ) ) return `[${value.map( canonicalJSON ).join( ',' )}]`;
	if ( value && typeof value === 'object' ) return `{${Object.keys( value ).sort().map( ( key ) => `${canonicalString( key )}:${canonicalJSON( value[ key ] )}` ).join( ',' )}}`;
	return typeof value === 'string' ? canonicalString( value ) : JSON.stringify( value );
}

function canonicalString( value ) { return JSON.stringify( value ).replace( /[<>&\u2028\u2029]/g, ( char ) => `\\u${char.charCodeAt( 0 ).toString( 16 ).padStart( 4, '0' )}` ); }

function peerIdFromEd25519( protobufKey ) {
	const multihash = new Uint8Array( 2 + protobufKey.length );
	multihash[ 0 ] = 0;
	multihash[ 1 ] = protobufKey.length;
	multihash.set( protobufKey, 2 );
	return base58( multihash );
}

function base58( bytes ) {
	const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	let value = 0n;
	for ( const byte of bytes ) value = value * 256n + BigInt( byte );
	let encoded = '';
	while ( value > 0n ) { encoded = alphabet[ Number( value % 58n ) ] + encoded; value /= 58n; }
	for ( const byte of bytes ) { if ( byte !== 0 ) break; encoded = `1${encoded}`; }
	return encoded;
}
