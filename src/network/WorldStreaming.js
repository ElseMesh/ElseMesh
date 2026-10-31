import { Frustum, Matrix4, Sphere, Vector3 } from '../engine/index.js';
import { worldComponentDescriptor } from './WorldComponentRegistry.js';

const VIEW_RANK = Object.freeze( { 'portal-preview': 0, visible: 1, nearby: 2, background: 3 } );
const _frustum = new Frustum();
const _viewProjection = new Matrix4();
const _center = new Vector3();
const _sphere = new Sphere();

// Select object records whose authored bounds are in view, plus nearby objects that
// should be ready before the player turns toward them. Missing bounds retain legacy
// behavior unless the caller supplies an entry priority ceiling.
export function selectWorldObjectsForView( manifest, camera, { nearbyDistance = 24, maxDistance = 500, maxPriority = 'background' } = {} ) {
	if ( ! manifest || ! camera ) return [];
	camera.updateMatrixWorld( true );
	_viewProjection.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
	_frustum.setFromProjectionMatrix( _viewProjection, camera.coordinateSystem, camera.reversedDepth );
	const cameraPosition = camera.position;
	const priorities = new Map( manifest.assets.map( ( asset ) => [ asset.id, asset.priority ] ) );
	const maxRank = VIEW_RANK[ maxPriority ] ?? VIEW_RANK.background;
	const replacedPreviewIDs = new Set( ( manifest.objects || [] ).map( ( object ) => object.replacesObjectId ).filter( Boolean ) );
	const selected = [];
	for ( const object of manifest.objects || [] ) {
		const priority = object.priority || priorities.get( object.assetId ) || 'visible';
		// A portal-preview object with a higher-detail replacement is only a portal
		// placeholder. Without a replacement, it is the world's actual representation
		// (for example a compact cave mesh), so it must also load after crossing.
		if ( priority === 'portal-preview' && replacedPreviewIDs.has( object.id ) ) continue;
		if ( ( VIEW_RANK[ priority ] ?? VIEW_RANK.visible ) > maxRank ) continue;
		const bounds = object.streamingBounds;
		if ( ! bounds ) {
			selected.push( object );
			continue;
		}
		transformBoundsCenter( object, bounds.center, _center );
		const scale = object.scale || [ 1, 1, 1 ];
		_sphere.center.copy( _center );
		_sphere.radius = bounds.radius * Math.max( Math.abs( scale[ 0 ] ), Math.abs( scale[ 1 ] ), Math.abs( scale[ 2 ] ) );
		const distance = cameraPosition.distanceTo( _center );
		const objectMaxDistance = Number.isFinite( bounds.maxDistanceMeters ) ? Math.min( maxDistance, bounds.maxDistanceMeters ) : maxDistance;
		if ( distance > objectMaxDistance ) continue;
		if ( distance <= nearbyDistance || _frustum.intersectsSphere( _sphere ) ) selected.push( object );
	}
	return selected.sort( ( a, b ) => ( VIEW_RANK[ a.priority || priorities.get( a.assetId ) ] ?? 1 ) - ( VIEW_RANK[ b.priority || priorities.get( b.assetId ) ] ?? 1 ) );
}

// Component bounds are already world-space, unlike object-local bounds. Legacy
// unbounded components remain selected immediately unless entry priority is capped.
export function selectWorldComponentsForView( manifest, camera, { nearbyDistance = 24, maxDistance = 500, maxPriority = 'background' } = {} ) {
	if ( ! manifest || ! camera ) return [];
	camera.updateMatrixWorld( true );
	_viewProjection.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
	_frustum.setFromProjectionMatrix( _viewProjection, camera.coordinateSystem, camera.reversedDepth );
	const assets = new Map( ( manifest.assets || [] ).map( ( asset ) => [ asset.id, asset.priority ] ) );
	const maxRank = VIEW_RANK[ maxPriority ] ?? VIEW_RANK.background;
	const selected = [];
	for ( const component of manifest.components || [] ) {
		const priority = worldComponentPriority( component, assets );
		const rank = VIEW_RANK[ priority ] ?? VIEW_RANK.visible;
		const bounds = component.streamingBounds;
		if ( ! bounds ) { if ( rank <= maxRank ) selected.push( component ); continue; }
		_center.fromArray( bounds.center );
		_sphere.center.copy( _center );
		_sphere.radius = bounds.radius;
		const distance = camera.position.distanceTo( _center );
		if ( distance <= maxDistance && ( distance <= nearbyDistance || _frustum.intersectsSphere( _sphere ) ) ) selected.push( component );
	}
	return selected.sort( ( a, b ) => ( VIEW_RANK[ worldComponentPriority( a, assets ) ] ?? 1 ) - ( VIEW_RANK[ worldComponentPriority( b, assets ) ] ?? 1 ) );
}

function worldComponentPriority( component, assets ) {
	if ( component.priority ) return component.priority;
	for ( const reference of component.assets || [] ) {
		const priority = assets.get( reference.assetId );
		if ( priority ) return priority;
	}
	return component.assets?.length ? 'portal-preview' : 'visible';
}

export function isVegetationWorldComponent( component ) {
	return worldComponentDescriptor( component?.type )?.vegetation === true;
}

export function transformBoundsCenter( object, center, target ) {
	const p = object.transform.position, scale = object.scale || [ 1, 1, 1 ];
	let x = center[ 0 ] * scale[ 0 ], y = center[ 1 ] * scale[ 1 ], z = center[ 2 ] * scale[ 2 ];
	const rotation = object.transform.rotation;
	if ( rotation ) {
		const [ qx, qy, qz, qw ] = rotation;
		const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = - qx * x - qy * y - qz * z;
		x = ix * qw + iw * - qx + iy * - qz - iz * - qy;
		y = iy * qw + iw * - qy + iz * - qx - ix * - qz;
		z = iz * qw + iw * - qz + ix * - qy - iy * - qx;
	} else {
		const yaw = object.transform.yaw || 0, cos = Math.cos( yaw ), sin = Math.sin( yaw );
		[ x, z ] = [ x * cos + z * sin, - x * sin + z * cos ];
	}
	return target.set( p[ 0 ] + x, p[ 1 ] + y, p[ 2 ] + z );
}
