import { biteDelay, pickSpecies, rollWeight } from './Bites.js';

// Renderer-neutral bite phases shared by each presentation backend. The caller
// supplies the world-derived habitat and time, while visuals/audio consume the
// returned dip and event values.
export function startFishingBite( habitat, hour, rng = Math.random ) {
	return { phase: 'wait', t: biteDelay( habitat, hour, rng ) };
}

export function stepFishingBite( bite, dt, { fishCatalog, habitat, hour, rng = Math.random, dip = 0, biteRateMultiplier = 1 } ) {
	if ( ! bite ) return { bite: null, dip, event: null };
	if ( typeof habitat !== 'function' || ! Number.isFinite( dt ) || dt < 0 || ! Number.isFinite( hour ) || ! Number.isFinite( dip ) || ! Number.isFinite( biteRateMultiplier ) || biteRateMultiplier < 0.5 || biteRateMultiplier > 2 ) throw new Error( 'Invalid fishing bite step' );

	bite.t -= dt * ( bite.phase === 'wait' ? biteRateMultiplier : 1 );
	if ( bite.phase === 'nibble' ) dip = Math.max( 0, Math.sin( Math.min( 1, bite.pulse || 0 ) * Math.PI ) * 0.45 );
	else if ( bite.phase === 'take' ) dip += ( 1.4 - dip ) * ( 1 - Math.exp( - dt * 14 ) );
	else dip = Math.max( 0, dip - dt * 3 );
	if ( bite.phase === 'nibble' ) bite.pulse = ( bite.pulse || 0 ) + dt * 3.2;
	if ( bite.t > 0 ) return { bite, dip, event: null };

	if ( bite.phase === 'wait' ) {
		const species = pickSpecies( fishCatalog, habitat(), hour, rng );
		if ( ! species ) {
			bite.t = 8;
			return { bite, dip, event: null };
		}
		bite.species = species;
		bite.kg = rollWeight( fishCatalog, species, rng );
		bite.phase = 'nibble';
		bite.nibbles = 1 + Math.floor( rng() * 3 );
		bite.t = 0.7 + rng() * 0.8;
		bite.pulse = 0;
		return { bite, dip, event: null };
	}

	if ( bite.phase === 'nibble' ) {
		bite.nibbles --;
		bite.pulse = 0;
		if ( bite.nibbles > 0 ) bite.t = 0.6 + rng() * 1.0;
		else {
			bite.phase = 'take';
			bite.t = 2.4 - fishCatalog[ bite.species ].fight * 0.5;
			return { bite, dip, event: 'take' };
		}
		return { bite, dip, event: null };
	}

	if ( bite.phase === 'take' ) return { bite: startFishingBite( habitat(), hour, rng ), dip, event: 'escaped' };
	throw new Error( `Unknown fishing bite phase: ${bite.phase}` );
}
