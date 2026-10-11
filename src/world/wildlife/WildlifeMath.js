// CPU-only helpers shared by wildlife simulation and its presentation adapters.
// This module must not import the engine, GPU resources, or renderer code.
export const TAU = Math.PI * 2;

export const clamp = ( x, a, b ) => x < a ? a : x > b ? b : x;
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
export const smooth = ( a, b, x ) => {
	const t = clamp( ( x - a ) / ( b - a ), 0, 1 );
	return t * t * ( 3 - 2 * t );
};

// shortest signed angle a - b
export const angleDiff = ( a, b ) => {
	let d = ( a - b ) % TAU;
	if ( d > Math.PI ) d -= TAU;
	else if ( d < - Math.PI ) d += TAU;
	return d;
};

// exponential approach factor for a rate (1/s)
export const approach = ( rate, dt ) => 1 - Math.exp( - rate * dt );

// q = [ x, y, z, w ]
export function qAxis( out, ax, ay, az, angle ) {

	const s = Math.sin( angle / 2 );
	out[ 0 ] = ax * s; out[ 1 ] = ay * s; out[ 2 ] = az * s; out[ 3 ] = Math.cos( angle / 2 );
	return out;

}

// out = a * b
export function qMul( out, a, b ) {

	const ax = a[ 0 ], ay = a[ 1 ], az = a[ 2 ], aw = a[ 3 ];
	const bx = b[ 0 ], by = b[ 1 ], bz = b[ 2 ], bw = b[ 3 ];
	out[ 0 ] = ax * bw + aw * bx + ay * bz - az * by;
	out[ 1 ] = ay * bw + aw * by + az * bx - ax * bz;
	out[ 2 ] = az * bw + aw * bz + ax * by - ay * bx;
	out[ 3 ] = aw * bw - ax * bx - ay * by - az * bz;
	return out;

}

const _qa = [ 0, 0, 0, 1 ], _qb = [ 0, 0, 0, 1 ];
export function qYawPitchRoll( out, yaw, pitch, roll ) {

	qAxis( out, 0, 1, 0, yaw );
	qMul( out, out, qAxis( _qa, 1, 0, 0, - pitch ) );
	return qMul( out, out, qAxis( _qb, 0, 0, 1, roll ) );

}

export function qRotate( out, q, x, y, z ) {

	const qx = q[ 0 ], qy = q[ 1 ], qz = q[ 2 ], qw = q[ 3 ];
	const tx = 2 * ( qy * z - qz * y ), ty = 2 * ( qz * x - qx * z ), tz = 2 * ( qx * y - qy * x );
	out[ 0 ] = x + qw * tx + qy * tz - qz * ty;
	out[ 1 ] = y + qw * ty + qz * tx - qx * tz;
	out[ 2 ] = z + qw * tz + qx * ty - qy * tx;
	return out;

}

// Quaternion mapping local +y to the ground normal and local +z toward yaw.
export function qGround( out, yaw, nx, ny, nz ) {

	// cross(normal, heading) gives local +x; normalize it before completing the basis.
	let x0 = ny * Math.cos( yaw ), x1 = nz * Math.sin( yaw ) - nx * Math.cos( yaw ), x2 = - ny * Math.sin( yaw );
	let xl = Math.hypot( x0, x1, x2 );
	if ( xl < 1e-10 ) { x0 = Math.cos( yaw ); x1 = 0; x2 = - Math.sin( yaw ); xl = 1; }
	x0 /= xl; x1 /= xl; x2 /= xl;
	const z0 = x1 * nz - x2 * ny, z1 = x2 * nx - x0 * nz, z2 = x0 * ny - x1 * nx;
	const m11 = x0, m12 = nx, m13 = z0, m21 = x1, m22 = ny, m23 = z1, m31 = x2, m32 = nz, m33 = z2;
	const trace = m11 + m22 + m33;
	if ( trace > 0 ) {
		const s = 0.5 / Math.sqrt( trace + 1 );
		out[ 3 ] = 0.25 / s; out[ 0 ] = ( m32 - m23 ) * s; out[ 1 ] = ( m13 - m31 ) * s; out[ 2 ] = ( m21 - m12 ) * s;
	} else if ( m11 > m22 && m11 > m33 ) {
		const s = 2 * Math.sqrt( 1 + m11 - m22 - m33 );
		out[ 3 ] = ( m32 - m23 ) / s; out[ 0 ] = 0.25 * s; out[ 1 ] = ( m12 + m21 ) / s; out[ 2 ] = ( m13 + m31 ) / s;
	} else if ( m22 > m33 ) {
		const s = 2 * Math.sqrt( 1 + m22 - m11 - m33 );
		out[ 3 ] = ( m13 - m31 ) / s; out[ 0 ] = ( m12 + m21 ) / s; out[ 1 ] = 0.25 * s; out[ 2 ] = ( m23 + m32 ) / s;
	} else {
		const s = 2 * Math.sqrt( 1 + m33 - m11 - m22 );
		out[ 3 ] = ( m21 - m12 ) / s; out[ 0 ] = ( m13 + m31 ) / s; out[ 1 ] = ( m23 + m32 ) / s; out[ 2 ] = 0.25 * s;
	}
	return out;

}
