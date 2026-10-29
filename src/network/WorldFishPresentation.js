// Renderer data is registered by the world package that authors it. The engine only
// discovers a profile when the active experience declares its registering behavior.
const profiles = new Map();

export function registerWorldFishPresentation( behaviorId, profile ) {
	if ( typeof behaviorId !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( behaviorId ) || profiles.has( behaviorId ) ) throw new Error( 'Invalid or duplicate world fish-presentation registration' );
	if ( ! profile || typeof profile !== 'object' || Array.isArray( profile ) || ! profile.PATTERN || ! profile.SPECIES || ! profile.SKIN || Object.keys( profile ).some( key => ! [ 'PATTERN', 'SPECIES', 'SKIN' ].includes( key ) ) ) throw new Error( 'Invalid world fish-presentation profile' );
	const names = Object.keys( profile.PATTERN );
	if ( ! names.length || names.length > 64 || names.some( name => ! Object.hasOwn( profile.SPECIES, name ) || ! Object.hasOwn( profile.SKIN, name ) ) || Object.keys( profile.SPECIES ).length !== names.length || Object.keys( profile.SKIN ).length !== names.length ) throw new Error( 'Invalid world fish-presentation profile tables' );
	const ids = names.map( name => profile.PATTERN[ name ] );
	if ( ids.some( id => ! Number.isInteger( id ) || id < 0 || id >= names.length ) || new Set( ids ).size !== ids.length || names.some( name => profile.SPECIES[ name ].pattern !== profile.PATTERN[ name ] ) ) throw new Error( 'Invalid world fish-presentation pattern table' );
	profiles.set( behaviorId, profile );
}

export function worldFishPresentationFor( experience ) {
	const behaviors = experience?.behaviors;
	if ( ! behaviors || typeof behaviors !== 'object' || Array.isArray( behaviors ) ) return null;
	const matches = [ ...profiles ].filter( ( [ id ] ) => Object.hasOwn( behaviors, id ) ).map( ( [ , profile ] ) => profile );
	if ( matches.length > 1 ) throw new Error( 'World experience declares multiple fish-presentation profiles' );
	return matches[ 0 ] || null;
}
