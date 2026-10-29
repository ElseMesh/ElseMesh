export const WORLD_WASM_EXTENSION_MAX_BYTES = 1024 * 1024;
export const WORLD_WASM_EXTENSION_MAX_MEMORY_PAGES = 64;
export const WORLD_WASM_EXTENSION_MAX_INPUT_BYTES = 16 * 1024;
export const WORLD_WASM_EXTENSION_MAX_OUTPUT_BYTES = 16 * 1024;
export const WORLD_WASM_EXTENSION_MAX_RUN_MS = 50;

const ABI_EXPORTS = new Set( [ 'alloc', 'memory', 'run' ] );
const I32 = 0x7f;

function fail( message ) {
	throw new Error( `Invalid ElseMesh Wasm extension: ${message}` );
}

function readByte( bytes, cursor, end, label ) {
	if ( cursor.offset >= end ) fail( `truncated ${label}` );
	return bytes[ cursor.offset ++ ];
}

function readU32( bytes, cursor, end, label ) {
	let value = 0;
	let shift = 0;
	for ( let index = 0; index < 5; index ++ ) {
		const byte = readByte( bytes, cursor, end, label );
		if ( index === 4 && ( byte & 0xf0 ) ) fail( `oversized ${label}` );
		value |= ( byte & 0x7f ) << shift;
		if ( ( byte & 0x80 ) === 0 ) {
			if ( index > 0 && byte === 0 ) fail( `non-canonical ${label}` );
			return value >>> 0;
		}
		shift += 7;
	}
	fail( `oversized ${label}` );
}

function readName( bytes, cursor, end ) {
	const length = readU32( bytes, cursor, end, 'export name length' );
	if ( length > 32 || cursor.offset + length > end ) fail( 'invalid export name' );
	const name = new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes.subarray( cursor.offset, cursor.offset + length ) );
	cursor.offset += length;
	return name;
}

function readVectorLength( bytes, cursor, end, label, maximum = 100000 ) {
	const length = readU32( bytes, cursor, end, `${label} count` );
	if ( length > maximum ) fail( `too many ${label}` );
	return length;
}

function readFunctionTypes( bytes, cursor, end ) {
	const types = [];
	const count = readVectorLength( bytes, cursor, end, 'function types', 4096 );
	for ( let index = 0; index < count; index ++ ) {
		if ( readByte( bytes, cursor, end, 'function type' ) !== 0x60 ) fail( 'unsupported function type' );
		const parameterCount = readVectorLength( bytes, cursor, end, 'function parameters', 16 );
		const parameters = [];
		for ( let parameter = 0; parameter < parameterCount; parameter ++ ) parameters.push( readByte( bytes, cursor, end, 'function parameter type' ) );
		const resultCount = readVectorLength( bytes, cursor, end, 'function results', 1 );
		const results = [];
		for ( let result = 0; result < resultCount; result ++ ) results.push( readByte( bytes, cursor, end, 'function result type' ) );
		types.push( { parameters, results } );
	}
	if ( cursor.offset !== end ) fail( 'malformed function type section' );
	return types;
}

function readFunctionTypeIndices( bytes, cursor, end ) {
	const types = [];
	const count = readVectorLength( bytes, cursor, end, 'functions' );
	for ( let index = 0; index < count; index ++ ) types.push( readU32( bytes, cursor, end, 'function type index' ) );
	if ( cursor.offset !== end ) fail( 'malformed function section' );
	return types;
}

function readExports( bytes, cursor, end ) {
	const exports = new Map();
	const count = readVectorLength( bytes, cursor, end, 'exports', 16 );
	for ( let index = 0; index < count; index ++ ) {
		const name = readName( bytes, cursor, end );
		const kind = readByte( bytes, cursor, end, 'export kind' );
		const itemIndex = readU32( bytes, cursor, end, 'export index' );
		if ( exports.has( name ) ) fail( 'duplicate export' );
		exports.set( name, { kind, index: itemIndex } );
	}
	if ( cursor.offset !== end ) fail( 'malformed export section' );
	return exports;
}

function readMemory( bytes, cursor, end ) {
	const count = readVectorLength( bytes, cursor, end, 'memories', 1 );
	if ( count !== 1 ) fail( 'exactly one memory is required' );
	const flags = readU32( bytes, cursor, end, 'memory flags' );
	if ( flags !== 1 ) fail( 'memory must have a fixed maximum and cannot be shared or memory64' );
	const initial = readU32( bytes, cursor, end, 'initial memory pages' );
	const maximum = readU32( bytes, cursor, end, 'maximum memory pages' );
	if ( initial > maximum || maximum > WORLD_WASM_EXTENSION_MAX_MEMORY_PAGES ) fail( 'memory maximum exceeds the 64-page limit' );
	if ( cursor.offset !== end ) fail( 'malformed memory section' );
	return { initial, maximum };
}

function parseModule( input ) {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array( input );
	if ( bytes.byteLength < 8 || bytes.byteLength > WORLD_WASM_EXTENSION_MAX_BYTES ) fail( 'module size must be between 8 bytes and 1 MiB' );
	if ( bytes[ 0 ] !== 0 || bytes[ 1 ] !== 0x61 || bytes[ 2 ] !== 0x73 || bytes[ 3 ] !== 0x6d || bytes[ 4 ] !== 1 || bytes[ 5 ] !== 0 || bytes[ 6 ] !== 0 || bytes[ 7 ] !== 0 ) fail( 'unsupported Wasm binary header' );

	let types = null;
	let functionTypes = null;
	let exports = null;
	let memory = null;
	let importsSeen = false;
	let tablesSeen = false;
	let startSeen = false;
	let offset = 8;
	while ( offset < bytes.byteLength ) {
		const cursor = { offset };
		const id = readByte( bytes, cursor, bytes.byteLength, 'section ID' );
		const length = readU32( bytes, cursor, bytes.byteLength, 'section length' );
		const end = cursor.offset + length;
		if ( end > bytes.byteLength ) fail( 'section exceeds the module boundary' );
		switch ( id ) {
			case 1:
				if ( types ) fail( 'duplicate type section' );
				types = readFunctionTypes( bytes, cursor, end );
				break;
			case 2: {
				importsSeen = true;
				const count = readU32( bytes, cursor, end, 'import count' );
				if ( count !== 0 ) fail( 'host and WASI imports are forbidden' );
				if ( cursor.offset !== end ) fail( 'malformed import section' );
				break;
			}
			case 3:
				if ( functionTypes ) fail( 'duplicate function section' );
				functionTypes = readFunctionTypeIndices( bytes, cursor, end );
				break;
			case 4: {
				tablesSeen = true;
				const count = readVectorLength( bytes, cursor, end, 'tables', 0 );
				if ( count !== 0 || cursor.offset !== end ) fail( 'tables are forbidden' );
				break;
			}
			case 5:
				if ( memory ) fail( 'duplicate memory section' );
				memory = readMemory( bytes, cursor, end );
				break;
			case 7:
				if ( exports ) fail( 'duplicate export section' );
				exports = readExports( bytes, cursor, end );
				break;
			case 8:
				startSeen = true;
				fail( 'start functions are forbidden' );
			default:
				cursor.offset = end;
		}
		if ( cursor.offset !== end ) fail( 'malformed section' );
		offset = end;
	}

	if ( importsSeen || tablesSeen || startSeen ) fail( 'module uses a forbidden feature' );
	if ( ! types || ! functionTypes || ! memory || ! exports || exports.size !== ABI_EXPORTS.size || [ ...ABI_EXPORTS ].some( name => ! exports.has( name ) ) ) fail( 'module does not match the required alloc/run/memory ABI' );
	const memoryExport = exports.get( 'memory' );
	const allocExport = exports.get( 'alloc' );
	const runExport = exports.get( 'run' );
	if ( memoryExport.kind !== 2 || memoryExport.index !== 0 || allocExport.kind !== 0 || runExport.kind !== 0 ) fail( 'exports have incompatible kinds or indices' );
	const exportedFunctionType = exportRecord => {
		const typeIndex = functionTypes[ exportRecord.index ];
		if ( typeIndex === undefined || ! types[ typeIndex ] ) fail( 'exported function references an invalid type' );
		return types[ typeIndex ];
	};
	const allocType = exportedFunctionType( allocExport );
	const runType = exportedFunctionType( runExport );
	if ( allocType.parameters.length !== 1 || allocType.parameters[ 0 ] !== I32 || allocType.results.length !== 1 || allocType.results[ 0 ] !== I32 ) fail( 'alloc must have the signature (i32) -> i32' );
	if ( runType.parameters.length !== 2 || runType.parameters.some( type => type !== I32 ) || runType.results.length !== 1 || runType.results[ 0 ] !== I32 ) fail( 'run must have the signature (i32, i32) -> i32' );
	return { bytes, memory };
}

export async function compileWorldWasmExtension( bytes ) {
	const parsed = parseModule( bytes );
	const module = await WebAssembly.compile( parsed.bytes );
	const exports = WebAssembly.Module.exports( module );
	if ( exports.length !== ABI_EXPORTS.size || exports.some( item => ! ABI_EXPORTS.has( item.name ) ) ) fail( 'compiled module exports do not match the ABI' );
	return Object.freeze( { module, memory: parsed.memory } );
}

export function createWorldWasmExtensionRuntime( { moduleBytes, timeoutMs = 8, workerFactory = url => new Worker( url, { type: 'module' } ) } = {} ) {
	const bytes = moduleBytes instanceof Uint8Array ? moduleBytes.slice() : new Uint8Array( moduleBytes || 0 );
	if ( bytes.byteLength < 8 || bytes.byteLength > WORLD_WASM_EXTENSION_MAX_BYTES ) fail( 'module size must be between 8 bytes and 1 MiB' );
	if ( ! Number.isInteger( timeoutMs ) || timeoutMs < 1 || timeoutMs > WORLD_WASM_EXTENSION_MAX_RUN_MS ) fail( 'run timeout must be between 1 and 50 ms' );
	if ( typeof workerFactory !== 'function' ) fail( 'worker factory must be callable' );
	const worker = workerFactory( new URL( './WorldWasmExtensionWorker.js', import.meta.url ) );
	let requestID = 0;
	let pending = null;
	let closed = false;
	let busy = false;
	let ready = false;
	let readyError = null;
	const readyWaiters = [];
	const close = reason => {
		if ( closed ) return;
		closed = true;
		worker.terminate();
		for ( const waiter of readyWaiters.splice( 0 ) ) waiter.reject( reason );
		if ( pending ) {
			clearTimeout( pending.timer );
			pending.reject( reason );
			pending = null;
		}
	};
	worker.onmessage = ( { data } ) => {
		if ( data?.type === 'ready' ) {
			if ( data.error ) {
				readyError = new Error( `Wasm extension could not start: ${String( data.error ).slice( 0, 240 )}` );
				close( readyError );
				return;
			}
			ready = true;
			for ( const waiter of readyWaiters.splice( 0 ) ) waiter.resolve();
			return;
		}
		if ( ! pending || data?.id !== pending.id ) return;
		const request = pending;
		pending = null;
		clearTimeout( request.timer );
		if ( data.error ) request.reject( new Error( `Wasm extension failed: ${String( data.error ).slice( 0, 240 )}` ) );
		else request.resolve( data.result );
	};
	worker.onerror = event => close( new Error( `Wasm extension worker failed: ${String( event.message || 'worker error' ).slice( 0, 200 )}` ) );
	worker.onmessageerror = () => close( new Error( 'Wasm extension worker returned an invalid message' ) );
	worker.postMessage( { type: 'init', moduleBytes: bytes.buffer }, [ bytes.buffer ] );
	return Object.freeze( {
		async run( event ) {
			if ( closed ) throw new Error( 'Wasm extension runtime is closed' );
			if ( busy ) throw new Error( 'Wasm extension runtime accepts one call at a time' );
			busy = true;
			try {
				const json = JSON.stringify( event );
				if ( typeof json !== 'string' ) fail( 'event input must be JSON serializable' );
				const input = new TextEncoder().encode( json );
				if ( input.byteLength > WORLD_WASM_EXTENSION_MAX_INPUT_BYTES ) fail( 'event input exceeds 16 KiB' );
				const id = ++ requestID;
				if ( ! ready ) await new Promise( ( resolve, reject ) => {
					if ( closed ) reject( new Error( 'Wasm extension runtime is closed' ) );
					else if ( readyError ) reject( readyError );
					else if ( ready ) resolve();
					else readyWaiters.push( { resolve, reject } );
				} );
				return await new Promise( ( resolve, reject ) => {
					const timer = setTimeout( () => close( new Error( `Wasm extension exceeded its ${timeoutMs} ms run limit` ) ), timeoutMs );
					pending = { id, resolve, reject, timer };
					worker.postMessage( { type: 'run', id, input: input.buffer }, [ input.buffer ] );
				} );
			} finally {
				busy = false;
			}
		},
		dispose() {
			close( new Error( 'Wasm extension runtime was disposed' ) );
		},
	} );
}
