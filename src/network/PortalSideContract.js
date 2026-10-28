import { isWorldID } from './WorldIdentity.js';

// The rear shares the doorway geometry; its approach orientation is entry.yaw + PI.
export function validatePortalBack( back, validGateway ) {
	if ( ! back || typeof back !== 'object' || Array.isArray( back ) || Object.keys( back ).some( ( key ) => ! [ 'destinationWorldId', 'destinationPeerId', 'destinationGateway', 'exit', 'openView', 'enabled' ].includes( key ) ) ) throw new Error( 'Invalid portal back side fields' );
	if ( ! isWorldID( back.destinationWorldId ) || back.destinationPeerId !== undefined && ( typeof back.destinationPeerId !== 'string' || ! /^[A-Za-z0-9]{20,256}$/.test( back.destinationPeerId ) ) || back.destinationGateway !== undefined && ! validGateway( back.destinationGateway ) ) throw new Error( 'Invalid portal back destination' );
	const exit = back.exit;
	if ( ! exit || Object.keys( exit ).some( ( key ) => ! [ 'position', 'yaw' ].includes( key ) ) || ! Array.isArray( exit.position ) || exit.position.length !== 3 || ! exit.position.every( ( n ) => Number.isFinite( n ) && Math.abs( n ) <= 1e6 ) || ! Number.isFinite( exit.yaw ) || Math.abs( exit.yaw ) > 360 || exit.rotation !== undefined || typeof back.openView !== 'boolean' || typeof back.enabled !== 'boolean' ) throw new Error( 'Invalid portal back transform or flags' );
	return back;
}
