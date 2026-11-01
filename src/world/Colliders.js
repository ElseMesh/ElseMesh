import * as THREE from '../engine/index.js';

// Lightweight collision world for the character controller and boat.
// Boxes are oriented around Y only; convexes keep world-space hull planes.
export class Colliders {

	constructor() {

		this.boxes = [];
		this.cylinders = [];
		this.convexes = [];
		this.heightfields = [];
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
		return b;

	}

	removeBox( box ) {
		const index = this.boxes.indexOf( box );
		if ( index === - 1 ) return false;
		this.boxes.splice( index, 1 );
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
			if ( normal.y > 0.95 ) triangles.push( { a: a.clone(), b: b.clone(), c: c.clone(), normal: normal.clone(), distance } );
		}
		if ( planes.length < 4 ) throw new Error( 'Convex collider has fewer than four faces' );
		const convex = { vertices, planes, triangles, min, max, tag };
		this.convexes.push( convex );
		return convex;
	}

	removeConvex( convex ) {
		const index = this.convexes.indexOf( convex );
		if ( index === - 1 ) return false;
		this.convexes.splice( index, 1 );
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
		return field;
	}

	removeHeightfield( field ) {
		const index = this.heightfields.indexOf( field );
		if ( index === - 1 ) return false;
		this.heightfields.splice( index, 1 );
		return true;
	}

	_toLocal( b, x, z ) {

		const dx = x - b.center.x, dz = z - b.center.z;
		return [ dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos ];

	}

	_toWorldDir( b, lx, lz ) {

		return [ lx * b.cos + lz * b.sin, - lx * b.sin + lz * b.cos ];

	}

	// Highest walkable surface under (x, z) not higher than maxY.
	groundHeightAt( x, z, maxY, pad = 0 ) {

		let best = - Infinity;
		for ( const b of this.boxes ) {

			if ( ! b.walkable || b.top > maxY ) continue;
			if ( Math.abs( x - b.center.x ) > b.radius + pad + 0.01 || Math.abs( z - b.center.z ) > b.radius + pad + 0.01 ) continue;
			const [ lx, lz ] = this._toLocal( b, x, z );
			if ( Math.abs( lx ) <= b.half.x + pad && Math.abs( lz ) <= b.half.z + pad ) best = Math.max( best, b.top );

		}
		for ( const convex of this.convexes ) {
			if ( convex.max.y > maxY || x < convex.min.x - pad || x > convex.max.x + pad || z < convex.min.z - pad || z > convex.max.z + pad ) continue;
			for ( const triangle of convex.triangles ) {
				const { a, b, c, normal } = triangle;
				const v0x = c.x - a.x, v0z = c.z - a.z, v1x = b.x - a.x, v1z = b.z - a.z, v2x = x - a.x, v2z = z - a.z;
				const dot00 = v0x * v0x + v0z * v0z, dot01 = v0x * v1x + v0z * v1z, dot02 = v0x * v2x + v0z * v2z;
				const dot11 = v1x * v1x + v1z * v1z, dot12 = v1x * v2x + v1z * v2z;
				const denominator = dot00 * dot11 - dot01 * dot01;
				if ( Math.abs( denominator ) < 1e-12 ) continue;
				const u = ( dot11 * dot02 - dot01 * dot12 ) / denominator, v = ( dot00 * dot12 - dot01 * dot02 ) / denominator;
				if ( u < - 1e-6 || v < - 1e-6 || u + v > 1 + 1e-6 ) continue;
				const height = ( triangle.distance - normal.x * x - normal.z * z ) / normal.y;
				if ( height <= maxY ) best = Math.max( best, height );
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

	// Push a vertical capsule (feet at pos.y) out of solid geometry. Returns true if collided.
	resolveCapsule( pos, radius, height, stepHeight = 0.35 ) {

		let hit = false;
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			if ( pos.y + height < b.bottom || pos.y + stepHeight > b.top ) continue;
			if ( Math.abs( pos.x - b.center.x ) > b.radius + radius || Math.abs( pos.z - b.center.z ) > b.radius + radius ) continue;
			const [ lx, lz ] = this._toLocal( b, pos.x, pos.z );
			const cx = Math.max( - b.half.x, Math.min( b.half.x, lx ) );
			const cz = Math.max( - b.half.z, Math.min( b.half.z, lz ) );
			let dx = lx - cx, dz = lz - cz;
			const d2 = dx * dx + dz * dz;
			if ( d2 >= radius * radius ) continue;
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

			if ( pos.y + height < c.yMin || pos.y + stepHeight > c.yMax ) continue;
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
