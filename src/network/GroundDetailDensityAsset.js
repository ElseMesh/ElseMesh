export const GROUND_DETAIL_DENSITY_ASSET_KIND = 'ground-detail-density/1';
export const MAX_GROUND_DETAIL_DENSITY_RESOLUTION = 2048;

export async function decodeGroundDetailDensityAsset( bytes, { resolution, texel } = {} ) {

	const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array( bytes ) : null;
	if ( ! data || data.byteLength === 0 || data.byteLength > 16 * 1024 * 1024 || ! Number.isInteger( resolution ) || resolution < 2 || resolution > MAX_GROUND_DETAIL_DENSITY_RESOLUTION || ! Number.isFinite( texel ) || texel <= 0 || texel > 10000 ) {
		throw new Error( 'Invalid ground-detail density asset dimensions or bytes' );
	}
	const expectedBytes = resolution * resolution * 4;
	if ( typeof DecompressionStream !== 'function' ) throw new Error( 'Ground-detail density requires DEFLATE decompression support' );
	let decompressor;
	try { decompressor = new DecompressionStream( 'deflate' ); } catch { throw new Error( 'Ground-detail density requires DEFLATE decompression support' ); }
	const reader = new Blob( [ data ] ).stream().pipeThrough( decompressor ).getReader();
	const chunks = [];
	let byteLength = 0;
	try {
		while ( true ) {
			const { done, value } = await reader.read();
			if ( done ) break;
			byteLength += value.byteLength;
			if ( byteLength > expectedBytes ) throw new Error( 'Ground-detail density expands beyond its declared dimensions' );
			chunks.push( value );
		}
	} catch ( error ) {
		await reader.cancel().catch( () => {} );
		if ( error.message.includes( 'Ground-detail density' ) ) throw error;
		throw new Error( 'Ground-detail density is not a valid DEFLATE asset' );
	}
	if ( byteLength !== expectedBytes ) throw new Error( 'Ground-detail density expands to the wrong dimensions' );
	const expanded = new Uint8Array( byteLength );
	let offset = 0;
	for ( const chunk of chunks ) { expanded.set( chunk, offset ); offset += chunk.byteLength; }
	return { data: expanded, res: resolution, texel };

}
