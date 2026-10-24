// Invitation arrivals use a grid no coarser than the player's capsule diameter.
// The ordered candidates let the owner gateway choose atomically around visitors.
export const WORLD_SPAWN_CANDIDATE_LIMIT = 1024;
export const WORLD_SPAWN_GRID_STEP = 0.6;
const PLAYER_RADIUS = 0.3;
const PLAYER_HEIGHT = 1.75;
const EYE_HEIGHT = 1.62;

export function worldSpawnCandidates( spawn, radius, colliders, { limit = WORLD_SPAWN_CANDIDATE_LIMIT } = {} ) {
	if ( ! spawn || ! Array.isArray( spawn.position ) || spawn.position.length !== 3 || ! spawn.position.every( Number.isFinite ) || ! Number.isFinite( radius ) || radius < 0 || ! Number.isInteger( limit ) || limit < 1 || limit > WORLD_SPAWN_CANDIDATE_LIMIT || ! colliders?.groundHeightAt || ! colliders?.resolveCapsule ) throw new Error( 'Invalid world spawn search' );
	const [ eyeX, eyeY, eyeZ ] = spawn.position;
	const start = { x: eyeX, y: eyeY - EYE_HEIGHT, z: eyeZ };
	const ringLimit = Math.ceil( radius / WORLD_SPAWN_GRID_STEP );
	const candidates = [];
	for ( let ring = 0; ring <= ringLimit; ring ++ ) {
		const offsets = [];
		for ( let ix = - ring; ix <= ring; ix ++ ) for ( let iz = - ring; iz <= ring; iz ++ ) {
			if ( Math.max( Math.abs( ix ), Math.abs( iz ) ) !== ring ) continue;
			const dx = ix * WORLD_SPAWN_GRID_STEP, dz = iz * WORLD_SPAWN_GRID_STEP;
			if ( dx * dx + dz * dz <= radius * radius + 1e-9 ) offsets.push( { dx, dz, distanceSq: dx * dx + dz * dz } );
		}
		offsets.sort( ( a, b ) => a.distanceSq - b.distanceSq || a.dx - b.dx || a.dz - b.dz );
		for ( const offset of offsets ) {
			const position = { x: start.x + offset.dx, y: start.y, z: start.z + offset.dz };
			const ground = colliders.groundHeightAt( position.x, position.z, eyeY + 0.5 );
			if ( Number.isFinite( ground ) && position.y < ground ) position.y = ground;
			const distanceSq = ( position.x - start.x ) ** 2 + ( position.z - start.z ) ** 2;
			if ( distanceSq > radius * radius + 1e-9 ) continue;
			if ( colliders.resolveCapsule( { ...position }, PLAYER_RADIUS, PLAYER_HEIGHT, 0.001 ) ) continue;
			candidates.push( { position: [ position.x, position.y, position.z ], distanceSq } );
		}
		const farthestDistanceSq = candidates.reduce( ( farthest, candidate ) => Math.max( farthest, candidate.distanceSq ), 0 );
		if ( candidates.length >= limit && ( ring + 1 ) * WORLD_SPAWN_GRID_STEP > Math.sqrt( farthestDistanceSq ) + 1e-9 ) break;
	}
	candidates.sort( ( a, b ) => a.distanceSq - b.distanceSq || a.position[ 0 ] - b.position[ 0 ] || a.position[ 2 ] - b.position[ 2 ] );
	return candidates.slice( 0, limit ).map( ( candidate ) => candidate.position );
}

export function worldSpawnCollisionObjectIDs( manifest, spawn, radius ) {
	if ( ! Array.isArray( manifest?.objects ) || ! spawn?.position || spawn.position.length !== 3 || ! spawn.position.every( Number.isFinite ) || ! Number.isFinite( radius ) || radius < 0 ) throw new Error( 'Invalid world spawn collision query' );
	const selected = new Set();
	for ( const object of manifest.objects ) {
		const collision = object.collision;
		if ( ! collision?.enabled ) continue;
		if ( collision.shape === 'heightfield' ) { selected.add( object.id ); continue; }
		const scale = object.scale || [ 1, 1, 1 ];
		const position = object.transform.position;
		const yaw = object.transform.yaw || 0;
		const centerFor = ( center ) => {
			const x = center[ 0 ] * scale[ 0 ], y = center[ 1 ] * scale[ 1 ], z = center[ 2 ] * scale[ 2 ];
			return [ position[ 0 ] + x * Math.cos( yaw ) + z * Math.sin( yaw ), position[ 1 ] + y, position[ 2 ] - x * Math.sin( yaw ) + z * Math.cos( yaw ) ];
		};
		let nearestCenter = Infinity;
		let objectRadius = 0;
		if ( collision.shape === 'box' ) {
			const center = centerFor( collision.center );
			nearestCenter = Math.hypot( center[ 0 ] - spawn.position[ 0 ], center[ 2 ] - spawn.position[ 2 ] );
			objectRadius = Math.hypot( collision.halfExtents[ 0 ] * scale[ 0 ], collision.halfExtents[ 2 ] * scale[ 2 ] ) + PLAYER_RADIUS;
		} else if ( collision.shape === 'compound' ) {
			for ( const box of collision.boxes ) {
				const center = centerFor( box.center );
				nearestCenter = Math.min( nearestCenter, Math.hypot( center[ 0 ] - spawn.position[ 0 ], center[ 2 ] - spawn.position[ 2 ] ) );
				objectRadius = Math.max( objectRadius, Math.hypot( box.halfExtents[ 0 ] * scale[ 0 ], box.halfExtents[ 2 ] * scale[ 2 ] ) + PLAYER_RADIUS );
			}
		}
		if ( nearestCenter <= radius + objectRadius ) selected.add( object.id );
	}
	return selected;
}
