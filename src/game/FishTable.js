// Generic calculations over a ThruHold-authored species catalog.
// Catalog records are validated at behavior resolution before gameplay uses them.
export function fishIds( fishCatalog ) {
	return Object.keys( fishCatalog );
}

export function isFishCatalog( fishCatalog ) {
	if ( ! fishCatalog || typeof fishCatalog !== 'object' || Array.isArray( fishCatalog ) ) return false;
	const ids = Object.keys( fishCatalog );
	if ( ids.length < 1 || ids.length > 128 ) return false;
	return ids.every( id => {
		const fish = fishCatalog[ id ];
		return /^[a-z][A-Za-z0-9]*$/.test( id ) && fish && typeof fish === 'object' && ! Array.isArray( fish ) &&
			typeof fish.name === 'string' && fish.name.length > 0 && fish.name.length <= 80 &&
			( fish.sci === undefined || typeof fish.sci === 'string' && fish.sci.length <= 100 ) &&
			Array.isArray( fish.lw ) && fish.lw.length === 2 && fish.lw.every( value => Number.isFinite( value ) && value > 0 ) &&
			typeof fish.model === 'string' && /^[a-zA-Z0-9_-]+$/.test( fish.model ) &&
			fish.habitat && typeof fish.habitat === 'object' && ! Array.isArray( fish.habitat ) && Object.keys( fish.habitat ).length > 0 &&
			Object.entries( fish.habitat ).every( ( [ type, weight ] ) => [ 'shallows', 'reef', 'pier', 'bay', 'deep' ].includes( type ) && Number.isFinite( weight ) && weight >= 0 && weight <= 1 ) &&
			Array.isArray( fish.kg ) && fish.kg.length === 2 && fish.kg.every( value => Number.isFinite( value ) && value > 0 ) && fish.kg[ 0 ] <= fish.kg[ 1 ] &&
			Number.isFinite( fish.price ) && fish.price > 0 && Number.isFinite( fish.fight ) && fish.fight >= 0 && fish.fight <= 1 &&
			Number.isFinite( fish.stamina ) && fish.stamina > 0 && [ 'any', 'day', 'dawnDusk', 'night' ].includes( fish.time ) && Number.isFinite( fish.rarity ) && fish.rarity > 0 && fish.rarity <= 1;
	} );
}

// $ value of a fish; trophy-sized ones fetch a bit more per kg
export function fishValue( fishCatalog, id, kg ) {

	const f = fishCatalog[ id ];
	const t = ( kg - f.kg[ 0 ] ) / Math.max( f.kg[ 1 ] - f.kg[ 0 ], 1e-6 );
	return Math.max( 1, Math.round( f.price * kg * ( 1 + 0.25 * Math.max( 0, t - 0.7 ) / 0.3 ) ) );

}

// total length (cm) of a fish of `kg`, from its species' length-weight relation
export function fishLengthCm( fishCatalog, id, kg ) {

	const [ a, b ] = fishCatalog[ id ].lw;
	return Math.pow( Math.max( kg, 0.001 ) * 1000 / a, 1 / b );

}
