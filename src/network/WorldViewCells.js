import { Frustum, Matrix4, Sphere, Vector3 } from '../engine/index.js';

const MAX_VIEW_CELL_SCAN = 250_000;
const corner = new Vector3();
const worldDirection = new Vector3();
const viewProjection = new Matrix4();
const frustum = new Frustum();
const cellSphere = new Sphere();

/**
 * Return spatial cells intersecting the current camera frustum, ordered by
 * projected cell size. The radius is clipped by the world's declared view
 * distance; cell indexes remain provider-owned and are requested only for
 * these coordinates.
 */
export function worldViewCellCoordinates( camera, cellSizeMeters, maxDistanceMeters ) {
	if ( ! camera || typeof camera.updateMatrixWorld !== 'function'
		|| ! Number.isFinite( cellSizeMeters ) || cellSizeMeters <= 0
		|| ! Number.isFinite( maxDistanceMeters ) || maxDistanceMeters <= 0 ) return [];

	camera.updateMatrixWorld( true );
	viewProjection.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
	frustum.setFromProjectionMatrix( viewProjection, camera.coordinateSystem, camera.reversedDepth );

	const position = camera.position;
	const nearPlane = camera.projectionMatrixInverse;
	const farCorners = [];
	const cellRadius = cellSizeMeters * Math.sqrt( 3 ) / 2;
	for ( const y of [ - 1, 1 ] ) for ( const x of [ - 1, 1 ] ) {
		corner.set( x, y, 0.5 ).applyMatrix4( nearPlane );
		worldDirection.copy( corner ).normalize().transformDirection( camera.matrixWorld );
		farCorners.push( new Vector3().copy( position ).addScaledVector( worldDirection, maxDistanceMeters + cellRadius ) );
	}

	const margin = cellRadius;
	const min = [ position.x, position.y, position.z ];
	const max = [ position.x, position.y, position.z ];
	for ( const point of farCorners ) for ( let axis = 0; axis < 3; axis ++ ) {
		min[ axis ] = Math.min( min[ axis ], point.getComponent( axis ) );
		max[ axis ] = Math.max( max[ axis ], point.getComponent( axis ) );
	}
	const start = min.map( value => Math.floor( ( value - margin ) / cellSizeMeters ) );
	const end = max.map( value => Math.floor( ( value + margin ) / cellSizeMeters ) );
	const scanCount = ( end[ 0 ] - start[ 0 ] + 1 ) * ( end[ 1 ] - start[ 1 ] + 1 ) * ( end[ 2 ] - start[ 2 ] + 1 );
	if ( ! Number.isSafeInteger( scanCount ) || scanCount > MAX_VIEW_CELL_SCAN ) {
		throw new RangeError( `World camera view spans ${scanCount} candidate cells; limit is ${MAX_VIEW_CELL_SCAN}` );
	}

	const cells = [];
	for ( let x = start[ 0 ]; x <= end[ 0 ]; x ++ ) for ( let y = start[ 1 ]; y <= end[ 1 ]; y ++ ) for ( let z = start[ 2 ]; z <= end[ 2 ]; z ++ ) {
		const center = [ ( x + 0.5 ) * cellSizeMeters, ( y + 0.5 ) * cellSizeMeters, ( z + 0.5 ) * cellSizeMeters ];
		cellSphere.center.fromArray( center );
		cellSphere.radius = cellRadius;
		const distance = position.distanceTo( cellSphere.center );
		if ( distance > maxDistanceMeters + cellRadius || ! frustum.intersectsSphere( cellSphere ) ) continue;
		cells.push( { cell: [ x, y, z ], projectedSize: cellRadius / Math.max( distance, cellRadius ) } );
	}
	cells.sort( ( a, b ) => b.projectedSize - a.projectedSize || a.cell[ 0 ] - b.cell[ 0 ] || a.cell[ 1 ] - b.cell[ 1 ] || a.cell[ 2 ] - b.cell[ 2 ] );
	return cells.map( entry => entry.cell );
}
