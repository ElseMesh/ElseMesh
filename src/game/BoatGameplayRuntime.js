import { fuelBurn } from './Gear.js';

// Browser-owned boat game rules shared by the WebGPU and WebGL presentations.
// The world server receives resulting avatar poses through presence; it does
// not simulate the local boat or decide fuel/sonar gameplay.
export class BoatGameplayRuntime {

	constructor( { state, controller = null, terrain = null, habitatAt = () => ( {} ), onFuelOut = null } = {} ) {

		if ( ! state ) throw new Error( 'Boat gameplay requires game state' );
		this.state = state;
		this.terrain = terrain;
		this.habitatAt = habitatAt;
		this.onFuelOut = onFuelOut;
		this._sonarTimer = 0;
		this._sonar = null;
		this._wasDriven = false;
		this._fuelOut = false;
		this.setController( controller );

	}

	setController( controller ) {

		this.controller = controller;
		this._base = controller ? { maxThrust: controller.maxThrust, pitchSpeed: controller.pitchSpeed } : null;
		this.applyGear();

	}

	setTerrain( terrain ) { this.terrain = terrain; }

	applyGear() {

		if ( ! this.controller || ! this._base ) return;
		const speed = this.state.stats.speedMul;
		this.controller.maxThrust = this._base.maxThrust * speed * speed;
		this.controller.pitchSpeed = this._base.pitchSpeed * speed;

	}

	refueled() { this._fuelOut = false; }

	step( dt, playerMode = 'walk' ) {

		const boat = this.controller, state = this.state;
		if ( boat?.driven ) {
			if ( state.burn( fuelBurn( boat.rpm ) * dt ) <= 0 ) {
				boat.throttle = 0;
				if ( ! this._fuelOut ) this.onFuelOut?.();
				this._fuelOut = true;
			}
		} else if ( this._wasDriven ) state.save();
		this._wasDriven = !! boat?.driven;

		const aboard = playerMode === 'boat' || playerMode === 'deck';
		if ( aboard && state.stats.finder && boat && this.terrain ) {
			this._sonarTimer -= dt;
			if ( this._sonarTimer <= 0 ) {
				this._sonarTimer = 0.5;
				const { x, z } = boat.position;
				const depth = Math.max( 0, - this.terrain.heightAt( x, z ) );
				const habitat = this.habitatAt( x, z, depth );
				const richness = Object.values( habitat ).reduce( ( sum, value ) => sum + value, 0 );
				this._sonar = { depth, fish: Math.min( 1, richness / 1.4 ) };
			}
		} else if ( ! aboard || ! state.stats.finder ) this._sonar = null;

		return {
			fuel: aboard ? { litres: state.fuelL, tank: state.stats.fuelL } : null,
			sonar: aboard && state.stats.finder ? this._sonar : null,
		};

	}

}
