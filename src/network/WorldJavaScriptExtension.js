export const WORLD_JAVASCRIPT_EXTENSION_MAX_BYTES = 1024 * 1024;
export const WORLD_JAVASCRIPT_EXTENSION_MAX_MESSAGE_BYTES = 16 * 1024;
export const WORLD_JAVASCRIPT_EXTENSION_MAX_RUN_MS = 50;
export const WORLD_JAVASCRIPT_EXTENSION_MAX_STARTUP_MS = 1000;
const WORLD_JAVASCRIPT_EXTENSION_MAX_PENDING_CALLS = 32;
export const WORLD_JAVASCRIPT_EXTENSION_PROTOCOL = 'elsemesh.world-extension/1';

function fail( message ) {
	throw new Error( `Invalid ElseMesh JavaScript extension: ${message}` );
}

function extensionMessageBytes( value, label ) {
	if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) fail( `${label} must be a JSON object` );
	let json;
	try { json = JSON.stringify( value ); } catch { fail( `${label} must be JSON serializable` ); }
	if ( typeof json !== 'string' ) fail( `${label} must be JSON serializable` );
	const bytes = new TextEncoder().encode( json );
	if ( bytes.byteLength > WORLD_JAVASCRIPT_EXTENSION_MAX_MESSAGE_BYTES ) fail( `${label} exceeds the 16 KiB limit` );
	return bytes;
}

export function decodeWorldJavaScriptExtension( bytes ) {
	const source = typeof bytes === 'string' ? bytes : new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes );
	const length = new TextEncoder().encode( source ).byteLength;
	if ( length < 1 || length > WORLD_JAVASCRIPT_EXTENSION_MAX_BYTES ) fail( 'module size must be between 1 byte and 1 MiB' );
	if ( /\bimport\b/.test( source ) ) fail( 'module must be self-contained and cannot import other code' );
	return source;
}

export function createWorldJavaScriptExtensionRuntime( { moduleBytes, timeoutMs = 50, startupTimeoutMs = 1000, workerFactory = url => new Worker( url, { type: 'module' } ) } = {} ) {
	const source = decodeWorldJavaScriptExtension( moduleBytes );
	if ( ! Number.isInteger( timeoutMs ) || timeoutMs < 1 || timeoutMs > WORLD_JAVASCRIPT_EXTENSION_MAX_RUN_MS ) fail( 'run timeout must be between 1 and 50 ms' );
	if ( ! Number.isInteger( startupTimeoutMs ) || startupTimeoutMs < 1 || startupTimeoutMs > WORLD_JAVASCRIPT_EXTENSION_MAX_STARTUP_MS ) fail( 'startup timeout must be between 1 and 1000 ms' );
	if ( typeof workerFactory !== 'function' ) fail( 'worker factory must be callable' );
	const worker = workerFactory( new URL( './WorldJavaScriptExtensionWorker.js', import.meta.url ) );
	let requestID = 0;
	let pendingCalls = 0;
	let pending = null;
	const queue = [];
	let closed = false;
	let ready = false;
	let startupTimer = null;
	const close = reason => {
		if ( closed ) return;
		closed = true;
		clearTimeout( startupTimer );
		worker.terminate();
		if ( pending ) {
			clearTimeout( pending.timer );
			pending.reject( reason );
			pending = null;
		}
		for ( const request of queue.splice( 0 ) ) request.reject( reason );
		pendingCalls = 0;
	};
	const runNext = () => {
		if ( closed || ! ready || pending || queue.length === 0 ) return;
		const request = queue.shift();
		const id = ++ requestID;
		const timer = setTimeout( () => close( new Error( `JavaScript extension exceeded its ${timeoutMs} ms run limit` ) ), timeoutMs );
		pending = { ...request, id, timer };
		try { worker.postMessage( { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, type: 'run', id, event: request.event } ); }
		catch ( error ) { close( error ); }
	};
	worker.onmessage = ( { data } ) => {
		if ( data?.protocol !== WORLD_JAVASCRIPT_EXTENSION_PROTOCOL ) {
			close( new Error( 'JavaScript extension returned an unsupported message protocol' ) );
			return;
		}
		if ( data?.type === 'ready' ) {
			if ( data.error ) {
				close( new Error( `JavaScript extension could not start: ${String( data.error ).slice( 0, 240 )}` ) );
				return;
			}
			ready = true;
			clearTimeout( startupTimer );
			runNext();
			return;
		}
		if ( ! pending ) return;
		if ( data?.id !== pending.id ) {
			close( new Error( 'JavaScript extension returned a mismatched response ID' ) );
			return;
		}
		const request = pending;
		pending = null;
		clearTimeout( request.timer );
		pendingCalls --;
		if ( data.error ) request.reject( new Error( `JavaScript extension failed: ${String( data.error ).slice( 0, 240 )}` ) );
		else {
			try {
				extensionMessageBytes( data.result, 'extension result' );
				request.resolve( data.result );
			} catch ( error ) { request.reject( error ); }
		}
		runNext();
	};
	worker.onerror = event => close( new Error( `JavaScript extension worker failed: ${String( event.message || 'worker error' ).slice( 0, 200 )}` ) );
	worker.onmessageerror = () => close( new Error( 'JavaScript extension worker returned an invalid message' ) );
	startupTimer = setTimeout( () => close( new Error( `JavaScript extension exceeded its ${startupTimeoutMs} ms startup limit` ) ), startupTimeoutMs );
	try { worker.postMessage( { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, type: 'init', source } ); } catch ( error ) { close( error ); }
	return Object.freeze( {
		async run( event ) {
			if ( closed ) throw new Error( 'JavaScript extension runtime is closed' );
			const input = extensionMessageBytes( event, 'event input' );
			if ( pendingCalls >= WORLD_JAVASCRIPT_EXTENSION_MAX_PENDING_CALLS ) throw new Error( `JavaScript extension accepts at most ${WORLD_JAVASCRIPT_EXTENSION_MAX_PENDING_CALLS} pending calls` );
			const clonedEvent = JSON.parse( new TextDecoder().decode( input ) );
			return new Promise( ( resolve, reject ) => {
				pendingCalls ++;
				queue.push( { event: clonedEvent, resolve, reject } );
				runNext();
			} );
		},
		dispose() {
			close( new Error( 'JavaScript extension runtime was disposed' ) );
		},
	} );
}
