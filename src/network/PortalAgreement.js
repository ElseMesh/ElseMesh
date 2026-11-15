import { portalScaleRatio } from './PortalScale.js';

export function validatePortalAgreementReference( route ) {
	const hasID = route.destinationPortalId !== undefined;
	const hasSide = route.destinationPortalSide !== undefined;
	if ( hasID !== hasSide || hasID && ( typeof route.destinationPortalId !== 'string' || ! /^elsemesh-portal:[\w.-]{1,128}$/.test( route.destinationPortalId ) || ! [ 'front', 'back' ].includes( route.destinationPortalSide ) ) ) throw new Error( 'Invalid portal agreement reference' );
	return route;
}

export function validatePortalRouteContract( route ) {
	validatePortalAgreementReference( route );
	portalScaleRatio( route.scaleRatio );
	return route;
}

// Both manifests are owner-signed. Requiring mutually named routes and
// reciprocal ratios makes scale a bilateral agreement, not a unilateral hint.
export function matchingPortalAgreement( sourceWorldId, route, destinationManifest ) {
	if ( ! route?.destinationPortalId || ! destinationManifest || ! Array.isArray( destinationManifest.portals ) ) return false;
	if ( destinationManifest.worldId !== route.destinationWorldId ) return false;
	const destinationPortal = destinationManifest.portals.find( portal => portal.id === route.destinationPortalId );
	if ( ! destinationPortal ) return false;
	const sourceSide = route.side === 'back' ? 'back' : 'front';
	const destinationSide = route.destinationPortalSide || 'front';
	const counterpart = destinationSide === 'back' ? destinationPortal.back : destinationPortal;
	if ( ! counterpart || counterpart.destinationWorldId !== sourceWorldId || counterpart.destinationPortalId !== route.id || ( counterpart.destinationPortalSide || 'front' ) !== sourceSide ) return false;
	const sourceRatio = route.scaleRatio ?? 1;
	const destinationRatio = counterpart.scaleRatio ?? 1;
	const product = sourceRatio * destinationRatio;
	return Number.isFinite( product ) && Math.abs( product - 1 ) <= Number.EPSILON * Math.max( 1, Math.abs( product ) );
}
