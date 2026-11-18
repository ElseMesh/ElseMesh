export const RGBA_DATA_TEXTURE_ASSET_KIND = 'rgba-data-texture/1';
export const MAX_RGBA_DATA_TEXTURE_BYTES = 16 * 1024 * 1024;

const MAGIC = [ 0x45, 0x4d, 0x52, 0x31 ]; // EMR1
const HEADER_BYTES = 12;

export function encodeRgbaDataTextureAsset( { data, width, height } ) {
	validate( data, width, height );
	const bytes = new Uint8Array( HEADER_BYTES + data.byteLength );
	const view = new DataView( bytes.buffer );
	bytes.set( MAGIC );
	view.setUint32( 4, width, true );
	view.setUint32( 8, height, true );
	bytes.set( data, HEADER_BYTES );
	if ( bytes.byteLength > MAX_RGBA_DATA_TEXTURE_BYTES ) throw new Error( 'RGBA data texture exceeds its size limit' );
	return bytes;
}

export function decodeRgbaDataTextureAsset( bytes ) {
	if ( ! ( bytes instanceof Uint8Array ) || bytes.byteLength < HEADER_BYTES || bytes.byteLength > MAX_RGBA_DATA_TEXTURE_BYTES || MAGIC.some( ( value, index ) => bytes[ index ] !== value ) ) throw new Error( 'Invalid RGBA data texture header or size' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const width = view.getUint32( 4, true ), height = view.getUint32( 8, true );
	const data = bytes.subarray( HEADER_BYTES );
	validate( data, width, height );
	return { data, width, height };
}

function validate( data, width, height ) {
	if ( ! ( data instanceof Uint8Array ) || ! Number.isInteger( width ) || width < 2 || width > 2048 || ! Number.isInteger( height ) || height < 2 || height > 2048 || data.byteLength !== width * height * 4 || data.byteLength + HEADER_BYTES > MAX_RGBA_DATA_TEXTURE_BYTES ) throw new Error( 'Invalid RGBA data texture dimensions' );
}
