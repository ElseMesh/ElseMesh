// Shared renderer-neutral atmosphere values used before a world supplies live weather.
const windLength = Math.hypot( 0.35, 0.94 );
const sunLength = Math.hypot( 0.3, 0.6, - 0.7 );

export const DEFAULT_ENVIRONMENT = Object.freeze( {
	seaLevel: 0,
	sunDirection: Object.freeze( [ 0.3 / sunLength, 0.6 / sunLength, - 0.7 / sunLength ] ),
	night: 0,
	windDirection: Object.freeze( [ 0.35 / windLength, 0.94 / windLength ] ),
	windSpeed: 7,
} );
