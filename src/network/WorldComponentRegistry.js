const components = new Map();

export function registerWorldComponent( type, descriptor = {} ) {
	if ( typeof type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( type ) || components.has( type ) || ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || Object.keys( descriptor ).some( key => ! [ 'waterSurface', 'installRank' ].includes( key ) ) || descriptor.waterSurface !== undefined && typeof descriptor.waterSurface !== 'boolean' || descriptor.installRank !== undefined && ( ! Number.isInteger( descriptor.installRank ) || descriptor.installRank < 0 || descriptor.installRank > 10 ) ) {
		throw new Error( `Invalid or duplicate world component registration: ${type}` );
	}
	components.set( type, Object.freeze( { type, waterSurface: descriptor.waterSurface === true, installRank: descriptor.installRank ?? 1 } ) );
}

export function worldComponentDescriptor( type ) {
	return components.get( type ) || null;
}

export function registeredWorldComponents() {
	return [ ...components.keys() ];
}

registerWorldComponent( 'elsemesh.water-body/1', { waterSurface: true } );
registerWorldComponent( 'elsemesh.ambient-audio/1' );
