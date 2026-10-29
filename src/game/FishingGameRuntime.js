import { GameState } from './GameState.js';
import { startFishingBite, stepFishingBite } from './FishingBiteSimulation.js';
import { isFishCatalog } from './FishTable.js';

// Browser-side fishing rules shared by renderer adapters. This owns game state
// transitions only; world queries, input, visuals, audio and presence stay with
// their respective client systems.
export class FishingGameRuntime {

	constructor( { state, load = true, worldId = 'elsemesh:local', behaviorData = {}, extensions = null } = {} ) {

		this.fishCatalog = behaviorData.fishCatalog || state?.fishCatalog;
		if ( ! isFishCatalog( this.fishCatalog ) ) throw new Error( 'World fishing behavior requires a valid authored fish catalog' );
		this.state = state || new GameState( undefined, worldId, this.fishCatalog );
		if ( load ) this.state.load();
		this.bite = null;
		this.fight = null;
		this.biteRateMultipliers = Array( 240 ).fill( 1 );
		this.extensions = extensions;
		this.fightGeneration = 0;
		this.fightQueue = [];
		this.fightRunning = false;

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
		const result = stepFishingBite( this.bite, dt, { ...context, fishCatalog: this.fishCatalog, biteRateMultiplier } );
		this.bite = result.bite;
		return result;

	}

	async strike( { lineKg, reelSpeed, distance, seed = Math.floor( Math.random() * 0x100000000 ) } ) {

		const bite = this.bite;
		if ( ! bite || bite.phase !== 'take' ) return null;
		const generation = this.fightGeneration;
		this.bite = null;
		let result;
		try {
			result = await this._runExtension( {
				type: 'start-fight', species: bite.species, kg: bite.kg, lineKg, reelSpeed, distance, seed,
			} );
		} catch ( error ) {
			if ( generation === this.fightGeneration ) this.bite = bite;
			throw error;
		}
		if ( generation !== this.fightGeneration ) return null;
		this.fight = result.fight;
		return this.fight;

	}

	stepFight( dt, reeling, timeOfDay ) {

		if ( ! this.fight ) return Promise.resolve( { state: null, fight: null } );
		if ( ! Number.isFinite( dt ) || dt < 0 || dt > 1 || typeof reeling !== 'boolean' ) return Promise.reject( new Error( 'Invalid fishing fight step' ) );
		if ( this.fightQueue.length >= 64 ) return Promise.reject( new Error( 'Fishing fight worker is behind by more than 64 frames' ) );
		return new Promise( ( resolve, reject ) => {
			this.fightQueue.push( { dt, reeling, timeOfDay, generation: this.fightGeneration, resolve, reject } );
			this._pumpFightQueue();
		} );

	}

	async _runExtension( event ) {
		if ( ! this.extensions?.has?.( 'elsemesh.fishing-game/1' ) ) throw new Error( 'Fishing behavior requires its signed JavaScript extension' );
		await this.extensionReady;
		return this.extensions.run( 'elsemesh.fishing-game/1', event );
	}

	async _pumpFightQueue() {
		if ( this.fightRunning || ! this.fightQueue.length ) return;
		this.fightRunning = true;
		const batch = this.fightQueue.splice( 0, 32 );
		const generation = batch[ 0 ].generation;
		try {
			const response = await this._runExtension( { type: 'step-fight', steps: batch.map( ( { dt, reeling } ) => ( { dt, reeling } ) ) } );
			const results = response.results;
			let ended = false;
			for ( let index = 0; index < batch.length; index ++ ) {
				const request = batch[ index ];
				if ( request.generation !== this.fightGeneration || generation !== this.fightGeneration ) { request.resolve( { state: null, fight: null } ); continue; }
				const result = results[ index ];
				if ( ! result ) { request.resolve( { state: null, fight: null } ); continue; }
				if ( result.state === 'fighting' ) {
					result.fight._splashed = this.fight?._splashed || false;
					this.fight = result.fight;
				} else this.fight = null;
				if ( result.state !== 'fighting' ) ended = true;
				if ( result.state === 'caught' ) {
					const entry = this.state.addFish( result.fight.species, result.fight.kg, request.timeOfDay );
					request.resolve( { ...result, entry, catchInfo: this.state.lastCatch } );
				} else request.resolve( result );
			}
			if ( ended ) for ( const request of this.fightQueue.splice( 0 ) ) request.resolve( { state: null, fight: null } );
		} catch ( error ) {
			for ( const request of batch ) request.reject( error );
		} finally {
			this.fightRunning = false;
			this._pumpFightQueue();
		}
	}

	cancel() {

		this.fightGeneration ++;
		this.bite = null;
		this.fight = null;
		for ( const request of this.fightQueue.splice( 0 ) ) request.resolve( { state: null, fight: null } );
		this._runExtension( { type: 'cancel' } ).catch( () => {} );

	}

}
