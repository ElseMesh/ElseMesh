import { CRITTER } from './CritterSpecies.js';
import { qGround, smooth } from './WildlifeMath.js';

const DRAW = 34;

// Converts shared crab and burrow state into instance records for a renderer adapter.
export class CrabPresentation {

	constructor( terrain ) {

		this.terrain = terrain;
		this.record = {
			x: 0, y: 0, z: 0, scale: 1, q: [ 0, 0, 0, 1 ], species: 0, phase: 0, stride: 0, lift: 0, out: 1, eyes: 1, claws: 0, seed: 0,
			px: 0, py: 0, pz: 0, pPhase: 0, pq: [ 0, 0, 0, 1 ],
		};

	}

	write( crabs, focus, batch, blobs ) {

		const r = this.record;
		for ( const burrow of crabs.nearBurrows ) {

			const d = Math.hypot( burrow.x - focus.x, burrow.z - focus.z );
			if ( d > DRAW ) continue;
			this.burrowRecord( burrow, r, smooth( DRAW, DRAW * 0.75, d ) );
			batch.write( r );

		}

		for ( const crab of crabs.ghosts ) if ( crab.visible ) {

			this.crabRecord( crab, r, focus );
			if ( r.scale <= 0 ) continue;
			batch.write( r );
			blobs?.add( crab.x, crab.y, crab.z, r.scale * 0.75, r.scale * ( crab.lift + 0.12 ), smooth( 0.35, 0.8, crab.out ), crab.sx, crab.sz );

		}

		for ( const crab of crabs.hermits ) {

			this.crabRecord( crab, r, focus );
			if ( r.scale <= 0 ) continue;
			batch.write( r );
			blobs?.add( crab.x, crab.y, crab.z, r.scale * 0.8, r.scale * 0.45, 0.9, crab.sx, crab.sz );

		}

	}

	crabRecord( crab, record, focus ) {

		const terrain = this.terrain;
		const d = Math.hypot( crab.x - focus.x, crab.z - focus.z );
		const fadeIn = crab.fade = Math.min( 1, crab.fade + 0.05 );
		record.scale = crab.size * smooth( DRAW, DRAW * 0.72, d ) * fadeIn;
		if ( record.scale <= 0 ) return;
		const y = terrain.heightAt( crab.x, crab.z );
		crab.y = y;
		const e = 0.15;
		const nx = terrain.heightAt( crab.x - e, crab.z ) - terrain.heightAt( crab.x + e, crab.z );
		const nz = terrain.heightAt( crab.x, crab.z - e ) - terrain.heightAt( crab.x, crab.z + e );
		const nl = Math.hypot( nx, 2 * e, nz );
		crab.sx = - nx / ( 2 * e );
		crab.sz = - nz / ( 2 * e );
		for ( let i = 0; i < 4; i ++ ) crab.pq[ i ] = crab.q[ i ];
		qGround( crab.q, crab.bodyYaw, nx / nl, 2 * e / nl, nz / nl );
		if ( crab.fresh ) {

			crab.px = crab.x; crab.py = y; crab.pz = crab.z;
			for ( let i = 0; i < 4; i ++ ) crab.pq[ i ] = crab.q[ i ];
			crab.pPhase = crab.phase;
			crab.fresh = false;

		}

		record.x = crab.x; record.y = y; record.z = crab.z;
		for ( let i = 0; i < 4; i ++ ) { record.q[ i ] = crab.q[ i ]; record.pq[ i ] = crab.pq[ i ]; }
		record.species = crab.species;
		record.phase = crab.phase;
		record.pPhase = crab.pPhase;
		record.stride = crab.stride;
		record.lift = crab.lift;
		record.out = crab.out;
		record.eyes = crab.eyes;
		record.claws = crab.claws;
		record.seed = crab.seed;
		record.px = crab.px; record.py = crab.py; record.pz = crab.pz;
		crab.px = crab.x; crab.py = y; crab.pz = crab.z;

	}

	burrowRecord( burrow, record, fade ) {

		const terrain = this.terrain;
		record.x = burrow.x; record.y = burrow.y; record.z = burrow.z;
		record.scale = 0.05 * burrow.size * fade;
		if ( ! burrow.q ) {

			burrow.q = [ 0, 0, 0, 1 ];
			const e = 0.3;
			const nx = terrain.heightAt( burrow.x - e, burrow.z ) - terrain.heightAt( burrow.x + e, burrow.z );
			const nz = terrain.heightAt( burrow.x, burrow.z - e ) - terrain.heightAt( burrow.x, burrow.z + e );
			const nl = Math.hypot( nx, 2 * e, nz );
			qGround( burrow.q, burrow.yaw, nx / nl, 2 * e / nl, nz / nl );

		}

		for ( let i = 0; i < 4; i ++ ) record.q[ i ] = record.pq[ i ] = burrow.q[ i ];
		record.species = CRITTER.BURROW;
		record.phase = record.pPhase = 0;
		record.stride = 0; record.lift = 0; record.out = 1; record.eyes = 0; record.claws = 0;
		record.seed = burrow.seed;
		record.px = burrow.x; record.py = burrow.y; record.pz = burrow.z;

	}

}
