import { validateWorldExtensionBinary } from './WorldExtensionBinary.js';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const REQUIRED_EXPORTS = [ 'abi_version', 'alloc', 'init', 'memory', 'output_len', 'step' ];

function fail( message ) {
	self.postMessage( { type: 'error', message } );
}

function bytesAt( memory, pointer, length, maximum ) {
	if ( ! Number.isInteger( pointer ) || ! Number.isInteger( length ) || pointer < 0 || length < 0 || length > maximum || pointer + length > memory.buffer.byteLength ) throw new Error( 'Extension returned an out-of-bounds buffer' );
	return new Uint8Array( memory.buffer, pointer, length );
}

function callJson( instance, functionName, input ) {
	const encoded = new TextEncoder().encode( JSON.stringify( input ) );
	if ( encoded.byteLength > MAX_INPUT_BYTES ) throw new Error( 'Extension input exceeds the size limit' );
	const { memory, alloc, output_len } = instance.exports;
	const pointer = alloc( encoded.byteLength );
	bytesAt( memory, pointer, encoded.byteLength, MAX_INPUT_BYTES ).set( encoded );
	const outputPointer = instance.exports[ functionName ]( pointer, encoded.byteLength );
	const outputLength = output_len();
	const output = bytesAt( memory, outputPointer, outputLength, MAX_OUTPUT_BYTES ).slice();
	const value = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( output ) );
	if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) throw new Error( 'Extension output must be a JSON object' );
	return value;
}

self.onmessage = async ( event ) => {
	const message = event.data;
	try {
		if ( message?.type === 'load' ) {
			const { bytes, memoryPages } = message;
			if ( ! ( bytes instanceof ArrayBuffer ) || bytes.byteLength < 8 || bytes.byteLength > 8 * 1024 * 1024 ) throw new Error( 'Extension module has an invalid size' );
			if ( ! Number.isInteger( memoryPages ) || memoryPages < 1 || memoryPages > 256 ) throw new Error( 'Extension memory limit is outside the supported range' );
			validateWorldExtensionBinary( new Uint8Array( bytes ) );
			const module = await WebAssembly.compile( bytes );
			const imports = WebAssembly.Module.imports( module );
			if ( imports.length !== 1 || imports[ 0 ].module !== 'elsemesh_host_v1' || imports[ 0 ].name !== 'memory' || imports[ 0 ].kind !== 'memory' ) throw new Error( 'Extension imports are not permitted by the ElseMesh Wasm ABI' );
			const moduleExports = WebAssembly.Module.exports( module ).sort( ( a, b ) => a.name.localeCompare( b.name ) );
			if ( moduleExports.length !== REQUIRED_EXPORTS.length || moduleExports.some( ( item, index ) => item.name !== REQUIRED_EXPORTS[ index ] || item.kind !== ( item.name === 'memory' ? 'memory' : 'function' ) ) ) throw new Error( 'Extension exports do not match the ElseMesh Wasm ABI' );
			const memory = new WebAssembly.Memory( { initial: Math.min( 16, memoryPages ), maximum: memoryPages } );
			const instance = await WebAssembly.instantiate( module, { elsemesh_host_v1: { memory } } );
			if ( instance.exports.memory !== memory || instance.exports.abi_version() !== 1 ) throw new Error( 'Extension ABI version or memory export is invalid' );
			self.extensionInstance = instance;
			self.postMessage( { type: 'ready' } );
			return;
		}
		if ( message?.type === 'init' || message?.type === 'step' ) {
			if ( ! self.extensionInstance ) throw new Error( 'Extension module is not loaded' );
			const result = callJson( self.extensionInstance, message.type, message.input );
			self.postMessage( { type: 'result', requestId: message.requestId, value: result } );
			return;
		}
		throw new Error( 'Unknown extension worker message' );
	} catch ( error ) {
		fail( error?.message || String( error ) );
	}
};
