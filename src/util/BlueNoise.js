/** Mitchell best-candidate blue noise on a square torus. */
export const MAX_BLUE_NOISE_POINTS = 4096;

export function bestCandidateBlueNoise( random, count, size, candidatesPerPoint = 10 ) {
	if ( typeof random !== 'function' || ! Number.isInteger( count ) || count < 0 || count > MAX_BLUE_NOISE_POINTS || ! Number.isFinite( size ) || size <= 0 || ! Number.isInteger( candidatesPerPoint ) || candidatesPerPoint < 1 || candidatesPerPoint > 64 ) throw new Error( 'Invalid blue-noise placement settings' );
	const points = [];
	for ( let index = 0; index < count; index ++ ) {
		let best = null, bestDistance = - 1;
		for ( let candidate = 0; candidate < ( index === 0 ? 1 : candidatesPerPoint ); candidate ++ ) {
			const x = random() * size, z = random() * size;
			let minimumDistance = Infinity;
			for ( const point of points ) {
				let dx = Math.abs( point[ 0 ] - x ), dz = Math.abs( point[ 1 ] - z );
				dx = Math.min( dx, size - dx );
				dz = Math.min( dz, size - dz );
				minimumDistance = Math.min( minimumDistance, dx * dx + dz * dz );
			}
			if ( minimumDistance > bestDistance ) {
				bestDistance = minimumDistance;
				best = [ x, z ];
			}
		}
		points.push( best );
	}
	return points;
}
