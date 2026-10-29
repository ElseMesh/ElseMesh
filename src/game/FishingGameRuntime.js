import { CatchMinigame } from './CatchMinigame.js';
import { GameState } from './GameState.js';
import { startFishingBite, stepFishingBite } from './FishingBiteSimulation.js';

// Browser-side fishing rules shared by renderer adapters. This owns game state
// transitions only; world queries, input, visuals, audio and presence stay with
// their respective client systems.
export class FishingGameRuntime {

	constructor( { state, load = true, worldId = 'elsemesh:local' } = {} ) {

		this.state = state || new GameState( undefined, worldId );
		if ( load ) this.state.load();
		this.bite = null;
		this.fight = null;
		this.biteRateMultipliers = Array( 240 ).fill( 1 );

	}

	setBiteRateMultipliers( multipliers ) {

		if ( ! Array.isArray( multipliers ) || multipliers.length !== 240 || multipliers.some( value => ! Number.isFinite( value ) || value < 0.5 || value > 2 ) ) throw new Error( 'Invalid world-provided fishing rate table' );
		this.biteRateMultipliers = multipliers.slice();

	}

	startBite( habitat, hour, rng ) {

		this.bite = startFishingBite( habitat, hour, rng );
		return this.bite;

	}

	stepBite( dt, context ) {

		const hour = ( context.hour % 24 + 24 ) % 24;
		const biteRateMultiplier = this.biteRateMultipliers[ Math.min( 239, Math.floor( hour * 10 ) ) ];
		const result = stepFishingBite( this.bite, dt, { ...context, biteRateMultiplier } );
		this.bite = result.bite;
		return result;

	}

	strike( { lineKg, reelSpeed, distance } ) {

		const bite = this.bite;
		if ( ! bite || bite.phase !== 'take' ) return null;
		this.fight = new CatchMinigame( { species: bite.species, kg: bite.kg, lineKg, reelSpeed, distance } );
		this.bite = null;
		return this.fight;

	}

	stepFight( dt, reeling, timeOfDay ) {

		if ( ! this.fight ) return { state: null, fight: null };
		const fight = this.fight;
		const state = fight.update( dt, reeling );
		if ( state === 'fighting' ) return { state, fight };

		this.fight = null;
		if ( state === 'caught' ) {

			const entry = this.state.addFish( fight.species, fight.kg, timeOfDay );
			return { state, fight, entry, catchInfo: this.state.lastCatch };

		}

		return { state, fight };

	}

	cancel() {

		this.bite = null;
		this.fight = null;

	}

}
