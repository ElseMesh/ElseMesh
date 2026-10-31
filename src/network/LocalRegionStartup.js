import { PLAYER_EYE_HEIGHT } from '../player/PlayerDimensions.js';
import { worldSpawnCollisionObjectIDs } from './WorldSpawn.js';
import { selectWorldObjectsForView } from './WorldStreaming.js';

export function selectLocalRegionStartupObjects( connector, manifest, camera, spawn ) {
	const cellSize = connector.cellSizeMeters || 8;
	const selectedIDs = new Set( selectWorldObjectsForView( manifest, camera, {
		nearbyDistance: cellSize,
		maxDistance: connector.maxViewDistanceMeters,
		maxPriority: 'visible',
	} ).filter( object => ! object.collisionPayload ).map( object => object.id ) );
	for ( const objectID of connector.explicitStartupCellVisualObjectIDs || [] ) selectedIDs.add( objectID );
	const spawnFoot = {
		x: spawn.position[ 0 ],
		y: spawn.position[ 1 ] - PLAYER_EYE_HEIGHT,
		z: spawn.position[ 2 ],
	};
	for ( const objectID of connector.collisionObjectIDsAlongPath( spawnFoot, spawnFoot ) ) selectedIDs.add( objectID );
	for ( const objectID of worldSpawnCollisionObjectIDs( manifest, spawn, manifest.rules.spawnRadius ) ) selectedIDs.add( objectID );
	return ( manifest.objects || [] ).filter( object => selectedIDs.has( object.id ) );
}
