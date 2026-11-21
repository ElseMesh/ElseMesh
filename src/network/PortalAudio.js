const clamp = ( value, min, max ) => Math.max( min, Math.min( max, value ) );

// Open-world ambience becomes audible inside the portal approach radius and
// reaches full gain close to the aperture. SoundScape smooths gain changes.
export function portalAudioProximityGain( distance, { fullGainDistance = 2, fadeDistance = 24 } = {} ) {
	if ( ! Number.isFinite( distance ) || ! Number.isFinite( fullGainDistance ) || ! Number.isFinite( fadeDistance ) || fullGainDistance < 0 || fadeDistance <= fullGainDistance ) return 0;
	const t = clamp( ( distance - fullGainDistance ) / ( fadeDistance - fullGainDistance ), 0, 1 );
	return 1 - t * t * ( 3 - 2 * t );
}
