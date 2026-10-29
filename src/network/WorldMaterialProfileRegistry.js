const profiles = new Map();


export function registerWorldMaterialProfile( profile, descriptor ) {
	const roles = descriptor?.roles, maps = descriptor?.maps ?? [];
	if ( typeof profile !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( profile ) || profiles.has( profile ) ||
		! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || Object.keys( descriptor ).some( key => ! [ 'roles', 'maps' ].includes( key ) ) ||
		! Array.isArray( roles ) || roles.length < 1 || roles.length > 64 || roles.some( role => typeof role !== 'string' || ! /^[a-z][A-Za-z0-9]{0,63}$/.test( role ) ) || new Set( roles ).size !== roles.length ||
		! Array.isArray( maps ) || maps.length > 128 || maps.some( map => !map || typeof map.name !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test( map.name ) || !Number.isInteger( map.width ) || map.width < 1 || map.width > 4096 || !Number.isInteger( map.height ) || map.height < 1 || map.height > 4096 || !Array.isArray( map.tileMeters ) || map.tileMeters.length !== 2 || map.tileMeters.some( value => !Number.isFinite( value ) || value <= 0 ) || !Array.isArray( map.channels ) || map.channels.length < 1 || map.channels.length > 4 || map.channels.some( channel => typeof channel !== 'string' || channel.length > 64 ) ) || new Set( maps.map( map => map.name ) ).size !== maps.length ) {
		throw new Error( `Invalid or duplicate world material profile: ${profile}` );
	}
	const normalizedMaps = maps.map( map => Object.freeze( {
		...map,
		tileMeters: Object.freeze( [ ...map.tileMeters ] ),
		channels: Object.freeze( [ ...map.channels ] ),
	} ) );
	profiles.set( profile, Object.freeze( { roles: new Set( roles ), maps: Object.freeze( normalizedMaps ) } ) );
}

export function worldMaterialRole( material ) {
	const descriptor = material?.extras?.elsemeshMaterial;
	if ( descriptor === undefined ) return null;
	if ( ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) ||
		Object.keys( descriptor ).some( key => key !== 'profile' && key !== 'role' ) ||
		typeof descriptor.profile !== 'string' || ! profiles.get( descriptor.profile )?.roles.has( descriptor.role ) ) {
		throw new Error( 'Unsupported or malformed world material profile' );
	}
	return descriptor.role;
}

export function worldMaterialProfile( profile ) {
	const registered = profiles.get( profile );
	return registered ? Object.freeze( { profile, roles: Object.freeze( [ ...registered.roles ] ), maps: registered.maps } ) : null;
}
