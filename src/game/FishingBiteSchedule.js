const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 2;
const MAX_WINDOWS = 16;

function isHourTenth( value ) {
	return Number.isFinite( value ) && value >= 0 && value <= 24 && Math.abs( value * 10 - Math.round( value * 10 ) ) < 1e-8;
}

export function validateFishingBiteSchedule( schedule ) {
	if ( schedule === undefined ) return undefined;
	if ( ! schedule || typeof schedule !== 'object' || Array.isArray( schedule ) || Object.keys( schedule ).some( key => ! [ 'defaultMultiplier', 'windows' ].includes( key ) ) || ! Number.isFinite( schedule.defaultMultiplier ) || schedule.defaultMultiplier < MIN_MULTIPLIER || schedule.defaultMultiplier > MAX_MULTIPLIER || ! Array.isArray( schedule.windows ) || schedule.windows.length > MAX_WINDOWS ) throw new Error( 'Invalid fishing bite-rate schedule' );
	let previousEnd = - 1;
	for ( const window of schedule.windows ) {
		if ( ! window || typeof window !== 'object' || Array.isArray( window ) || Object.keys( window ).some( key => ! [ 'startHour', 'endHour', 'multiplier' ].includes( key ) ) || ! isHourTenth( window.startHour ) || ! isHourTenth( window.endHour ) || window.startHour >= window.endHour || window.startHour < previousEnd || ! Number.isFinite( window.multiplier ) || window.multiplier < MIN_MULTIPLIER || window.multiplier > MAX_MULTIPLIER ) throw new Error( 'Invalid fishing bite-rate schedule window' );
		previousEnd = window.endHour;
	}
	return schedule;
}

export function fishingBiteRateMultiplierAtHour( schedule, hour ) {
	if ( ! Number.isFinite( hour ) ) throw new Error( 'Fishing time of day must be finite' );
	if ( schedule === undefined ) return 1;
	const normalizedHour = ( hour % 24 + 24 ) % 24;
	const hourTenth = Math.floor( normalizedHour * 10 );
	for ( const window of schedule.windows ) if ( hourTenth >= window.startHour * 10 && hourTenth < window.endHour * 10 ) return window.multiplier;
	return schedule.defaultMultiplier;
}
