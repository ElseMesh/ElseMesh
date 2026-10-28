import { PALETTE, MEADOW } from '../world/terrain/TerrainShading.js';

const OUTER_MAGIC = new TextEncoder().encode( 'EMTERR1\0' );
const INNER_MAGIC = new TextEncoder().encode( 'ETRNSF1\0' );
const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;

const palette = ( colors ) => Object.fromEntries( Object.entries( colors ).map( ( [ name, expression ] ) => {
	const match = /^vec3f\(\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+)\s*\)$/.exec( expression );
	if ( ! match ) throw new Error( `Unsupported terrain palette expression for ${name}` );
	return [ name, match.slice( 1 ).map( Number ) ];
} ) );

export function encodeTerrainSurfaceAsset( terrain, maps, detail ) {

	const heightBytes = new Uint8Array( terrain.heights.buffer, terrain.heights.byteOffset, terrain.heights.byteLength );
	const normalBytes = new Uint8Array( maps.normal.buffer, maps.normal.byteOffset, maps.normal.byteLength );
	const splatBytes = new Uint8Array( maps.splat.buffer, maps.splat.byteOffset, maps.splat.byteLength );
	const detailBytes = new Uint8Array( detail.data.buffer, detail.data.byteOffset, detail.data.byteLength );
	if ( terrain.heights.constructor !== Float32Array || maps.normal.constructor !== Uint8Array || maps.splat.constructor !== Uint8Array || detail.data.constructor !== Uint8Array ) throw new Error( 'Terrain surface maps have unsupported typed arrays' );
	if ( maps.normal.length !== terrain.res * terrain.res * 4 || maps.splat.length !== terrain.res * terrain.res * 4 || detail.data.length !== detail.width * detail.height * 4 ) throw new Error( 'Terrain surface maps do not match their declared dimensions' );
	const metadata = new TextEncoder().encode( JSON.stringify( {
		protocol: 'elsemesh.terrain-data/1', rendererProfile: 'original-elsemesh-terrain-v1', size: terrain.size, origin: terrain.origin,
		resolution: terrain.res, heightEncoding: 'f32le', maskEncoding: 'rgba8unorm',
		detailWidth: detail.width, detailHeight: detail.height, detailEncoding: 'rgba8unorm',
		material: { roughness: 0.9, wetDarken: 0.58, paletteLinear: palette( PALETTE ), meadowLinear: palette( MEADOW ) },
		normalChannels: [ 'normal-x', 'normal-z', 'rock', 'ambient-occlusion' ],
		splatChannels: [ 'sand', 'path', 'gully-or-seagrass', 'rubble-or-scarp' ],
	} ) );
	const metadataPadding = ( 4 - metadata.length % 4 ) % 4;
	const rawLength = 12 + metadata.length + metadataPadding + heightBytes.length + normalBytes.length + splatBytes.length + detailBytes.length;
	if ( rawLength > MAX_UNCOMPRESSED_BYTES ) throw new Error( 'Terrain surface asset exceeds the uncompressed size limit' );
	const raw = new Uint8Array( rawLength );
	raw.set( INNER_MAGIC, 0 );
	const view = new DataView( raw.buffer );
	view.setUint32( 8, metadata.length, true );
	let offset = 12;
	raw.set( metadata, offset ); offset += metadata.length + metadataPadding;
	const heightView = new DataView( raw.buffer, offset, heightBytes.length );
	for ( let i = 0; i < terrain.heights.length; i ++ ) heightView.setFloat32( i * 4, terrain.heights[ i ], true );
	offset += heightBytes.length;
	raw.set( normalBytes, offset ); offset += normalBytes.length;
	raw.set( splatBytes, offset ); offset += splatBytes.length;
	raw.set( detailBytes, offset );
	return raw;

}

export async function decodeTerrainSurfaceAsset( compressed ) {

	const bytes = compressed instanceof Uint8Array ? compressed : new Uint8Array( compressed );
	if ( bytes.length < 17 || ! matches( bytes, OUTER_MAGIC, 0 ) ) throw new Error( 'Invalid terrain surface asset header' );
	const header = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	if ( header.getUint32( 8, true ) !== 1 ) throw new Error( 'Unsupported terrain surface asset version' );
	const expectedBytes = header.getUint32( 12, true );
	if ( expectedBytes < 16 || expectedBytes > MAX_UNCOMPRESSED_BYTES ) throw new Error( 'Terrain surface asset has an invalid expanded size' );
	if ( typeof DecompressionStream !== 'function' ) throw new Error( 'This browser cannot decompress terrain surface assets' );
	const stream = new Blob( [ bytes.subarray( 16 ) ] ).stream().pipeThrough( new DecompressionStream( 'deflate' ) );
	const reader = stream.getReader();
	const raw = new Uint8Array( expectedBytes );
	let expandedBytes = 0;
	while ( true ) {
		const { value, done } = await reader.read();
		if ( done ) break;
		if ( expandedBytes + value.length > expectedBytes ) {
			await reader.cancel();
			throw new Error( 'Terrain surface asset expanded beyond its declared size' );
		}
		raw.set( value, expandedBytes );
		expandedBytes += value.length;
	}
	if ( expandedBytes !== expectedBytes ) throw new Error( 'Terrain surface asset expanded to an unexpected size' );
	if ( ! matches( raw, INNER_MAGIC, 0 ) ) throw new Error( 'Invalid terrain surface payload signature' );
	const rawView = new DataView( raw.buffer );
	const metadataBytes = rawView.getUint32( 8, true );
	if ( metadataBytes < 2 || metadataBytes > 16384 || 12 + metadataBytes > raw.length ) throw new Error( 'Invalid terrain surface metadata length' );
	let metadata;
	try { metadata = JSON.parse( new TextDecoder().decode( raw.subarray( 12, 12 + metadataBytes ) ) ); }
	catch { throw new Error( 'Invalid terrain surface metadata' ); }
	if ( metadata.protocol !== 'elsemesh.terrain-data/1' || metadata.rendererProfile !== 'original-elsemesh-terrain-v1' || metadata.heightEncoding !== 'f32le' || metadata.maskEncoding !== 'rgba8unorm' || metadata.detailEncoding !== 'rgba8unorm' || metadata.material?.roughness !== 0.9 || metadata.material?.wetDarken !== 0.58 || ! validPalette( metadata.material?.paletteLinear ) || ! validPalette( metadata.material?.meadowLinear ) ) throw new Error( 'Unsupported terrain surface data protocol, renderer profile, or material parameters' );
	const { size, origin, resolution, detailWidth, detailHeight } = metadata;
	if ( ! Number.isFinite( size ) || size <= 0 || size > 100000 || ! Number.isFinite( origin ) || Math.abs( origin ) > 100000 || ! Number.isInteger( resolution ) || resolution < 2 || resolution > 4097 || ! Number.isInteger( detailWidth ) || detailWidth < 1 || detailWidth > 4096 || ! Number.isInteger( detailHeight ) || detailHeight < 1 || detailHeight > 4096 ) throw new Error( 'Terrain surface dimensions or bounds are invalid' );
	const count = resolution * resolution, detailCount = detailWidth * detailHeight;
	const heightLength = count * 4, mapLength = count * 4, detailLength = detailCount * 4;
	let offset = 12 + metadataBytes;
	offset += ( 4 - offset % 4 ) % 4;
	if ( offset + heightLength + mapLength * 2 + detailLength !== raw.length ) throw new Error( 'Terrain surface payload dimensions do not match its byte length' );
	const heights = new Float32Array( count );
	const heightView = new DataView( raw.buffer, raw.byteOffset + offset, heightLength );
	for ( let i = 0; i < count; i ++ ) heights[ i ] = heightView.getFloat32( i * 4, true );
	offset += heightLength;
	const normal = new Uint8Array( raw.buffer, raw.byteOffset + offset, mapLength ); offset += mapLength;
	const splat = new Uint8Array( raw.buffer, raw.byteOffset + offset, mapLength ); offset += mapLength;
	const detail = new Uint8Array( raw.buffer, raw.byteOffset + offset, detailLength );
	for ( let i = 0; i < heights.length; i ++ ) if ( ! Number.isFinite( heights[ i ] ) ) throw new Error( 'Terrain surface contains a non-finite height' );
	return { size, origin, resolution, heights, normal, splat, detailWidth, detailHeight, detail, metadata };

}

function matches( bytes, signature, offset ) {
	if ( bytes.length < offset + signature.length ) return false;
	for ( let i = 0; i < signature.length; i ++ ) if ( bytes[ offset + i ] !== signature[ i ] ) return false;
	return true;
}

function validPalette( colors ) {
	return colors && typeof colors === 'object' && Object.values( colors ).length > 0 && Object.values( colors ).every( ( color ) => Array.isArray( color ) && color.length === 3 && color.every( ( channel ) => Number.isFinite( channel ) && channel >= 0 && channel <= 1 ) );
}
