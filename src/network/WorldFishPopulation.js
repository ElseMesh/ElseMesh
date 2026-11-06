const populations = new Map();
const ZONE_KINDS = new Set( [ 'reef', 'drop-off', 'circle', 'pier-end', 'pier-piles', 'point' ] );

function validZone( zone ) {

	if ( ! zone || typeof zone !== 'object' || Array.isArray( zone ) || ! ZONE_KINDS.has( zone.kind ) ) return false;
	if ( zone.kind === 'reef' ) return zone.radiusScale === undefined || Number.isFinite( zone.radiusScale ) && zone.radiusScale > 0 && zone.radiusScale <= 10;
	if ( zone.kind === 'drop-off' ) return Number.isFinite( zone.radius ) && zone.radius > 0 && zone.radius <= 1000000;
	if ( zone.kind === 'circle' ) return Array.isArray( zone.center ) && zone.center.length === 2 && zone.center.every( Number.isFinite ) && Number.isFinite( zone.radius ) && zone.radius > 0 && zone.radius <= 1000000;
	if ( zone.kind === 'pier-end' ) return Array.isArray( zone.offset ) && zone.offset.length === 2 && zone.offset.every( Number.isFinite ) && Number.isFinite( zone.radius ) && zone.radius > 0 && zone.radius <= 1000000;
	if ( zone.kind === 'pier-piles' ) return [ zone.radius, zone.walkStart, zone.walkSpacing, zone.sideOffset, zone.headInset, zone.headColumns, zone.edgeInset, zone.minDepth, zone.homeRadius ].every( Number.isFinite ) && zone.radius > 0 && zone.radius <= 1000000 && zone.walkSpacing > 0 && zone.headColumns >= 2 && Number.isInteger( zone.headColumns ) && zone.minDepth >= 0 && zone.homeRadius > 0;
	return Array.isArray( zone.center ) && zone.center.length === 2 && zone.center.every( Number.isFinite ) && Number.isFinite( zone.radius ) && zone.radius > 0 && Array.isArray( zone.band ) && zone.band.length === 2;

}

function validGroups( groups ) {

	if ( ! Array.isArray( groups ) || groups.length > 128 ) return false;
	let total = 0;
	for ( const group of groups ) {
		if ( ! group || typeof group !== 'object' || Array.isArray( group ) || Object.keys( group ).some( key => ! [ 'school', 'counts', 'zone', 'zones', 'anchored', 'path', 'direct', 'collect', 'pilesNearHome' ].includes( key ) ) ) return false;
		if ( typeof group.school !== 'string' || ! /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test( group.school ) || ! Array.isArray( group.counts ) || ! group.counts.length || group.counts.length > 64 || group.counts.some( count => ! Number.isInteger( count ) || count < 1 || count > 10000 ) ) return false;
		if ( group.zone !== undefined && ! validZone( group.zone ) ) return false;
		if ( group.zones !== undefined && ( ! Array.isArray( group.zones ) || group.zones.length !== group.counts.length || group.zones.some( zone => ! validZone( zone ) ) ) ) return false;
		if ( ( group.zone === undefined ) === ( group.zones === undefined ) || group.anchored !== undefined && typeof group.anchored !== 'boolean' || group.path !== undefined && typeof group.path !== 'boolean' || group.direct !== undefined && typeof group.direct !== 'boolean' || group.pilesNearHome !== undefined && typeof group.pilesNearHome !== 'boolean' ) return false;
		if ( group.collect !== undefined && ! [ 'baitGroups', 'escort' ].includes( group.collect ) ) return false;
		if ( group.direct && group.zone?.kind !== 'point' ) return false;
		total += group.counts.reduce( ( sum, count ) => sum + count, 0 );
		if ( total > 10000 ) return false;
	}
	return true;

}

export function registerWorldFishPopulation( behaviorId, population ) {

	if ( typeof behaviorId !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( behaviorId ) || populations.has( behaviorId ) || ! population || typeof population !== 'object' || Array.isArray( population ) || Object.keys( population ).some( key => ! [ 'groups', 'bayGroups' ].includes( key ) ) || ! validGroups( population.groups ) || ! validGroups( population.bayGroups || [] ) ) throw new Error( 'Invalid or duplicate world fish-population registration' );
	populations.set( behaviorId, Object.freeze( population ) );

}

export function worldFishPopulationFor( experience ) {

	const behaviors = experience?.behaviors;
	if ( ! behaviors || typeof behaviors !== 'object' || Array.isArray( behaviors ) ) return null;
	const matches = [ ...populations ].filter( ( [ id ] ) => Object.hasOwn( behaviors, id ) ).map( ( [ , population ] ) => population );
	if ( matches.length > 1 ) throw new Error( 'World experience declares multiple fish-population profiles' );
	return matches[ 0 ] || null;

}
