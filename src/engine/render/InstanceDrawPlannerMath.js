function smoothstep( start, end, value ) {
	const t = Math.max( 0, Math.min( 1, ( value - start ) / ( end - start ) ) );
	return t * t * ( 3 - 2 * t );
}

// Keep one authored detail step ahead of the screen-size target so the
// nearest-first queues can refine nearby content before it is strictly needed.
// Sustained-load bias cancels this headroom before requesting extra detail.
export const STREAMING_DETAIL_HEADROOM = 1;

/** Write a transformed model-space sphere into [centerX, centerY, centerZ, radius, maxScale]. */
export function writeTransformedInstanceSphere( target, position, rotation, scale, bounds ) {
	const [ sx, sy, sz ] = scale, [ qx, qy, qz, qw ] = rotation;
	const localX = bounds.center[ 0 ] * sx, localY = bounds.center[ 1 ] * sy, localZ = bounds.center[ 2 ] * sz;
	const tx = 2 * ( qy * localZ - qz * localY ), ty = 2 * ( qz * localX - qx * localZ ), tz = 2 * ( qx * localY - qy * localX );
	target[ 0 ] = position[ 0 ] + localX + qw * tx + ( qy * tz - qz * ty );
	target[ 1 ] = position[ 1 ] + localY + qw * ty + ( qz * tx - qx * tz );
	target[ 2 ] = position[ 2 ] + localZ + qw * tz + ( qx * ty - qy * tx );
	target[ 3 ] = bounds.radius * Math.max( sx, sy, sz );
	target[ 4 ] = Math.max( sx, sy, sz );
	return target;
}

/** Write the shared LOD result as [lodIndex, transitionIndex, transitionFade, lodMeasure]. */
export function writeInstanceLODSelection( target, lodMetric, distance, radius, scale, tanHalfFov, thresholds, fadeFraction, renderLoadBias ) {
	const loadScale = 2 ** renderLoadBias;
	const baseMeasure = lodMetric === 'projected-radius'
		? radius / ( Math.max( distance, 1e-6 ) * tanHalfFov )
		: distance / scale;
	const lodMeasure = lodMetric === 'projected-radius' ? baseMeasure / loadScale : baseMeasure * loadScale;
	let transition = -1;
	for ( let thresholdIndex = 0; thresholdIndex < thresholds.length; thresholdIndex ++ ) {
		const threshold = thresholds[ thresholdIndex ];
		const fadeStart = threshold * ( 1 - fadeFraction );
		if ( lodMetric === 'projected-radius' ? lodMeasure < threshold && lodMeasure >= fadeStart : lodMeasure >= threshold && lodMeasure < threshold / ( 1 - fadeFraction ) ) { transition = thresholdIndex; break; }
	}
	if ( transition >= 0 ) {
		const threshold = thresholds[ transition ];
		const fadeStart = lodMetric === 'projected-radius' ? threshold * ( 1 - fadeFraction ) : threshold / ( 1 - fadeFraction );
		target[ 0 ] = transition;
		target[ 1 ] = transition;
		target[ 2 ] = lodMetric === 'projected-radius'
			? ( lodMeasure - fadeStart ) / ( threshold - fadeStart )
			: ( fadeStart - lodMeasure ) / ( fadeStart - threshold );
	} else {
		let lodIndex = 0;
		while ( lodIndex < thresholds.length && ( lodMetric === 'projected-radius' ? lodMeasure >= thresholds[ lodIndex ] : lodMeasure < thresholds[ lodIndex ] ) ) lodIndex ++;
		target[ 0 ] = lodIndex;
		target[ 1 ] = -1;
		target[ 2 ] = 1;
	}
	target[ 3 ] = lodMeasure;
	return target;
}

/** Write [fade, enabled] for the shared model draw-distance fade policy. */
export function writeInstanceDrawDistanceFade( target, fadeStartDistance, drawMaxDistance, distance ) {
	const enabled = fadeStartDistance < drawMaxDistance;
	target[ 0 ] = enabled ? 1 - smoothstep( fadeStartDistance, drawMaxDistance, distance ) : 1;
	target[ 1 ] = enabled ? 1 : 0;
	return target;
}
