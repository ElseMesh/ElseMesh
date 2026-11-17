// Engine-wide shadow coverage. Renderer adapters translate these view-distance
// boundaries and update cadence to their native shadow-map implementation.
export const SUN_SHADOW_PROFILE = Object.freeze( {
	mapSize: 2048,
	cascadeDistances: Object.freeze( [ 10, 60, 400 ] ),
	updatePeriods: Object.freeze( [ 1, 2, 4 ] ),
	lightMargin: 200,
	normalBias: Object.freeze( [ 0.015, 0.06, 0.3 ] ),
	bias: 0.00002,
} );
