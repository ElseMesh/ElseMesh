import { Euler, Matrix4, Quaternion, Vector3 } from '../math/index.js';

// Backend-neutral position/normal/UV geometry primitives. World packages can
// use these without depending on another world's material batcher.
const _p = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _e = new Euler( 0, 0, 0, 'YXZ' );
const _q = new Quaternion();
const _s = new Vector3( 1, 1, 1 );

export class Part {

	constructor( p, n, uv, idx ) {

		this.p = p instanceof Float32Array ? p : new Float32Array( p );
		this.n = n instanceof Float32Array ? n : new Float32Array( n );
		this.uv = uv instanceof Float32Array ? uv : new Float32Array( uv );
		this.idx = idx;

	}

	get vertexCount() {

		return this.p.length / 3;

	}

}

export function slabPart( pts, thickness, uDir = null, upHint = null ) {

	const m = pts.length;
	const nrm = new Vector3();
	for ( let i = 0; i < m; i ++ ) {

		const a = pts[ i ], b = pts[ ( i + 1 ) % m ];
		nrm.x += ( a.y - b.y ) * ( a.z + b.z );
		nrm.y += ( a.z - b.z ) * ( a.x + b.x );
		nrm.z += ( a.x - b.x ) * ( a.y + b.y );

	}

	nrm.normalize();
	if ( upHint && nrm.dot( upHint ) < 0 ) {

		pts = pts.slice().reverse();
		nrm.negate();

	}
	const u = ( uDir ? uDir.clone() : pts[ 1 ].clone().sub( pts[ 0 ] ) );
	u.sub( nrm.clone().multiplyScalar( u.dot( nrm ) ) ).normalize();
	const v = nrm.clone().cross( u );
	const off = nrm.clone().multiplyScalar( - thickness );
	const p = [], n = [], uv = [], idx = [];
	let uMin = Infinity, vMin = Infinity;
	for ( const q of pts ) {

		uMin = Math.min( uMin, q.dot( u ) );
		vMin = Math.min( vMin, q.dot( v ) );

	}

	const o = u.clone().multiplyScalar( uMin ).add( v.clone().multiplyScalar( vMin ) );
	let base = 0;
	for ( const q of pts ) {

		p.push( q.x, q.y, q.z ); n.push( nrm.x, nrm.y, nrm.z );
		_p.copy( q ).sub( o );
		uv.push( _p.dot( u ), _p.dot( v ) );

	}

	for ( let i = 1; i < m - 1; i ++ ) idx.push( base, base + i, base + i + 1 );
	if ( thickness > 0 ) {

		base = p.length / 3;
		for ( const q of pts ) {

			p.push( q.x + off.x, q.y + off.y, q.z + off.z ); n.push( - nrm.x, - nrm.y, - nrm.z );
			_p.copy( q ).sub( o );
			uv.push( _p.dot( u ), _p.dot( v ) );

		}

		for ( let i = 1; i < m - 1; i ++ ) idx.push( base, base + i + 1, base + i );
		for ( let i = 0; i < m; i ++ ) {

			const a = pts[ i ], b = pts[ ( i + 1 ) % m ];
			const edge = b.clone().sub( a );
			const length = edge.length();
			const sideNormal = edge.clone().cross( nrm ).normalize();
			base = p.length / 3;
			p.push( a.x, a.y, a.z, b.x, b.y, b.z, b.x + off.x, b.y + off.y, b.z + off.z, a.x + off.x, a.y + off.y, a.z + off.z );
			for ( let k = 0; k < 4; k ++ ) n.push( sideNormal.x, sideNormal.y, sideNormal.z );
			uv.push( 0, 0, 0, length, thickness, length, thickness, 0 );
			idx.push( base, base + 2, base + 1, base, base + 3, base + 2 );

		}

	}

	return fixWinding( new Part( p, n, uv, idx ) );

}

export function fixWinding( part ) {

	const { p, n, idx } = part;
	for ( let t = 0; t < idx.length; t += 3 ) {

		const i0 = idx[ t ], i1 = idx[ t + 1 ], i2 = idx[ t + 2 ];
		_a.fromArray( p, i0 * 3 ); _b.fromArray( p, i1 * 3 ); _c.fromArray( p, i2 * 3 );
		_b.sub( _a ); _c.sub( _a );
		_b.cross( _c );
		const nx = n[ i0 * 3 ] + n[ i1 * 3 ] + n[ i2 * 3 ];
		const ny = n[ i0 * 3 + 1 ] + n[ i1 * 3 + 1 ] + n[ i2 * 3 + 1 ];
		const nz = n[ i0 * 3 + 2 ] + n[ i1 * 3 + 2 ] + n[ i2 * 3 + 2 ];
		if ( _b.x * nx + _b.y * ny + _b.z * nz < 0 ) {

			idx[ t + 1 ] = i2; idx[ t + 2 ] = i1;

		}

	}

	return part;

}

export function mat4( x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, out = new Matrix4() ) {

	_e.set( rx, ry, rz, 'YXZ' );
	_q.setFromEuler( _e );
	_p.set( x, y, z );
	return out.compose( _p, _q, _s );

}
