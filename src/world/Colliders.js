import * as THREE from '../engine/index.js';

function closestPointOnSegmentXZ( x, z, a, b ) {

	const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
	const t = lengthSq > 1e-12 ? THREE.MathUtils.clamp( ( ( x - a.x ) * dx + ( z - a.z ) * dz ) / lengthSq, 0, 1 ) : 0;
	const px = a.x + t * dx, pz = a.z + t * dz;
	return { x: px, z: pz, distanceSq: ( x - px ) ** 2 + ( z - pz ) ** 2 };

}

function closestPointOnTriangleXZ( x, z, a, b, c ) {

	const abx = b.x - a.x, abz = b.z - a.z, acx = c.x - a.x, acz = c.z - a.z;
	const apx = x - a.x, apz = z - a.z;
	const d00 = abx * abx + abz * abz, d01 = abx * acx + abz * acz, d11 = acx * acx + acz * acz;
	const d20 = apx * abx + apz * abz, d21 = apx * acx + apz * acz;
	const denominator = d00 * d11 - d01 * d01;
	if ( Math.abs( denominator ) > 1e-12 ) {
		const v = ( d11 * d20 - d01 * d21 ) / denominator, w = ( d00 * d21 - d01 * d20 ) / denominator, u = 1 - v - w;
		if ( u >= 0 && v >= 0 && w >= 0 ) return { x, z, distanceSq: 0 };
	}

	const ab = closestPointOnSegmentXZ( x, z, a, b ), bc = closestPointOnSegmentXZ( x, z, b, c ), ca = closestPointOnSegmentXZ( x, z, c, a );
	return ab.distanceSq <= bc.distanceSq && ab.distanceSq <= ca.distanceSq ? ab : bc.distanceSq <= ca.distanceSq ? bc : ca;

}

// Lightweight collision world for the character controller and boat.
// Boxes are oriented around Y only; convexes keep world-space hull planes.
// This preserves the prior normal.y > 0.95 walkable-face cutoff when a world
// does not supply a more specific avatar/vehicle slope capability.
export const DEFAULT_WALKABLE_SLOPE_DEGREES = Math.acos( 0.95 ) * 180 / Math.PI;

let movementSupportKernel = null;

export function setMovementSupportKernel( kernel ) { movementSupportKernel = kernel; }

export class Colliders {

	constructor() {

		this.boxes = [];
		this.cylinders = [];
		this.convexes = [];
		this.heightfields = [];
		this._movementRevision = 0;
		this._v = new THREE.Vector3();

	}

	// center: world center, half: half extents (x, y, z) in the box's local frame, rotY: yaw (radians)
	addBox( center, half, rotY = 0, { walkable = false, solid = true, tag = '' } = {} ) {

		const b = {
			center: center.clone(), half: half.clone(), rotY,
			cos: Math.cos( rotY ), sin: Math.sin( rotY ),
			walkable, solid, tag,
			top: center.y + half.y, bottom: center.y - half.y,
			radius: Math.hypot( half.x, half.z ),
		};
		this.boxes.push( b );
		this._movementRevision ++;
		return b;

	}

	removeBox( box ) {
		const index = this.boxes.indexOf( box );
		if ( index === - 1 ) return false;
		this.boxes.splice( index, 1 );
		this._movementRevision ++;
		return true;
	}

	addCylinder( x, z, radius, yMin, yMax, { tag = '' } = {} ) {

		const c = { x, z, radius, yMin, yMax, tag };
		this.cylinders.push( c );
		return c;

	}

	removeCylinder( cylinder ) {
		const index = this.cylinders.indexOf( cylinder );
		if ( index === - 1 ) return false;
		this.cylinders.splice( index, 1 );
		return true;
	}

	addConvex( vertices, indices, { tag = '' } = {} ) {
		// The bridge supplies Unreal ConvexElem hulls; avoid an O(vertices × faces) revalidation here.
		if ( ! Array.isArray( vertices ) || vertices.length < 4 || ! Array.isArray( indices ) || indices.length < 12 || indices.length % 3 !== 0 ) throw new Error( 'Invalid convex collider geometry' );
		const center = new THREE.Vector3();
		const min = new THREE.Vector3( Infinity, Infinity, Infinity ), max = new THREE.Vector3( - Infinity, - Infinity, - Infinity );
		for ( const vertex of vertices ) {
			if ( ! vertex || ! [ vertex.x, vertex.y, vertex.z ].every( Number.isFinite ) ) throw new Error( 'Invalid convex collider vertex' );
			center.add( vertex ); min.min( vertex ); max.max( vertex );
		}
		center.multiplyScalar( 1 / vertices.length );
		const planes = [];
		const planeBuckets = new Map();
		const triangles = [];
		const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), normal = new THREE.Vector3(), point = new THREE.Vector3();
		for ( let offset = 0; offset < indices.length; offset += 3 ) {
			const ia = indices[ offset ], ib = indices[ offset + 1 ], ic = indices[ offset + 2 ];
			if ( ! [ ia, ib, ic ].every( index => Number.isInteger( index ) && index >= 0 && index < vertices.length ) ) throw new Error( 'Invalid convex collider index' );
			const a = vertices[ ia ], b = vertices[ ib ], c = vertices[ ic ];
			edge1.subVectors( b, a ); edge2.subVectors( c, a ); normal.crossVectors( edge1, edge2 );
			if ( normal.lengthSq() < 1e-12 ) continue;
			normal.normalize();
			if ( normal.dot( point.subVectors( center, a ) ) > 0 ) normal.negate();
			const distance = normal.dot( a );
			const key = `${ Math.round( normal.x * 1e4 ) },${ Math.round( normal.y * 1e4 ) },${ Math.round( normal.z * 1e4 ) }`;
			let bucket = planeBuckets.get( key );
			if ( ! bucket ) planeBuckets.set( key, bucket = [] );
			let plane = bucket.find( item => item.normal.dot( normal ) > 1 - 1e-5 && Math.abs( item.distance - distance ) < 1e-4 );
			if ( ! plane ) { plane = { normal: normal.clone(), distance }; bucket.push( plane ); planes.push( plane ); }
			if ( normal.y > 0 ) triangles.push( { a: a.clone(), b: b.clone(), c: c.clone(), normal: normal.clone(), distance } );
		}
		if ( planes.length < 4 ) throw new Error( 'Convex collider has fewer than four faces' );
		const convex = { vertices, planes, triangles, min, max, tag };
		this.convexes.push( convex );
		this._movementRevision ++;
		return convex;
	}

	removeConvex( convex ) {
		const index = this.convexes.indexOf( convex );
		if ( index === - 1 ) return false;
		this.convexes.splice( index, 1 );
		this._movementRevision ++;
		return true;
	}

	addHeightfield( positions, columns, rows, { position, scale, yaw = 0, tag = '' } = {} ) {
		if ( ! positions || ! Number.isInteger( columns ) || ! Number.isInteger( rows ) || columns < 2 || rows < 2 || columns * rows > 4194304 || positions.length !== columns * rows * 3 || ! position || ! scale || ! [ position.x, position.y, position.z, scale.x, scale.y, scale.z, yaw ].every( Number.isFinite ) || scale.x <= 0 || scale.y <= 0 || scale.z <= 0 ) throw new Error( 'Invalid heightfield dimensions or transform' );
		const first = { x: positions[ 0 ], z: positions[ 2 ] };
		const last = { x: positions[ positions.length - 3 ], z: positions[ positions.length - 1 ] };
		const minX = Math.min( first.x, last.x ), maxX = Math.max( first.x, last.x );
		const minZ = Math.min( first.z, last.z ), maxZ = Math.max( first.z, last.z );
		if ( ! Number.isFinite( minX + maxX + minZ + maxZ ) || maxX <= minX || maxZ <= minZ ) throw new Error( 'Heightfield has invalid bounds' );
		const stepX = ( maxX - minX ) / ( columns - 1 ), stepZ = ( maxZ - minZ ) / ( rows - 1 );
		const tolerance = Math.max( stepX, stepZ ) * 1e-4 + 1e-4;
		for ( let row = 0; row < rows; row ++ ) for ( let column = 0; column < columns; column ++ ) {
			const offset = ( row * columns + column ) * 3;
			const expectedX = minX + column * stepX, expectedZ = minZ + row * stepZ;
			if ( ! Number.isFinite( positions[ offset + 1 ] ) || Math.abs( positions[ offset ] - expectedX ) > tolerance || Math.abs( positions[ offset + 2 ] - expectedZ ) > tolerance ) throw new Error( 'Heightfield vertices must form a regular XZ grid' );
		}
		const field = { positions, columns, rows, minX, minZ, maxX, maxZ, stepX, stepZ, position, scale, yaw, cos: Math.cos( yaw ), sin: Math.sin( yaw ), tag };
		this.heightfields.push( field );
		this._movementRevision ++;
		return field;
	}

	removeHeightfield( field ) {
		const index = this.heightfields.indexOf( field );
		if ( index === - 1 ) return false;
		this.heightfields.splice( index, 1 );
		this._movementRevision ++;
		return true;
	}

	_toLocal( b, x, z ) {

		const dx = x - b.center.x, dz = z - b.center.z;
		return [ dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos ];

	}

	_toWorldDir( b, lx, lz ) {

		return [ lx * b.cos + lz * b.sin, - lx * b.sin + lz * b.cos ];

	}

	// Highest permitted convex surface under (x, z). A capsule support radius
	// shifts its feet upward on an incline by the geometric plane-contact offset.
	groundHeightAt( x, z, maxY, pad = 0, maxWalkableSlopeDegrees = DEFAULT_WALKABLE_SLOPE_DEGREES, capsuleRadius = 0 ) {

		if ( movementSupportKernel ) return movementSupportKernel.supportHeight( this, x, z, maxY, pad, maxWalkableSlopeDegrees, capsuleRadius );

		let best = - Infinity;
		const minWalkableNormalY = Math.cos( THREE.MathUtils.degToRad( maxWalkableSlopeDegrees ) );
		for ( const b of this.boxes ) {

			if ( ! b.walkable || b.top > maxY ) continue;
			if ( Math.abs( x - b.center.x ) > b.radius + pad + 0.01 || Math.abs( z - b.center.z ) > b.radius + pad + 0.01 ) continue;
			const [ lx, lz ] = this._toLocal( b, x, z );
			if ( Math.abs( lx ) <= b.half.x + pad && Math.abs( lz ) <= b.half.z + pad ) best = Math.max( best, b.top );

		}
		for ( const convex of this.convexes ) {
			if ( convex.min.y > maxY || x < convex.min.x - pad - capsuleRadius || x > convex.max.x + pad + capsuleRadius || z < convex.min.z - pad - capsuleRadius || z > convex.max.z + pad + capsuleRadius ) continue;
			for ( const triangle of convex.triangles ) {
				const { a, b, c, normal } = triangle;
				if ( normal.y < minWalkableNormalY ) continue;
				const support = closestPointOnTriangleXZ( x, z, a, b, c );
				if ( support.distanceSq > capsuleRadius * capsuleRadius + 1e-12 ) continue;
				const surfaceHeight = ( triangle.distance - normal.x * support.x - normal.z * support.z ) / normal.y;
				const capsuleSupportHeight = surfaceHeight + capsuleRadius * ( 1 / normal.y - 1 );
				if ( capsuleSupportHeight <= maxY ) best = Math.max( best, capsuleSupportHeight );
			}
		}
		for ( const field of this.heightfields ) {
			const dx = x - field.position.x, dz = z - field.position.z;
			const localX = ( dx * field.cos - dz * field.sin ) / field.scale.x;
			const localZ = ( dx * field.sin + dz * field.cos ) / field.scale.z;
			let column = ( localX - field.minX ) / field.stepX;
			let row = ( localZ - field.minZ ) / field.stepZ;
			if ( column < - pad / field.stepX || column > field.columns - 1 + pad / field.stepX || row < - pad / field.stepZ || row > field.rows - 1 + pad / field.stepZ ) continue;
			column = Math.max( 0, Math.min( field.columns - 1, column ) );
			row = Math.max( 0, Math.min( field.rows - 1, row ) );
			const x0 = Math.min( field.columns - 2, Math.floor( column ) ), z0 = Math.min( field.rows - 2, Math.floor( row ) );
			const tx = column - x0, tz = row - z0;
			const h = ( cx, cz ) => field.positions[ ( cz * field.columns + cx ) * 3 + 1 ];
			const h0 = h( x0, z0 ) * ( 1 - tx ) + h( x0 + 1, z0 ) * tx;
			const h1 = h( x0, z0 + 1 ) * ( 1 - tx ) + h( x0 + 1, z0 + 1 ) * tx;
			const worldHeight = field.position.y + ( h0 * ( 1 - tz ) + h1 * tz ) * field.scale.y;
			if ( worldHeight <= maxY ) best = Math.max( best, worldHeight );
		}

		return best;

	}

	// Find a nearby raised walkable surface that a grounded capsule can step onto.
	// The returned height is only a candidate; callers that stream collision data
	// must validate the raised path before applying it.
	stepCapsuleToSurface( pos, from, radius, height, maxStepHeight ) {

		if ( ! Number.isFinite( maxStepHeight ) || maxStepHeight <= 0 ) return null;
		const moveX = pos.x - from.x, moveZ = pos.z - from.z;
		const moveLength = Math.hypot( moveX, moveZ );
		if ( moveLength <= 1e-8 ) return null;
		const fromGround = this.groundHeightAt( from.x, from.z, from.y + 0.08, radius * 0.25 );
		if ( ! Number.isFinite( fromGround ) || from.y - fromGround > 0.08 ) return null;

		// A convex stair hull has a vertical riser and a separate horizontal tread.
		// The capsule center can still be in front of that tread when its leading
		// edge reaches it, so sample the support point in the direction of travel.
		const stepX = pos.x + moveX / moveLength * radius;
		const stepZ = pos.z + moveZ / moveLength * radius;
		const stepGround = this.groundHeightAt( stepX, stepZ, fromGround + maxStepHeight + 1e-4, 0 );
		const rise = stepGround - fromGround;
		if ( ! Number.isFinite( stepGround ) || rise < 0.02 || rise > maxStepHeight + 1e-4 ) return null;

		const candidate = { x: pos.x, y: stepGround, z: pos.z };
		if ( this.resolveCapsule( candidate, radius, height ) ) return null;
		return stepGround;

	}

	// Push a vertical capsule (feet at pos.y) out of solid geometry. Returns true if collided.
	resolveCapsule( pos, radius, height, maxWalkableSlopeDegrees = DEFAULT_WALKABLE_SLOPE_DEGREES ) {

		let hit = false;
		const minWalkableNormalY = Math.cos( THREE.MathUtils.degToRad( maxWalkableSlopeDegrees ) );
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			if ( pos.y + height <= b.bottom || pos.y >= b.top ) continue;
			if ( Math.abs( pos.x - b.center.x ) > b.radius + radius || Math.abs( pos.z - b.center.z ) > b.radius + radius ) continue;
			const [ lx, lz ] = this._toLocal( b, pos.x, pos.z );
			const cx = Math.max( - b.half.x, Math.min( b.half.x, lx ) );
			const cz = Math.max( - b.half.z, Math.min( b.half.z, lz ) );
			let dx = lx - cx, dz = lz - cz;
			const d2 = dx * dx + dz * dz;
			if ( d2 >= radius * radius ) continue;
			// Keep a shallow downward contact error on walkable geometry vertical.
			// A live start reproduced a 0.0981 m penetration on the first gravity
			// frame; 0.3 capsule radii gives that measured case
			// a small margin. This is contact correction, not step-up capability:
			// step-up distance remains owned by the active movement profile.
			if ( b.walkable && b.top - pos.y <= Math.max( 0.05, radius * 0.3 ) ) {
				pos.y = b.top;
				hit = true;
				continue;
			}
			let nx, nz, pen;
			if ( d2 > 1e-8 ) {

				const d = Math.sqrt( d2 );
				nx = dx / d; nz = dz / d; pen = radius - d;

			} else {

				// center inside box: push out along the smallest axis
				const px = b.half.x - Math.abs( lx ), pz = b.half.z - Math.abs( lz );
				if ( px < pz ) { nx = Math.sign( lx ) || 1; nz = 0; pen = px + radius; } else { nx = 0; nz = Math.sign( lz ) || 1; pen = pz + radius; }

			}

			const [ wx, wz ] = this._toWorldDir( b, nx, nz );
			pos.x += wx * pen;
			pos.z += wz * pen;
			hit = true;

		}

		for ( const c of this.cylinders ) {

			if ( pos.y + height <= c.yMin || pos.y >= c.yMax ) continue;
			const dx = pos.x - c.x, dz = pos.z - c.z;
			const r = c.radius + radius;
			const d2 = dx * dx + dz * dz;
			if ( d2 >= r * r ) continue;
			const d = Math.sqrt( d2 ) || 1e-4;
			pos.x = c.x + dx / d * r;
			pos.z = c.z + dz / d * r;
			hit = true;

		}

		const centerY = pos.y + height * 0.5;
		const segmentHalf = Math.max( 0, height * 0.5 - radius );
		for ( const convex of this.convexes ) {
			if ( pos.y > convex.max.y || pos.y + height < convex.min.y || pos.x + radius < convex.min.x || pos.x - radius > convex.max.x || pos.z + radius < convex.min.z || pos.z - radius > convex.max.z ) continue;
			let separated = false, bestDepth = Infinity, bestNormal = null;
			for ( const plane of convex.planes ) {
				const n = plane.normal;
				const support = radius + segmentHalf * Math.abs( n.y );
				const depth = plane.distance + support - ( n.x * pos.x + n.y * centerY + n.z * pos.z );
				if ( depth < - 1e-6 ) { separated = true; break; }
				if ( depth < bestDepth ) { bestDepth = depth; bestNormal = n; }
			}
			if ( separated || ! bestNormal || bestDepth <= 1e-6 || Math.hypot( bestNormal.x, bestNormal.z ) <= 1e-4 ) continue;
			if ( bestNormal.y >= minWalkableNormalY ) {
				pos.y += bestDepth / bestNormal.y;
				hit = true;
				continue;
			}
			const horizontalLength = Math.hypot( bestNormal.x, bestNormal.z );
			const distance = bestDepth / horizontalLength;
			pos.x += bestNormal.x / horizontalLength * distance;
			pos.z += bestNormal.z / horizontalLength * distance;
			hit = true;
		}

		return hit;

	}

	// Segment/ray against boxes (XZ-plane rotated) for camera occlusion; returns distance or Infinity.
	raycast( origin, dir, maxDist ) {

		let best = maxDist;
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			const ox = origin.x - b.center.x, oz = origin.z - b.center.z, oy = origin.y - b.center.y;
			const lox = ox * b.cos - oz * b.sin, localZ = ox * b.sin + oz * b.cos;
			const ldx = dir.x * b.cos - dir.z * b.sin, ldz = dir.x * b.sin + dir.z * b.cos;
			let tmin = 0, tmax = best;
			const slab = ( o, d, h ) => {

				if ( Math.abs( d ) < 1e-8 ) return Math.abs( o ) <= h;
				let t1 = ( - h - o ) / d, t2 = ( h - o ) / d;
				if ( t1 > t2 ) { const t = t1; t1 = t2; t2 = t; }
				tmin = Math.max( tmin, t1 );
				tmax = Math.min( tmax, t2 );
				return tmin <= tmax;

			};

			if ( slab( lox, ldx, b.half.x ) && slab( oy, dir.y, b.half.y ) && slab( localZ, ldz, b.half.z ) ) best = Math.min( best, tmin );

		}

		return best;

	}

}
