import { PLAYER_EYE_HEIGHT } from '../player/PlayerDimensions.js';
import { worldSpawnCollisionObjectIDs } from './WorldSpawn.js';
import { selectWorldObjectsForConnectorView } from './WorldStreaming.js';

export function selectLocalRegionStartupObjects( connector, manifest, camera, spawn ) {
	const visibleObjects = selectWorldObjectsForConnectorView( connector, manifest, camera, {
		nearbyDistance: 0,
		maxDistance: connector.maxViewDistanceMeters,
		maxPriority: 'background',
	} );
	const selectedIDs = new Set( visibleObjects.filter( object => ! object.collisionPayload ).map( object => object.id ) );
	const spawnFoot = {
		x: spawn.position[ 0 ],
		y: spawn.position[ 1 ] - PLAYER_EYE_HEIGHT,
		z: spawn.position[ 2 ],
	};
	for ( const objectID of connector.collisionObjectIDsAlongPath( spawnFoot, spawnFoot ) ) selectedIDs.add( objectID );
	for ( const objectID of worldSpawnCollisionObjectIDs( manifest, spawn, manifest.rules.spawnRadius ) ) selectedIDs.add( objectID );
	return ( manifest.objects || [] ).filter( object => selectedIDs.has( object.id ) );
}

export function selectLocalRegionEntryObjects( connector, manifest, startupObjects, camera ) {
	const visibleObjects = selectWorldObjectsForConnectorView( connector, manifest, camera, {
		nearbyDistance: 0,
		maxDistance: connector.maxViewDistanceMeters,
		maxPriority: 'background',
	} );
	const visibleVisualIDs = new Set( visibleObjects.filter( object => ! object.collisionPayload ).map( object => object.id ) );

	return startupObjects.filter( object => ! object.regionCell || object.collisionPayload || visibleVisualIDs.has( object.id ) );
}

export function selectLocalRegionStreamingObjects( connector, manifest, camera ) {
	const visibleObjects = selectWorldObjectsForConnectorView( connector, manifest, camera, {
		maxDistance: connector.maxViewDistanceMeters,
	} );
	return visibleObjects.filter( object => ! object.collisionPayload );
}
