import { REEF_TYPE_NAMES, REEF_TYPE_VARIANT_COUNTS } from './ReefPlacementTypes.js';

// TRP1 is the fixed-width portable record format for signed static-reef placements.
// Type IDs follow REEF_TYPE_NAMES: never reorder or reuse an existing ID; append
// new names and introduce a new protocol/feature version for incompatible changes.
export const REEF_PLACEMENT_PROTOCOL = 'elsemesh.reef-placement/1';
export const REEF_PLACEMENT_HEADER_BYTES = 16;
export const REEF_PLACEMENT_RECORD_BYTES = 64;
export const MAX_REEF_PLACEMENTS = 200000;

const MAGIC = [ 0x54, 0x52, 0x50, 0x31 ]; // TRP1
const HEADER_BYTES = REEF_PLACEMENT_HEADER_BYTES;
const TYPE_IDS = new Map( REEF_TYPE_NAMES.map( ( name, index ) => [ name, index ] ) );

export function encodeReefPlacements( records, seed ) {
	validateSeed( seed );
	validateRecords( records );
	const bytes = new Uint8Array( HEADER_BYTES + records.length * REEF_PLACEMENT_RECORD_BYTES );
	const view = new DataView( bytes.buffer );
	bytes.set( MAGIC, 0 );
	view.setUint32( 4, seed, true );
	view.setUint32( 8, records.length, true );
	view.setUint16( 12, REEF_TYPE_NAMES.length, true );
	view.setUint16( 14, REEF_PLACEMENT_RECORD_BYTES, true );
	let offset = HEADER_BYTES;
	for ( const record of records ) {
		view.setUint16( offset, TYPE_IDS.get( record.type ), true ); offset += 2;
		view.setUint8( offset ++, record.variant );
		view.setUint8( offset ++, 0 ); // reserved flags
		for ( const field of [ 'x', 'y', 'z', 's', 'sx', 'sy', 'sz' ] ) { view.setFloat32( offset, record[ field ], true ); offset += 4; }
		for ( const value of record.q ) { view.setFloat32( offset, value, true ); offset += 4; }
		view.setUint32( offset, record.c1, true ); offset += 4;
		view.setUint32( offset, record.c2, true ); offset += 4;
		view.setFloat32( offset, record.seed, true ); offset += 4;
		view.setFloat32( offset, record.flex, true ); offset += 4;
	}
	return bytes;
}

export function decodeReefPlacements( bytes ) {
	if ( ! ( bytes instanceof Uint8Array ) || bytes.byteLength < HEADER_BYTES || MAGIC.some( ( value, index ) => bytes[ index ] !== value ) ) throw new Error( 'Invalid reef placement asset header' );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	const seed = view.getUint32( 4, true );
	const count = view.getUint32( 8, true );
	const typeCount = view.getUint16( 12, true );
	const recordBytes = view.getUint16( 14, true );
	if ( typeCount !== REEF_TYPE_NAMES.length || recordBytes !== REEF_PLACEMENT_RECORD_BYTES || count > MAX_REEF_PLACEMENTS || bytes.byteLength !== HEADER_BYTES + count * recordBytes ) throw new Error( 'Unsupported reef placement version, length, or record count' );
	const records = [];
	let offset = HEADER_BYTES;
	for ( let index = 0; index < count; index ++ ) {
		const typeID = view.getUint16( offset, true ); offset += 2;
		const variant = view.getUint8( offset ++ );
		const flags = view.getUint8( offset ++ );
		if ( typeID >= REEF_TYPE_NAMES.length || flags !== 0 ) throw new Error( 'Reef placement contains an unknown type or flags' );
		const record = { type: REEF_TYPE_NAMES[ typeID ], variant };
		for ( const field of [ 'x', 'y', 'z', 's', 'sx', 'sy', 'sz' ] ) { record[ field ] = view.getFloat32( offset, true ); offset += 4; }
		record.q = [];
		for ( let component = 0; component < 4; component ++ ) { record.q.push( view.getFloat32( offset, true ) ); offset += 4; }
		record.c1 = view.getUint32( offset, true ); offset += 4;
		record.c2 = view.getUint32( offset, true ); offset += 4;
		record.seed = view.getFloat32( offset, true ); offset += 4;
		record.flex = view.getFloat32( offset, true ); offset += 4;
		records.push( record );
	}
	validateRecords( records );
	return { seed, records };
}

export function validateReefPlacements( records ) {
	validateRecords( records );
	return records;
}

function validateSeed( seed ) {
	if ( ! Number.isInteger( seed ) || seed < 0 || seed > 0xffffffff ) throw new Error( 'Invalid reef placement seed' );
}

function validateRecords( records ) {
	if ( ! Array.isArray( records ) || records.length > MAX_REEF_PLACEMENTS ) throw new Error( 'Invalid reef placement records or record count' );
	for ( const record of records ) {
		if ( ! record || typeof record !== 'object' || Array.isArray( record ) || Object.keys( record ).some( ( key ) => ! [ 'type', 'variant', 'x', 'y', 'z', 's', 'sx', 'sy', 'sz', 'q', 'c1', 'c2', 'seed', 'flex' ].includes( key ) ) ) throw new Error( 'Invalid reef placement record' );
		if ( ! TYPE_IDS.has( record.type ) || ! Number.isInteger( record.variant ) || record.variant < 0 || record.variant >= REEF_TYPE_VARIANT_COUNTS[ record.type ] ) throw new Error( 'Reef placement has an unknown type or variant' );
		for ( const field of [ 'x', 'y', 'z' ] ) if ( ! Number.isFinite( record[ field ] ) || Math.abs( record[ field ] ) > 10000 ) throw new Error( `Invalid reef placement ${field}` );
		for ( const field of [ 's', 'sx', 'sy', 'sz' ] ) if ( ! Number.isFinite( record[ field ] ) || record[ field ] <= 0 || record[ field ] > 100 ) throw new Error( `Invalid reef placement ${field}` );
		if ( ! Array.isArray( record.q ) || record.q.length !== 4 || ! record.q.every( ( value ) => Number.isFinite( value ) && Math.abs( value ) <= 1.001 ) || Math.abs( record.q.reduce( ( sum, value ) => sum + value * value, 0 ) - 1 ) > 0.002 ) throw new Error( 'Invalid reef placement quaternion' );
		for ( const field of [ 'c1', 'c2' ] ) if ( ! Number.isInteger( record[ field ] ) || record[ field ] < 0 || record[ field ] > 0xffffff ) throw new Error( `Invalid reef placement ${field}` );
		if ( ! Number.isFinite( record.seed ) || record.seed < 0 || record.seed > 1 || ! Number.isFinite( record.flex ) || Math.abs( record.flex ) > 2 ) throw new Error( 'Invalid reef placement seed or flex' );
	}
}
