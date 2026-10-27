import * as THREE from '../engine/index.js';

// Lightweight collision world for the character controller and boat.
// Boxes are oriented around Y only. Walkable boxes (decks, floors, stairs) act as ground.
export class Colliders {

	constructor() {

		this.boxes = [];
		this.cylinders = [];
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

		return hit;

	}

	// Segment/ray against boxes (XZ-plane rotated) for camera occlusion; returns distance or Infinity.
	raycast( origin, dir, maxDist ) {

		let best = maxDist;
		for ( const b of this.boxes ) {

			if ( ! b.solid ) continue;
			const ox = origin.x - b.center.x, oz = origin.z - b.center.z, oy = origin.y - b.center.y;
			const lox = ox * b.cos - oz * b.sin, loz = ox * b.sin + oz * b.cos;
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

			if ( slab( lox, ldx, b.half.x ) && slab( oy, dir.y, b.half.y ) && slab( loz, ldz, b.half.z ) ) best = Math.min( best, tmin );

		}

		return best;

	}

}
