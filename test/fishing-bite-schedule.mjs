import assert from 'node:assert/strict';
import { fishingBiteRateMultiplierAtHour, validateFishingBiteSchedule } from '../src/game/FishingBiteSchedule.js';

const schedule = validateFishingBiteSchedule( {
	defaultMultiplier: 1,
	windows: [
		{ startHour: 0, endHour: 5, multiplier: 0.8 },
		{ startHour: 5, endHour: 8.1, multiplier: 1.4 },
		{ startHour: 17, endHour: 20.1, multiplier: 1.4 },
		{ startHour: 22, endHour: 24, multiplier: 0.8 },
	],
} );

for ( const [ hour, expected ] of [
	[ 0, 0.8 ], [ 4.9, 0.8 ], [ 5, 1.4 ], [ 8, 1.4 ], [ 8.1, 1 ],
	[ 17, 1.4 ], [ 20, 1.4 ], [ 20.1, 1 ], [ 21.9, 1 ], [ 22, 0.8 ], [ 24, 0.8 ], [ - 1, 0.8 ],
] ) assert.equal( fishingBiteRateMultiplierAtHour( schedule, hour ), expected, `hour ${hour}` );

assert.equal( fishingBiteRateMultiplierAtHour( undefined, 6 ), 1, 'worlds without schedule data use the original neutral rate' );
assert.throws( () => fishingBiteRateMultiplierAtHour( schedule, NaN ), /must be finite/ );
assert.throws( () => validateFishingBiteSchedule( { defaultMultiplier: 0.1, windows: [] } ), /Invalid fishing bite-rate schedule/ );
assert.throws( () => validateFishingBiteSchedule( { defaultMultiplier: 1, windows: [ { startHour: 4, endHour: 6, multiplier: 1 }, { startHour: 5, endHour: 7, multiplier: 1 } ] } ), /Invalid fishing bite-rate schedule window/ );
assert.throws( () => validateFishingBiteSchedule( { defaultMultiplier: 1, windows: [ { startHour: 5.05, endHour: 6, multiplier: 1 } ] } ), /Invalid fishing bite-rate schedule window/ );

console.log( 'fishing bite schedule: ok' );
