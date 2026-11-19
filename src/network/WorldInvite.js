const ROUTE_KEYS = Object.freeze( [ 'worldId', 'ztNodeId', 'ztNetworkId', 'ztGateway', 'ztNodeRecord', 'nodeId', 'gateway', 'directory' ] );
const ROUTE_KEY_SET = new Set( ROUTE_KEYS );
const MAX_ROUTE_PAYLOAD_CHARS = 3072;
const MAX_ROUTE_CODE_CHARS = 4096;

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

export function encodeWorldInviteRoute( params ) {
	const route = params instanceof URLSearchParams ? params : new URLSearchParams( params );
	for ( const key of route.keys() ) if ( ! ROUTE_KEY_SET.has( key ) ) throw new Error( `Invite route contains unsupported field: ${key}` );
	if ( route.toString().length > MAX_ROUTE_PAYLOAD_CHARS ) throw new Error( 'Invite route data is too large' );
	return encodeBase64URL( route.toString() );
}

export function decodeWorldInviteRoute( code ) {
	const route = new URLSearchParams( decodeBase64URL( code ) );
	for ( const key of route.keys() ) if ( ! ROUTE_KEY_SET.has( key ) ) throw new Error( `Invite route contains unsupported field: ${key}` );
	for ( const key of [ 'worldId', 'ztNodeId', 'ztNetworkId', 'ztGateway', 'ztNodeRecord', 'directory' ] ) {
		if ( route.getAll( key ).length > 1 ) throw new Error( `Invite route contains duplicate ${key}` );
	}
	const nodeIds = route.getAll( 'nodeId' );
	const gateways = route.getAll( 'gateway' );
	if ( nodeIds.length !== gateways.length && ! ( nodeIds.length === 0 && gateways.length === 1 ) ) throw new Error( 'Invite provider IDs and gateways must be paired' );
	if ( ! route.has( 'worldId' ) && ! route.has( 'ztNodeId' ) ) throw new Error( 'Invite route does not identify a world or ZeroTier node' );
	return route;
}

export const WORLD_INVITE_ROUTE_KEYS = ROUTE_KEYS;
