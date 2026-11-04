import { worldComponentDescriptor } from '../network/WorldComponentRegistry.js';
import { worldComponentBackendAdapter } from '../network/WorldComponentBackendRegistry.js';
import './WebGLWaterComponentAdapters.js';
import './WebGLStaticModelInstanceSetAdapter.js';

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
export function initialHostedWebGLSupport( components, { terrainReady = false, vehicleComponentId = null } = {} ) {
	const supported = new Set( components.filter( component => worldComponentDescriptor( component.type )?.waterSurface && worldComponentBackendAdapter( 'webgl', component.type ) ).map( component => component.id ) );
	if ( terrainReady ) for ( const component of components ) if ( worldComponentDescriptor( component.type )?.wildlifeSimulation ) supported.add( component.id );
	if ( vehicleComponentId && components.some( component => component.id === vehicleComponentId && worldComponentDescriptor( component.type )?.vehicle ) ) supported.add( vehicleComponentId );
	return supported;
}

export function unsupportedHostedWebGLComponents( components, supportedIds ) {
	return components.filter( component => ! supportedIds.has( component.id ) ).map( component => component.type );
}

export function resolveHostedWebGLVehicleSpec( components, objects, objectRoots ) {
	const component = components.find( candidate => worldComponentDescriptor( candidate.type )?.vehicle );
	if ( ! component ) return null;
	const object = objects.find( candidate => candidate.id === component.objectId );
	const preview = objectRoots?.get( object?.id );
	return object && preview ? { component, object, preview } : null;
}
