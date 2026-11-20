export const BREAKER_STATIONS_ASSET_KIND = 'wave-breaker-stations/1';

const MAGIC = new TextEncoder().encode( 'EMBRKST1' );
const HEADER_BYTES = 24;
const MAX_STATIONS = 8192;

export function encodeBreakerStationsAsset( { data, count, spacing } = {} ) {
	validateStations( data, count, spacing );
	const bytes = new Uint8Array( HEADER_BYTES + data.length * 4 );
	bytes.set( MAGIC );
	const view = new DataView( bytes.buffer );
	view.setUint32( 8, 1, true );
	view.setUint32( 12, count, true );
	view.setFloat64( 16, spacing, true );
	for ( let index = 0; index < data.length; index ++ ) view.setFloat32( HEADER_BYTES + index * 4, data[ index ], true );
	return bytes;
}

export function decodeBreakerStationsAsset( bytes ) {
	const source = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
	if ( ! source || source.byteLength < HEADER_BYTES || ! hasMagic( source ) ) throw new Error( 'Invalid wave breaker stations asset header' );
	const view = new DataView( source.buffer, source.byteOffset, source.byteLength );
	if ( view.getUint32( 8, true ) !== 1 ) throw new Error( 'Unsupported wave breaker stations asset version' );
	const count = view.getUint32( 12, true ), spacing = view.getFloat64( 16, true );
	if ( source.byteLength !== HEADER_BYTES + count * 16 ) throw new Error( 'Wave breaker stations asset has an invalid length' );
	const data = new Float32Array( count * 4 );
	for ( let index = 0; index < data.length; index ++ ) data[ index ] = view.getFloat32( HEADER_BYTES + index * 4, true );
	validateStations( data, count, spacing );
	return { data, count, spacing };
}

export function decodeBreakerStationsComponentAsset( component, assets ) {
	const references = ( component?.assets || [] ).filter( reference => reference.kind === BREAKER_STATIONS_ASSET_KIND );
	if ( references.length === 0 ) return null;
	if ( references.length !== 1 ) throw new Error( `Ocean component ${component.id || '(unknown)'} must reference at most one ${BREAKER_STATIONS_ASSET_KIND} asset` );
	const bytes = assets?.get?.( references[ 0 ].assetId );
	if ( ! bytes ) throw new Error( `Ocean component ${component.id || '(unknown)'} is missing breaker station bytes ${references[ 0 ].assetId}` );
	return decodeBreakerStationsAsset( bytes );
}

function validateStations( data, count, spacing ) {
	if ( ! ( data instanceof Float32Array ) || ! Number.isInteger( count ) || count < 2 || count > MAX_STATIONS || data.length !== count * 4 ) {
		throw new Error( 'Wave breaker stations must contain 2 to 8192 vec4 records' );
	}
	if ( ! Number.isFinite( spacing ) || spacing <= 0 || spacing > 1000 ) throw new Error( 'Wave breaker station spacing is invalid' );
	for ( let index = 0; index < count; index ++ ) {
		const offset = index * 4;
		if ( ! Number.isFinite( data[ offset ] ) || ! Number.isFinite( data[ offset + 1 ] ) || ! Number.isFinite( data[ offset + 2 ] ) || ! Number.isFinite( data[ offset + 3 ] ) ) {
			throw new Error( `Wave breaker station ${index} contains a non-finite value` );
		}
		const length = Math.hypot( data[ offset + 2 ], data[ offset + 3 ] );
		if ( Math.abs( length - 1 ) > 1e-3 ) throw new Error( `Wave breaker station ${index} has a non-unit sea direction` );
	}
}

function hasMagic( bytes ) {
	for ( let index = 0; index < MAGIC.length; index ++ ) if ( bytes[ index ] !== MAGIC[ index ] ) return false;
	return true;
}
