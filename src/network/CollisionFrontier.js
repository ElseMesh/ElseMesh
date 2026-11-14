export function sweptCollisionCellKeys( from, to, { cellSizeMeters, radius = 0.3, height = 1.75 } = {} ) {
	if ( ! Number.isInteger( cellSizeMeters ) || cellSizeMeters < 1 || cellSizeMeters > 256 || ! Number.isFinite( radius ) || radius < 0 || ! Number.isFinite( height ) || height <= 0 ) throw new TypeError( 'Invalid collision frontier dimensions' );
	const start = vectorValues( from ), end = vectorValues( to );
	const distance = Math.hypot( end[ 0 ] - start[ 0 ], end[ 1 ] - start[ 1 ], end[ 2 ] - start[ 2 ] );
	const spacing = Math.min( cellSizeMeters / 4, Math.max( radius, 0.25 ) );
	const sampleCount = Math.max( 1, Math.ceil( distance / spacing ) );
	if ( sampleCount > 10000 ) throw new RangeError( 'Movement step exceeds collision frontier limits' );
	const cells = new Set();
	for ( let sample = 0; sample <= sampleCount; sample ++ ) {
		const t = sample / sampleCount;
		const x = start[ 0 ] + ( end[ 0 ] - start[ 0 ] ) * t;
		const y = start[ 1 ] + ( end[ 1 ] - start[ 1 ] ) * t;
		const z = start[ 2 ] + ( end[ 2 ] - start[ 2 ] ) * t;
		for ( let cellX = Math.floor( ( x - radius ) / cellSizeMeters ); cellX <= Math.floor( ( x + radius ) / cellSizeMeters ); cellX ++ ) {
			for ( let cellY = Math.floor( y / cellSizeMeters ); cellY <= Math.floor( ( y + height ) / cellSizeMeters ); cellY ++ ) {
				for ( let cellZ = Math.floor( ( z - radius ) / cellSizeMeters ); cellZ <= Math.floor( ( z + radius ) / cellSizeMeters ); cellZ ++ ) cells.add( `${cellX},${cellY},${cellZ}` );
			}
		}
	}
	return cells;
}

export function collisionPathStatus( { from, to, cellSizeMeters, radius = 0.3, height = 1.75, objectIDsByCell, loadedObjectIDs, unknownObjectIDs, unknownSourcesByCell, unknownSourcesCompleteByCell, missingKnownShapeObjectIDs, missingCollisionPayloadObjectIDs, knownCells, emptyCellsAreVerified = false } ) {
	if ( ! objectIDsByCell || ! loadedObjectIDs ) return { ready: false, reason: 'collision-index-unavailable' };
	const start = vectorValues( from ), end = vectorValues( to );
	const sweepBounds = [
		Math.min( start[ 0 ], end[ 0 ] ) - radius,
		Math.min( start[ 1 ], end[ 1 ] ),
		Math.min( start[ 2 ], end[ 2 ] ) - radius,
		Math.max( start[ 0 ], end[ 0 ] ) + radius,
		Math.max( start[ 1 ], end[ 1 ] ) + height,
		Math.max( start[ 2 ], end[ 2 ] ) + radius,
	];
	for ( const cellKey of sweptCollisionCellKeys( from, to, { cellSizeMeters, radius, height } ) ) {
		const objectIDs = objectIDsByCell.get( cellKey );
		if ( ! objectIDs?.size ) {
			if ( emptyCellsAreVerified && knownCells?.has( cellKey ) ) continue;
			return { ready: false, reason: 'cell-not-verified-empty', cellKey };
		}
		for ( const objectID of objectIDs ) {
			if ( missingCollisionPayloadObjectIDs?.has( objectID ) ) return { ready: false, reason: 'collision-payload-missing', cellKey, objectID };
			if ( missingKnownShapeObjectIDs?.has( objectID ) ) return { ready: false, reason: 'expected-collision-shape-missing', cellKey, objectID };
			if ( unknownObjectIDs?.has( objectID ) ) {
				if ( unknownSourcesCompleteByCell?.get( cellKey ) !== true ) return { ready: false, reason: 'unknown-collision-sources-incomplete', cellKey, objectID };
				for ( const source of unknownSourcesByCell?.get( cellKey ) || [] ) {
					const bounds = source.bounds;
					if ( bounds[ 0 ] <= sweepBounds[ 3 ] && bounds[ 3 ] >= sweepBounds[ 0 ]
						&& bounds[ 1 ] <= sweepBounds[ 4 ] && bounds[ 4 ] >= sweepBounds[ 1 ]
						&& bounds[ 2 ] <= sweepBounds[ 5 ] && bounds[ 5 ] >= sweepBounds[ 2 ] ) return { ready: false, reason: 'unknown-collision-source-overlaps-path', cellKey, objectID, source: { assetPath: source.assetPath ?? null, componentPath: source.componentPath ?? null, collisionType: source.collisionType ?? null, boundsSource: source.boundsSource ?? null, bounds: [ ...bounds ] } };
				}
			}
			if ( ! loadedObjectIDs.has( objectID ) ) return { ready: false, reason: 'collision-object-not-loaded', cellKey, objectID };
		}
	}
	return { ready: true, reason: null };
}

export function collisionPathReady( options ) {
	return collisionPathStatus( options ).ready;
}

export function collisionLookaheadDistance( speedMetersPerSecond, latencyMs, cellSizeMeters, maxDistance = 512 ) {
	if ( ! Number.isFinite( speedMetersPerSecond ) || speedMetersPerSecond < 0 || ! Number.isFinite( latencyMs ) || latencyMs < 0 || ! Number.isInteger( cellSizeMeters ) || cellSizeMeters < 1 || ! Number.isFinite( maxDistance ) || maxDistance < cellSizeMeters ) throw new TypeError( 'Invalid collision lookahead inputs' );
	return Math.min( maxDistance, speedMetersPerSecond * Math.max( 400, latencyMs ) / 1000 + cellSizeMeters * 2 );
}

function vectorValues( value ) {
	const result = Array.isArray( value ) ? value : [ value?.x, value?.y, value?.z ];
	if ( result.length !== 3 || ! result.every( Number.isFinite ) ) throw new TypeError( 'Collision frontier positions must contain three finite coordinates' );
	return result;
}
