const adapters = new Map();

export function registerWorldPackageMaterialAdapter( componentType, adapter ) {
	if ( typeof componentType !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( componentType ) || adapters.has( componentType ) ||
		! adapter || typeof adapter !== 'object' || Array.isArray( adapter ) || typeof adapter.prepare !== 'function' || typeof adapter.resolve !== 'function' ) {
		throw new Error( `Invalid or duplicate world package material adapter: ${componentType}` );
	}
	adapters.set( componentType, Object.freeze( { componentType, prepare: adapter.prepare, resolve: adapter.resolve } ) );
}

export function registeredWorldPackageMaterialAdapters() {
	return [ ...adapters.values() ];
}
