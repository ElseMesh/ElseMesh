export const GRASS_DENSITY_ASSET_KIND = 'grass-density/1';
export const MAX_GRASS_DENSITY_ASSET_BYTES = 16 * 1024 * 1024;

const MAGIC = [ 0x54, 0x47, 0x44, 0x31 ]; // TGD1
const HEADER_BYTES = 16;

export function encodeGrassDensityAsset( { data, res, size, origin } ) {
	validate( data, res, size, origin );
	const bytes = new Uint8Array( HEADER_BYTES + data.byteLength );
	const view = new DataView( bytes.buffer );
	bytes.set( MAGIC );
	view.setUint32( 4, res, true );
	view.setFloat32( 8, size, true );
	view.setFloat32( 12, origin, true );
	bytes.set( data, HEADER_BYTES );
	if ( bytes.byteLength > MAX_GRASS_DENSITY_ASSET_BYTES ) throw new Error( 'Grass density asset exceeds its size limit' );
	return bytes;
}

export function decodeGrassDensityAsset( bytes ) {
	if ( ! ( bytes instanceof Uint8Array ) || bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_GRASS_DENSITY_ASSET_BYTES || MAGIC.some( ( value, index ) => bytes[ index ] !== value ) ) throw new Error( 'Invalid grass density asset header or size' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const res = view.getUint32( 4, true ), size = view.getFloat32( 8, true ), origin = view.getFloat32( 12, true );
	const data = bytes.subarray( HEADER_BYTES );
	validate( data, res, size, origin );
	return { data, res, size, origin };
}

function validate( data, res, size, origin ) {
	if ( ! ( data instanceof Uint8Array ) || ! Number.isInteger( res ) || res < 2 || res > 2048 || ! Number.isFinite( size ) || size <= 0 || size > 100000 || ! Number.isFinite( origin ) || Math.abs( origin ) > 100000 || data.byteLength !== res * res * 4 ) throw new Error( 'Invalid grass density asset dimensions' );
}
