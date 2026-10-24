export const VEGETATION_PLACEMENT_PROTOCOL = 'tidewater.vegetation-placement/1';
export const VEGETATION_PLACEMENT_KINDS = Object.freeze( [ 'palms', 'trees', 'bananas', 'shrubs', 'youngPalms', 'ferns', 'monsteras', 'elephantEars', 'heliconias', 'strelitzias' ] );

const MAGIC = [ 0x54, 0x56, 0x50, 0x31 ]; // TVP1
const HEADER_BYTES = 16 + VEGETATION_PLACEMENT_KINDS.length * 4;
const RECORD_BYTES = 1 + 10 * 4;
const FIELDS = [ 'x', 'y', 'z', 's', 'sy', 'yaw', 'la', 'l', 'H', 'seed' ];

export function encodeVegetationPlacements( records, seed ) {
	validateRecords( records, seed );
	const counts = VEGETATION_PLACEMENT_KINDS.map( ( kind ) => records[ kind ].length );
	const total = counts.reduce( ( sum, count ) => sum + count, 0 );
	const bytes = new Uint8Array( HEADER_BYTES + total * RECORD_BYTES );
	const view = new DataView( bytes.buffer );
	bytes.set( MAGIC, 0 );
	view.setUint32( 4, seed, true );
	view.setUint32( 8, records.villagePalms, true );
	view.setUint32( 12, VEGETATION_PLACEMENT_KINDS.length, true );
	let offset = 16;
	for ( const count of counts ) { view.setUint32( offset, count, true ); offset += 4; }
	for ( const kind of VEGETATION_PLACEMENT_KINDS ) for ( const record of records[ kind ] ) {
		view.setUint8( offset, record.sy === undefined ? 0 : 1 ); offset ++;
		for ( const field of FIELDS ) { view.setFloat32( offset, record[ field ] ?? 0, true ); offset += 4; }
	}
	return bytes;
}

export function decodeVegetationPlacements( bytes, expectedSeed ) {
	if ( ! ( bytes instanceof Uint8Array ) || bytes.byteLength < HEADER_BYTES || MAGIC.some( ( value, index ) => bytes[ index ] !== value ) ) throw new Error( 'Invalid vegetation placement asset header' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const seed = view.getUint32( 4, true ), villagePalms = view.getUint32( 8, true ), kindCount = view.getUint32( 12, true );
	if ( ( expectedSeed !== undefined && seed !== expectedSeed ) || kindCount !== VEGETATION_PLACEMENT_KINDS.length || villagePalms > 10 ) throw new Error( 'Unsupported vegetation placement asset version or seed' );
	const counts = [];
	let total = 0, offset = 16;
	for ( let index = 0; index < kindCount; index ++ ) { const count = view.getUint32( offset, true ); offset += 4; if ( count > 100000 ) throw new Error( 'Vegetation placement asset exceeds the per-kind limit' ); counts.push( count ); total += count; }
	if ( total > 200000 || bytes.byteLength !== HEADER_BYTES + total * RECORD_BYTES ) throw new Error( 'Vegetation placement asset has invalid length or exceeds its record limit' );
	const records = { villagePalms };
	for ( let index = 0; index < kindCount; index ++ ) {
		const group = records[ VEGETATION_PLACEMENT_KINDS[ index ] ] = [];
		for ( let row = 0; row < counts[ index ]; row ++ ) {
			const flags = view.getUint8( offset ++ );
			if ( flags & ~1 ) throw new Error( 'Vegetation placement asset has unknown record flags' );
			const record = {};
			for ( const field of FIELDS ) { const value = view.getFloat32( offset, true ); offset += 4; if ( ! Number.isFinite( value ) ) throw new Error( 'Vegetation placement asset contains a non-finite value' ); if ( field !== 'sy' || flags & 1 ) record[ field ] = value; }
			group.push( record );
		}
	}
	validateRecords( records, seed );
	return records;
}

export function appendVegetationPlacements( target, source ) {
	for ( const kind of VEGETATION_PLACEMENT_KINDS ) {
		target[ kind ] = [ ...( target[ kind ] || [] ), ...source[ kind ] ];
	}
	return target;
}

function validateRecords( records, seed ) {
	if ( ! Number.isInteger( seed ) || seed < 0 || seed > 0xffffffff || ! records || typeof records !== 'object' || ! Number.isInteger( records.villagePalms ) || records.villagePalms < 0 || records.villagePalms > 10 ) throw new Error( 'Invalid vegetation placement data' );
	if ( Object.keys( records ).some( ( key ) => key !== 'villagePalms' && ! VEGETATION_PLACEMENT_KINDS.includes( key ) ) ) throw new Error( 'Vegetation placement data contains an unknown plant kind' );
	let total = 0;
	for ( const kind of VEGETATION_PLACEMENT_KINDS ) {
		const group = records[ kind ];
		if ( ! Array.isArray( group ) || group.length > 100000 ) throw new Error( `Invalid vegetation placements for ${kind}` );
		total += group.length;
		for ( const record of group ) {
			if ( ! record || typeof record !== 'object' || Array.isArray( record ) || Object.keys( record ).some( ( key ) => ! FIELDS.includes( key ) ) || FIELDS.filter( ( key ) => key !== 'sy' ).some( ( key ) => ! Number.isFinite( record[ key ] ) ) || record.sy !== undefined && ! Number.isFinite( record.sy ) || Math.abs( record.x ) > 10000 || Math.abs( record.y ) > 10000 || Math.abs( record.z ) > 10000 || record.s <= 0 || record.s > 100 || record.seed < 0 || record.seed > 1 ) throw new Error( `Invalid vegetation placement in ${kind}` );
		}
	}
	if ( total > 200000 ) throw new Error( 'Vegetation placement data exceeds its supported record limit' );
}
