const adapters = new Map();
const batchAdapters = new Map();

function keyFor( backend, type ) {
	if ( ! [ 'webgpu', 'webgl' ].includes( backend ) || typeof type !== 'string' || ! /^elsemesh\.[a-z0-9.-]+\/\d+$/.test( type ) ) {
		throw new Error( `Invalid world component backend adapter: ${backend}:${type}` );
	}
	return `${ backend }\0${ type }`;
}

export function registerWorldComponentBackendAdapter( backend, type, install ) {
	const key = keyFor( backend, type );
	if ( typeof install !== 'function' ) throw new Error( `Invalid world component backend adapter: ${backend}:${type}` );
	if ( adapters.has( key ) || batchAdapters.has( key ) ) throw new Error( `Duplicate world component backend adapter: ${backend}:${type}` );
	adapters.set( key, install );
}

export function registerWorldComponentBackendBatchAdapter( backend, type, install ) {
	const key = keyFor( backend, type );
	if ( typeof install !== 'function' ) throw new Error( `Invalid world component backend adapter: ${backend}:${type}` );
	if ( adapters.has( key ) || batchAdapters.has( key ) ) throw new Error( `Duplicate world component backend adapter: ${backend}:${type}` );
	batchAdapters.set( key, install );
}

export function worldComponentBackendAdapter( backend, type ) {
	return adapters.get( `${ backend }\0${ type }` ) || null;
}

export function worldComponentBackendBatchAdapter( backend, type ) {
	return batchAdapters.get( `${ backend }\0${ type }` ) || null;
}
