const profiles = new Map();

export function registerWorldMaterialProfile( profile, roles ) {
	if ( typeof profile !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( profile ) || profiles.has( profile ) || ! Array.isArray( roles ) || roles.length < 1 || roles.length > 64 || roles.some( role => typeof role !== 'string' || ! /^[a-z][A-Za-z0-9]{0,63}$/.test( role ) ) || new Set( roles ).size !== roles.length ) {
		throw new Error( `Invalid or duplicate world material profile: ${profile}` );
	}
	profiles.set( profile, new Set( roles ) );
}

export function worldMaterialRole( material ) {
	const descriptor = material?.extras?.elsemeshMaterial;
	if ( descriptor === undefined ) return null;
	if ( ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) ||
		Object.keys( descriptor ).some( key => key !== 'profile' && key !== 'role' ) ||
		typeof descriptor.profile !== 'string' || ! profiles.get( descriptor.profile )?.has( descriptor.role ) ) {
		throw new Error( 'Unsupported or malformed world material profile' );
	}
	return descriptor.role;
}
