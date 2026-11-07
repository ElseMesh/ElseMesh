// Renderer-neutral procedural shapes used by the standard ground-detail field.
// These meshes contain no world placement, material, or backend state.

const TAU = Math.PI * 2;
const stoneCache = new Map();

export function hash1( n ) {

	const s = Math.sin( n * 127.1 + 311.7 ) * 43758.5453;
	return s - Math.floor( s );

}

function hash3( i, j, k, s ) {

	let h = ( i * 374761393 + j * 668265263 + k * 1440662683 + s * 2147483647 ) | 0;
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	h ^= h >>> 16;
	return ( h >>> 0 ) / 4294967296;

}

export function vnoise3( x, y, z, s = 0 ) {

	const i = Math.floor( x ), j = Math.floor( y ), k = Math.floor( z );
	const fx = x - i, fy = y - j, fz = z - k;
	const ux = fx * fx * ( 3 - 2 * fx ), uy = fy * fy * ( 3 - 2 * fy ), uz = fz * fz * ( 3 - 2 * fz );
	const lerp = ( a, b, t ) => a + ( b - a ) * t;
	const h = ( a, b, c ) => hash3( i + a, j + b, k + c, s );
	return lerp(
		lerp( lerp( h( 0, 0, 0 ), h( 1, 0, 0 ), ux ), lerp( h( 0, 1, 0 ), h( 1, 1, 0 ), ux ), uy ),
		lerp( lerp( h( 0, 0, 1 ), h( 1, 0, 1 ), ux ), lerp( h( 0, 1, 1 ), h( 1, 1, 1 ), ux ), uy ),
		uz
	) * 2 - 1;

}

function icosphere( detail ) {

	const t = ( 1 + Math.sqrt( 5 ) ) / 2;
	const vertices = [ [ - 1, t, 0 ], [ 1, t, 0 ], [ - 1, - t, 0 ], [ 1, - t, 0 ], [ 0, - 1, t ], [ 0, 1, t ], [ 0, - 1, - t ], [ 0, 1, - t ], [ t, 0, - 1 ], [ t, 0, 1 ], [ - t, 0, - 1 ], [ - t, 0, 1 ] ].map( ( v ) => {

		const length = Math.hypot( ...v );
		return v.map( value => value / length );

	} );
	let faces = [ 0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1 ];
	for ( let d = 0; d < detail; d ++ ) {

		const cache = new Map();
		const midpoint = ( a, b ) => {

			const key = a < b ? a * 100000 + b : b * 100000 + a;
			let index = cache.get( key );
			if ( index === undefined ) {

				const point = [ vertices[ a ][ 0 ] + vertices[ b ][ 0 ], vertices[ a ][ 1 ] + vertices[ b ][ 1 ], vertices[ a ][ 2 ] + vertices[ b ][ 2 ] ];
				const length = Math.hypot( ...point );
				vertices.push( point.map( value => value / length ) );
				index = vertices.length - 1;
				cache.set( key, index );

			}

			return index;

		};
		const next = [];
		for ( let f = 0; f < faces.length; f += 3 ) {

			const a = faces[ f ], b = faces[ f + 1 ], c = faces[ f + 2 ];
			const ab = midpoint( a, b ), bc = midpoint( b, c ), ca = midpoint( c, a );
			next.push( a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca );

		}
		faces = next;

	}
	return { vertices, faces };

}

const ICO = [ icosphere( 0 ), icosphere( 1 ), icosphere( 2 ) ];

function vertexNormals( positions, indices ) {

	const normals = new Float32Array( positions.length );
	for ( let t = 0; t < indices.length; t += 3 ) {

		const a = indices[ t ] * 3, b = indices[ t + 1 ] * 3, c = indices[ t + 2 ] * 3;
		const ux = positions[ b ] - positions[ a ], uy = positions[ b + 1 ] - positions[ a + 1 ], uz = positions[ b + 2 ] - positions[ a + 2 ];
		const vx = positions[ c ] - positions[ a ], vy = positions[ c + 1 ] - positions[ a + 1 ], vz = positions[ c + 2 ] - positions[ a + 2 ];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		for ( const o of [ a, b, c ] ) { normals[ o ] += nx; normals[ o + 1 ] += ny; normals[ o + 2 ] += nz; }

	}
	for ( let i = 0; i < normals.length; i += 3 ) {

		const length = Math.hypot( normals[ i ], normals[ i + 1 ], normals[ i + 2 ] ) || 1;
		normals[ i ] /= length; normals[ i + 1 ] /= length; normals[ i + 2 ] /= length;

	}
	return normals;

}

function fixWinding( part ) {

	const { p, n, idx } = part;
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = p[ b ] - p[ a ], uy = p[ b + 1 ] - p[ a + 1 ], uz = p[ b + 2 ] - p[ a + 2 ];
		const vx = p[ c ] - p[ a ], vy = p[ c + 1 ] - p[ a + 1 ], vz = p[ c + 2 ] - p[ a + 2 ];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const i0 = idx[ t ] * 3, i1 = idx[ t + 1 ] * 3, i2 = idx[ t + 2 ] * 3;
		if ( nx * ( n[ i0 ] + n[ i1 ] + n[ i2 ] ) + ny * ( n[ i0 + 1 ] + n[ i1 + 1 ] + n[ i2 + 1 ] ) + nz * ( n[ i0 + 2 ] + n[ i1 + 2 ] + n[ i2 + 2 ] ) < 0 ) [ idx[ t + 1 ], idx[ t + 2 ] ] = [ idx[ t + 2 ], idx[ t + 1 ] ];

	}
	return part;

}

export function stonePart( variant, detail = 1, angular = 0 ) {

	const key = `${variant}|${detail}|${angular}`;
	let part = stoneCache.get( key );
	if ( part ) return part;
	const { vertices, faces } = ICO[ detail ];
	const seed = variant * 17 + 3;
	const planes = [];
	for ( let k = 0; k < Math.round( angular * 6 ); k ++ ) {

		const u = hash1( seed + k * 3.1 ) * 2 - 1, a = hash1( seed + k * 5.7 ) * TAU;
		const rr = Math.sqrt( 1 - u * u );
		planes.push( [ rr * Math.cos( a ), u * 0.7, rr * Math.sin( a ), 0.68 + hash1( seed + k * 9.3 ) * 0.22 ] );

	}
	const p = [];
	for ( const v of vertices ) {

		let r = 1 + 0.13 * vnoise3( v[ 0 ] * 1.3 + seed, v[ 1 ] * 1.3, v[ 2 ] * 1.3, seed ) + 0.05 * vnoise3( v[ 0 ] * 3.1, v[ 1 ] * 3.1 + seed, v[ 2 ] * 3.1, seed + 1 );
		for ( const q of planes ) {

			const d = v[ 0 ] * q[ 0 ] + v[ 1 ] * q[ 1 ] + v[ 2 ] * q[ 2 ];
			if ( d <= 0.05 ) continue;
			const rp = q[ 3 ] / d, k = 0.08;
			const h = Math.max( 0, Math.min( 1, 0.5 + 0.5 * ( rp - r ) / k ) );
			r = rp + ( r - rp ) * h - k * h * ( 1 - h );

		}
		p.push( v[ 0 ] * r, v[ 1 ] * r, v[ 2 ] * r );

	}
	const idx = faces.slice(), n = Array.from( vertexNormals( p, idx ) );
	const uv = [];
	for ( let i = 0; i < p.length; i += 3 ) uv.push( p[ i ] * 0.5 + p[ i + 1 ] * 0.2, p[ i + 2 ] * 0.5 );
	part = fixWinding( { p, n, uv, idx } );
	stoneCache.set( key, part );
	return part;

}

export function chipPart( variant ) {

	const p = [ 0, 0.3, 0 ], idx = [], m = 6;
	for ( let k = 0; k < m; k ++ ) {

		const a = ( k + ( ( variant * 7 + k * 3 ) % 5 ) * 0.12 ) / m * TAU;
		const r = 0.65 + ( ( variant * 13 + k * 7 ) % 9 ) / 9 * 0.45;
		p.push( Math.cos( a ) * r, 0, Math.sin( a ) * r );

	}
	for ( let k = 0; k < m; k ++ ) idx.push( 0, 1 + ( k + 1 ) % m, 1 + k );
	const n = new Array( p.length ).fill( 0 );
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = p[ b ] - p[ a ], uy = p[ b + 1 ] - p[ a + 1 ], uz = p[ b + 2 ] - p[ a + 2 ];
		const vx = p[ c ] - p[ a ], vy = p[ c + 1 ] - p[ a + 1 ], vz = p[ c + 2 ] - p[ a + 2 ];
		const normal = [ uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx ];
		for ( const o of [ a, b, c ] ) { n[ o ] += normal[ 0 ]; n[ o + 1 ] += normal[ 1 ]; n[ o + 2 ] += normal[ 2 ]; }

	}
	for ( let i = 0; i < n.length; i += 3 ) {

		if ( n[ i + 1 ] < 0 ) { n[ i ] *= - 1; n[ i + 1 ] *= - 1; n[ i + 2 ] *= - 1; }
		n[ i + 1 ] += 0.6;
		const length = Math.hypot( n[ i ], n[ i + 1 ], n[ i + 2 ] );
		n[ i ] /= length; n[ i + 1 ] /= length; n[ i + 2 ] /= length;

	}
	for ( let t = 0; t < idx.length; t += 3 ) {

		const a = idx[ t ] * 3, b = idx[ t + 1 ] * 3, c = idx[ t + 2 ] * 3;
		const ux = p[ b ] - p[ a ], uz = p[ b + 2 ] - p[ a + 2 ], vx = p[ c ] - p[ a ], vz = p[ c + 2 ] - p[ a + 2 ];
		if ( uz * vx - ux * vz < 0 ) [ idx[ t + 1 ], idx[ t + 2 ] ] = [ idx[ t + 2 ], idx[ t + 1 ] ];

	}
	return { p, n, idx };

}
