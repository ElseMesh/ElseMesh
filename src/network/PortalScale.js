// Scale is a positive destination-units-per-source-unit multiplier. Require a
// finite reciprocal so the inverse route remains representable by IEEE-754.
export function portalScaleRatio( value = 1 ) {
	if ( ! Number.isFinite( value ) || value <= 0 || ! Number.isFinite( 1 / value ) ) throw new Error( 'Invalid portal scale ratio' );
	return value;
}

export function portalPositionInBounds( position ) {
	if ( ! [ position.x, position.y, position.z ].every( value => Number.isFinite( value ) && Math.abs( value ) <= 100000 ) ) throw new Error( 'Mapped portal position is outside world bounds' );
	return position;
}
