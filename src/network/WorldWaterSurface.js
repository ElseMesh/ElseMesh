// Choose the active world's water surface for gameplay queries. Water rendering
// components expose their surface through this small engine-owned runtime hook.
export function worldWaterSurfaceFor( components, position, fallback ) {
	const surfaces = ( components || [] ).filter( component => component?.surface );
	if ( position ) {
		const containingBody = surfaces.find( component => component.waterBounds &&
			Math.abs( position[ 0 ] - component.waterBounds.center[ 0 ] ) <= component.waterBounds.extent &&
			Math.abs( position[ 2 ] - component.waterBounds.center[ 1 ] ) <= component.waterBounds.extent );
		if ( containingBody ) return containingBody.surface;
	}
	return surfaces.find( component => component.isWorldOcean )?.surface || surfaces[ 0 ]?.surface || fallback;
}
