import { SPECIES } from '../world/fish/FishSpecies.js';

export const FISH_PROP_PLACEMENT_PROTOCOL = 'elsemesh.fish-props-placement/1';
export const MAX_FISH_PROP_PLACEMENTS = 20000;
export const MAX_FISH_PROP_PLACEMENT_BYTES = 16 * 1024 * 1024;

const KINDS = new Set( [ 'whole', 'split', 'head', 'trunk', 'ice', 'leaf', 'lobster' ] );
const FIELDS = [ 'kind', 'species', 'L', 'x', 'y', 'z', 'q', 'pattern', 'seed', 'curl', 'sag', 'jaw', 'flags' ];

export function encodeFishPropPlacements( records ) {
	validateFishPropPlacements( records );
	const document = {
		format: FISH_PROP_PLACEMENT_PROTOCOL,
		records: records.map( ( record ) => Object.fromEntries( FIELDS.map( ( field ) => [ field, record[ field ] ] ) ) ),
	};
	const bytes = new TextEncoder().encode( JSON.stringify( document ) );
	if ( bytes.byteLength > MAX_FISH_PROP_PLACEMENT_BYTES ) throw new Error( 'Fish-prop placement asset exceeds the 16 MiB limit' );
	return bytes;
}

export function decodeFishPropPlacements( bytes ) {
	if ( ! ( bytes instanceof Uint8Array ) || bytes.byteLength < 2 || bytes.byteLength > MAX_FISH_PROP_PLACEMENT_BYTES ) throw new Error( 'Invalid fish-prop placement asset size' );
	let document;
	try { document = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes ) ); }
	catch { throw new Error( 'Invalid fish-prop placement asset JSON' ); }
	if ( ! document || typeof document !== 'object' || Array.isArray( document ) || Object.keys( document ).length !== 2 || document.format !== FISH_PROP_PLACEMENT_PROTOCOL || ! Array.isArray( document.records ) ) throw new Error( 'Unsupported fish-prop placement asset format' );
	validateFishPropPlacements( document.records );
	return document.records;
}

export function validateFishPropPlacements( records ) {
	if ( ! Array.isArray( records ) || records.length > MAX_FISH_PROP_PLACEMENTS ) throw new Error( 'Invalid fish-prop placement records or record count' );
	for ( const record of records ) {
		if ( ! record || typeof record !== 'object' || Array.isArray( record ) || Object.keys( record ).length !== FIELDS.length || Object.keys( record ).some( ( key ) => ! FIELDS.includes( key ) ) ) throw new Error( 'Invalid fish-prop placement record fields' );
		if ( ! KINDS.has( record.kind ) || ( record.species !== null && ( typeof record.species !== 'string' || ! Object.hasOwn( SPECIES, record.species ) ) ) || ! Number.isFinite( record.L ) || record.L <= 0 || record.L > 100 ) throw new Error( 'Invalid fish-prop kind, species, or length' );
		if ( [ 'ice', 'leaf', 'lobster' ].includes( record.kind ) !== ( record.species === null ) ) throw new Error( 'Fish-prop kind and species do not match' );
		for ( const field of [ 'x', 'y', 'z' ] ) if ( ! Number.isFinite( record[ field ] ) || Math.abs( record[ field ] ) > 10000 ) throw new Error( `Invalid fish-prop ${field}` );
		if ( ! Array.isArray( record.q ) || record.q.length !== 4 || ! record.q.every( ( value ) => Number.isFinite( value ) && Math.abs( value ) <= 1.001 ) || Math.abs( record.q.reduce( ( sum, value ) => sum + value * value, 0 ) - 1 ) > 0.002 ) throw new Error( 'Invalid fish-prop quaternion' );
		if ( ! Number.isInteger( record.pattern ) || record.pattern !== ( record.species ? SPECIES[ record.species ].pattern : 0 ) || ! Number.isFinite( record.seed ) || record.seed < 0 || record.seed > 100 ) throw new Error( 'Invalid fish-prop pattern or seed' );
		for ( const field of [ 'curl', 'sag', 'jaw' ] ) if ( ! Number.isFinite( record[ field ] ) || Math.abs( record[ field ] ) > 2 ) throw new Error( `Invalid fish-prop ${field}` );
		if ( ! Array.isArray( record.flags ) || record.flags.length !== 4 || ! record.flags.every( ( value ) => Number.isFinite( value ) && value >= 0 && value <= 1 ) ) throw new Error( 'Invalid fish-prop flags' );
	}
	return records;
}
