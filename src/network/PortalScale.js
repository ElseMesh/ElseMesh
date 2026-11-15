export const PORTAL_SCALE_RATIO_MIN = 0.001;
export const PORTAL_SCALE_RATIO_MAX = 1000;

// Scale is a bounded, positive destination-units-per-source-unit multiplier.
export function portalScaleRatio( value = 1 ) {
	if ( ! Number.isFinite( value ) || value < PORTAL_SCALE_RATIO_MIN || value > PORTAL_SCALE_RATIO_MAX ) throw new Error( 'Invalid portal scale ratio' );
	return value;
}
