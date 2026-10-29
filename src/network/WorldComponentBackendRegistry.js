const adapters = new Map();

export function registerWorldComponentBackendAdapter( backend, type, install ) {
	if ( ! [ 'webgpu', 'webgl' ].includes( backend ) || typeof type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( type ) || typeof install !== 'function' ) {
		throw new Error( `Invalid world component backend adapter: ${backend}:${type}` );
	}
	const key = `${ backend }\0${ type }`;
	if ( adapters.has( key ) ) throw new Error( `Duplicate world component backend adapter: ${backend}:${type}` );
	adapters.set( key, install );
}

export function worldComponentBackendAdapter( backend, type ) {
	return adapters.get( `${ backend }\0${ type }` ) || null;
}
