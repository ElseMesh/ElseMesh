const components = new Map();

export function registerWorldComponent( type, descriptor = {} ) {
	if ( typeof type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( type ) || components.has( type ) || ! descriptor || typeof descriptor !== 'object' || Array.isArray( descriptor ) || Object.keys( descriptor ).some( key => ! [ 'waterSurface', 'vegetation', 'vehicle', 'wildlifeSimulation', 'complexityTriangles', 'installRank', 'install' ].includes( key ) ) || descriptor.waterSurface !== undefined && typeof descriptor.waterSurface !== 'boolean' || descriptor.vegetation !== undefined && typeof descriptor.vegetation !== 'boolean' || descriptor.vehicle !== undefined && typeof descriptor.vehicle !== 'boolean' || descriptor.wildlifeSimulation !== undefined && typeof descriptor.wildlifeSimulation !== 'boolean' || descriptor.complexityTriangles !== undefined && ( ! Number.isSafeInteger( descriptor.complexityTriangles ) || descriptor.complexityTriangles < 0 || descriptor.complexityTriangles > 10000000 ) || descriptor.vehicle === true && descriptor.complexityTriangles === undefined || descriptor.installRank !== undefined && ( ! Number.isInteger( descriptor.installRank ) || descriptor.installRank < 0 || descriptor.installRank > 10 ) || descriptor.install !== undefined && typeof descriptor.install !== 'function' ) {
		throw new Error( `Invalid or duplicate world component registration: ${type}` );
	}
	components.set( type, Object.freeze( { type, waterSurface: descriptor.waterSurface === true, vegetation: descriptor.vegetation === true, vehicle: descriptor.vehicle === true, wildlifeSimulation: descriptor.wildlifeSimulation === true, complexityTriangles: descriptor.complexityTriangles ?? 0, installRank: descriptor.installRank ?? 1, install: descriptor.install || null } ) );
}

export function worldComponentDescriptor( type ) {
	return components.get( type ) || null;
}

export function registeredWorldComponents() {
	return [ ...components.keys() ];
}

registerWorldComponent( 'elsemesh.water-body/1', { waterSurface: true } );
registerWorldComponent( 'elsemesh.ambient-audio/1' );
