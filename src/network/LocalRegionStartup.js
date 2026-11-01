import { PLAYER_EYE_HEIGHT } from '../player/PlayerDimensions.js';
import { worldSpawnCollisionObjectIDs } from './WorldSpawn.js';
import { selectWorldObjectsForView, transformBoundsCenter } from './WorldStreaming.js';

const _boundsCenter = { set( x, y, z ) { this.x = x; this.y = y; this.z = z; return this; } };

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

export function selectLocalRegionEntryObjects( connector, startupObjects, camera ) {
	const explicitVisualIDs = connector.explicitStartupCellVisualObjectIDs || new Set();
	const entryRadius = connector.cellSizeMeters || 8;

	return startupObjects.filter( object => {
		if ( ! object.regionCell ) return true;
		if ( object.collisionPayload || explicitVisualIDs.has( object.id ) ) return true;

		const bounds = object.streamingBounds;
		if ( ! bounds || ! object.transform?.position ) return true;
		const scale = object.scale || [ 1, 1, 1 ];
		const radius = bounds.radius * Math.max( Math.abs( scale[ 0 ] ), Math.abs( scale[ 1 ] ), Math.abs( scale[ 2 ] ) );
		transformBoundsCenter( object, bounds.center, _boundsCenter );
		return Math.hypot( camera.position.x - _boundsCenter.x, camera.position.y - _boundsCenter.y, camera.position.z - _boundsCenter.z ) <= radius + entryRadius;
	} );
}
