const WATER_COMPONENTS = new Set( [ 'tidewater.island-ocean/1', 'tidewater.water-body/1' ] );

// Components whose hosted WebGL implementation is ready before asset-specific loaders run.
// Terrain-dependent wildlife is presented by the shared simulation and needs a decoded surface.
export function initialHostedWebGLSupport( components, { terrainReady = false } = {} ) {
	const supported = new Set( components.filter( component => WATER_COMPONENTS.has( component.type ) ).map( component => component.id ) );
	if ( terrainReady ) {
		for ( const component of components ) {
			if ( component.type === 'tidewater.terrain-surface/1' || component.type === 'tidewater.example-island-wildlife/1' ) supported.add( component.id );
		}
	}
	return supported;
}

export function unsupportedHostedWebGLComponents( components, supportedIds ) {
	return components.filter( component => ! supportedIds.has( component.id ) ).map( component => component.type );
}
