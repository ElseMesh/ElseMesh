// Renderer-neutral dimensions, placements, and physical formulas for the boat.

export const HOUSE = {
	wallT: 0.045,
	wsBottomY: 1.48,
	wsTopY: 2.24,
	roofUnderY: 2.31,
	roofZ0: - 0.95,
	roofZ1: 1.34,
	winBottom: 1.56,
	winTop: 2.12,
	dash: { zFace: 0.98, yKnee: 1.08, zTop: 1.16, yTop: 1.4, zBack: 1.41, halfW: 1.1 },
	helmX: - 0.55,
	seatZ: 0.22,
};

export const TRAP = { L: 0.95, W: 0.55, H: 0.37 };
export const TRAPS = [
	[ 0.66, 0, - 3.25, 0.02, 0xd8b21c ],
	[ 0.66, 1, - 3.23, - 0.03, 0x2f7a3c ],
	[ 0.64, 0, - 2.2, - 0.04, 0xd8b21c ],
	[ - 0.68, 0, - 3.25, 0.03, 0x1f2326 ],
];
export const HAULER = { x: - 1.0, z: - 0.62, y: 1.34 };
export const PROP_SPEC = { position: [ 0, - 0.53, - 3.3 ], radius: 0.21, blades: 4, pitch: 0.42 };
export const RUDDER_SPEC = { pivot: [ 0, - 0.52, - 3.58 ], top: - 0.33, bottom: - 0.72, lead: 0.08, trail: - 0.27, maxAngle: 0.61 };
export const KEEL = { zFront: 3.74, zAft: - 3.05, shoeAft: - 3.68, bottom: - 0.77, shoeTop: - 0.74 };

const KEEL_PROFILE = [ [ 3.74, - 0.093 ], [ 3.3, - 0.2 ], [ 3.0, - 0.265 ], [ 1.5, - 0.5 ], [ 0, - 0.62 ], [ - 1.5, - 0.7 ], [ - 3.05, - 0.77 ] ];
const clamp01 = x => Math.min( 1, Math.max( 0, x ) );
const lerp = ( a, b, t ) => a + ( b - a ) * t;
const sstep = ( a, b, x ) => { const t = clamp01( ( x - a ) / ( b - a ) ); return t * t * ( 3 - 2 * t ); };

export function keelBottomAt( z ) {

	const p = KEEL_PROFILE;
	if ( z >= p[ 0 ][ 0 ] ) return p[ 0 ][ 1 ];
	if ( z <= p[ p.length - 1 ][ 0 ] ) return p[ p.length - 1 ][ 1 ];
	let i = 0;
	while ( i < p.length - 2 && z < p[ i + 1 ][ 0 ] ) i ++;
	const p0 = p[ Math.max( 0, i - 1 ) ], p1 = p[ i ], p2 = p[ i + 1 ], p3 = p[ Math.min( p.length - 1, i + 2 ) ];
	const f = ( p1[ 0 ] - z ) / ( p1[ 0 ] - p2[ 0 ] ), f2 = f * f, f3 = f2 * f;
	return 0.5 * ( 2 * p1[ 1 ] + ( - p0[ 1 ] + p2[ 1 ] ) * f + ( 2 * p0[ 1 ] - 5 * p1[ 1 ] + 4 * p2[ 1 ] - p3[ 1 ] ) * f2 + ( - p0[ 1 ] + 3 * p1[ 1 ] - 3 * p2[ 1 ] + p3[ 1 ] ) * f3 );

}

export function keelVolume( lines ) {

	const n = 240, dz = ( KEEL.zFront - KEEL.zAft ) / n;
	let volume = 0;
	for ( let i = 0; i < n; i ++ ) {
		const z = KEEL.zAft + ( i + 0.5 ) * dz;
		const depth = Math.max( 0, - lines.draftAt( z ) - keelBottomAt( z ) );
		const forward = sstep( 2.6, KEEL.zFront, z );
		volume += ( lerp( 0.065, 0.012, forward ) + lerp( 0.042, 0.008, forward ) ) * depth * dz;
	}
	return volume + 0.075 * ( KEEL.shoeTop - KEEL.bottom ) * ( KEEL.zAft - KEEL.shoeAft );

}

export function houseHalfWidth( lines, z ) {
	return lines.sheerX( lines.tAtSheerZ( z ) ) - 0.2;
}

export function roofTopY( x ) {
	return 2.375 + 0.035 * ( 1 - ( x / 1.35 ) ** 2 );
}
