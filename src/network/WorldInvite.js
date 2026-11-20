const ROUTE_KEYS = Object.freeze( [ 'worldId', 'ztNodeId', 'ztGateway', 'ztNodeRecord', 'nodeId', 'gateway', 'directory' ] );
const ROUTE_KEY_SET = new Set( ROUTE_KEYS );
const MAX_ROUTE_PAYLOAD_CHARS = 3072;
const MAX_ROUTE_CODE_CHARS = 4096;
export const WORLD_INVITE_TICKET_BYTES = 10;
export const WORLD_INVITE_TICKET_CODE_CHARS = 14;

function encodeBase64URL( value ) {
	const bytes = new TextEncoder().encode( value );
	let binary = '';
	for ( const byte of bytes ) binary += String.fromCharCode( byte );
	return globalThis.btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/g, '' );
}

function decodeBase64URL( value ) {
	if ( typeof value !== 'string' || value.length === 0 || value.length > MAX_ROUTE_CODE_CHARS || ! /^[A-Za-z0-9_-]+$/.test( value ) ) throw new Error( 'Invite route code is invalid or too long' );
	const base64 = value.replace( /-/g, '+' ).replace( /_/g, '/' );
	const binary = globalThis.atob( base64 + '='.repeat( ( 4 - base64.length % 4 ) % 4 ) );
	const bytes = Uint8Array.from( binary, character => character.charCodeAt( 0 ) );
	const decoded = new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes );
	if ( encodeBase64URL( decoded ) !== value ) throw new Error( 'Invite route code is not canonical base64url' );
	return decoded;
}

function encodeBase64URLBytes( bytes ) {
	let binary = '';
	for ( const byte of bytes ) binary += String.fromCharCode( byte );
	return globalThis.btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/g, '' );
}

function decodeBase64URLBytes( value, expectedLength ) {
	if ( typeof value !== 'string' || ! /^[A-Za-z0-9_-]+$/.test( value ) ) throw new Error( 'Invite ticket is invalid' );
	const base64 = value.replace( /-/g, '+' ).replace( /_/g, '/' );
	let binary;
	try { binary = globalThis.atob( base64 + '='.repeat( ( 4 - base64.length % 4 ) % 4 ) ); }
	catch { throw new Error( 'Invite ticket is invalid' ); }
	const bytes = Uint8Array.from( binary, character => character.charCodeAt( 0 ) );
	if ( bytes.length !== expectedLength || encodeBase64URLBytes( bytes ) !== value ) throw new Error( 'Invite ticket has an invalid length or encoding' );
	return bytes;
}

export function isWorldInviteTicketCode( value ) {
	return typeof value === 'string' && value.length === WORLD_INVITE_TICKET_CODE_CHARS && /^[A-Za-z0-9_-]+$/.test( value );
}

export function encodeWorldInviteTicket( { zeroTierNodeId, playerNumber, hash } = {} ) {
	if ( ! /^[0-9a-f]{10}$/i.test( zeroTierNodeId || '' ) || ! Number.isInteger( playerNumber ) || playerNumber < 0 || playerNumber > 0xffff || ! /^[0-9a-f]{6}$/i.test( hash || '' ) ) throw new Error( 'Invite ticket fields are invalid' );
	const bytes = new Uint8Array( WORLD_INVITE_TICKET_BYTES );
	for ( let index = 0; index < 5; index ++ ) bytes[ index ] = Number.parseInt( zeroTierNodeId.slice( index * 2, index * 2 + 2 ), 16 );
	const view = new DataView( bytes.buffer );
	view.setUint16( 5, playerNumber, false );
	for ( let index = 0; index < 3; index ++ ) bytes[ 7 + index ] = Number.parseInt( hash.slice( index * 2, index * 2 + 2 ), 16 );
	return encodeBase64URLBytes( bytes );
}

export function decodeWorldInviteTicket( code ) {
	if ( ! isWorldInviteTicketCode( code ) ) throw new Error( 'Invite ticket has an invalid length' );
	const bytes = decodeBase64URLBytes( code, WORLD_INVITE_TICKET_BYTES );
	const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
	return {
		zeroTierNodeId: Array.from( bytes.subarray( 0, 5 ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' ),
		playerNumber: view.getUint16( 5, false ),
		hash: Array.from( bytes.subarray( 7 ), byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' ),
	};
}

export function encodeWorldInviteRoute( params ) {
	const route = params instanceof URLSearchParams ? params : new URLSearchParams( params );
	for ( const key of route.keys() ) if ( ! ROUTE_KEY_SET.has( key ) ) throw new Error( `Invite route contains unsupported field: ${key}` );
	if ( route.toString().length > MAX_ROUTE_PAYLOAD_CHARS ) throw new Error( 'Invite route data is too large' );
	return encodeBase64URL( route.toString() );
}

export function decodeWorldInviteRoute( code ) {
	const route = new URLSearchParams( decodeBase64URL( code ) );
	for ( const key of route.keys() ) if ( ! ROUTE_KEY_SET.has( key ) ) throw new Error( `Invite route contains unsupported field: ${key}` );
	for ( const key of [ 'worldId', 'ztNodeId', 'ztGateway', 'ztNodeRecord', 'directory' ] ) {
		if ( route.getAll( key ).length > 1 ) throw new Error( `Invite route contains duplicate ${key}` );
	}
	const nodeIds = route.getAll( 'nodeId' );
	const gateways = route.getAll( 'gateway' );
	if ( nodeIds.length !== gateways.length && ! ( nodeIds.length === 0 && gateways.length === 1 ) ) throw new Error( 'Invite provider IDs and gateways must be paired' );
	if ( ! route.has( 'worldId' ) && ! route.has( 'ztNodeId' ) ) throw new Error( 'Invite route does not identify a world or ZeroTier node' );
	if ( route.has( 'ztGateway' ) !== route.has( 'ztNodeRecord' ) || route.has( 'ztGateway' ) && ! route.has( 'ztNodeId' ) ) throw new Error( 'A direct ZeroTier gateway requires its HostID and signed node record' );
	return route;
}

export const WORLD_INVITE_ROUTE_KEYS = ROUTE_KEYS;
