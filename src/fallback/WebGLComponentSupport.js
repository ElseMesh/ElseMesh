const WATER_COMPONENTS = new Set( [ 'elsemesh.island-ocean/1', 'elsemesh.water-body/1' ] );

// Return the solid, authored boxes in either supported manifest collision shape.
// Compound records carry solidity and walkability on each box, not on the parent.
export function hostedCollisionBoxes( collision ) {
	if ( ! collision?.enabled || ! [ 'box', 'compound' ].includes( collision.shape ) ) return [];
	const boxes = collision.shape === 'box'
		? [ { center: collision.center, halfExtents: collision.halfExtents, yaw: 0, walkable: collision.walkable, solid: collision.solid } ]
		: collision.boxes;
	return Array.isArray( boxes ) ? boxes.filter( box => box?.solid === true ) : [];
}

// Components whose hosted WebGL implementation is ready before asset-specific loaders run.
// Terrain-dependent wildlife is presented by the shared simulation and needs a decoded surface.
export function initialHostedWebGLSupport( components, { terrainReady = false, boatReady = false } = {} ) {
	const supported = new Set( components.filter( component => WATER_COMPONENTS.has( component.type ) ).map( component => component.id ) );
	if ( terrainReady ) {
		for ( const component of components ) {
			if ( component.type === 'elsemesh.example-island-wildlife/1' ) supported.add( component.id );
		}
	}
	if ( boatReady ) {
		for ( const component of components ) if ( component.type === 'elsemesh.downeast-boat/1' ) supported.add( component.id );
	}
	return supported;
}

export function unsupportedHostedWebGLComponents( components, supportedIds ) {
	return components.filter( component => ! supportedIds.has( component.id ) ).map( component => component.type );
}

export function resolveHostedWebGLBoatSpec( components, objects, objectRoots ) {
	const component = components.find( candidate => candidate.type === 'elsemesh.downeast-boat/1' );
	if ( ! component ) return null;
	const berth = objects.find( object => object.id === component.objectId );
	const preview = objectRoots?.get( berth?.id );
	return berth && preview ? { component, berth, preview } : null;
}
