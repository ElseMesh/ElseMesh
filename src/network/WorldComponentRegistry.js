const components = new Map();

export function registerWorldComponent( type, descriptor = {} ) {
	if ( typeof type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( type ) || components.has( type ) || ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || Object.keys( descriptor ).some( key => ! [ 'waterSurface', 'vegetation', 'installRank', 'install' ].includes( key ) ) || descriptor.waterSurface !== undefined && typeof descriptor.waterSurface !== 'boolean' || descriptor.vegetation !== undefined && typeof descriptor.vegetation !== 'boolean' || descriptor.installRank !== undefined && ( ! Number.isInteger( descriptor.installRank ) || descriptor.installRank < 0 || descriptor.installRank > 10 ) || descriptor.install !== undefined && typeof descriptor.install !== 'function' ) {
		throw new Error( `Invalid or duplicate world component registration: ${type}` );
	}
	components.set( type, Object.freeze( { type, waterSurface: descriptor.waterSurface === true, vegetation: descriptor.vegetation === true, installRank: descriptor.installRank ?? 1, install: descriptor.install || null } ) );
}

export function worldComponentDescriptor( type ) {
	return components.get( type ) || null;
}

export function registeredWorldComponents() {
	return [ ...components.keys() ];
}

registerWorldComponent( 'elsemesh.water-body/1', { waterSurface: true } );
registerWorldComponent( 'elsemesh.ambient-audio/1' );
