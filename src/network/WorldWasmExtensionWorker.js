import {
	compileWorldWasmExtension,
	WORLD_WASM_EXTENSION_MAX_OUTPUT_BYTES,
} from './WorldWasmExtension.js';

let instance = null;
let memory = null;

self.addEventListener( 'message', async ( { data } ) => {
	if ( data?.type === 'init' ) {
		try {
			const compiled = await compileWorldWasmExtension( data.moduleBytes );
			instance = await WebAssembly.instantiate( compiled.module );
			memory = instance.exports.memory;
			if ( ! ( memory instanceof WebAssembly.Memory ) || memory.buffer.byteLength > compiled.memory.maximum * 65536 ) throw new Error( 'module memory exceeds its declared cap' );
			self.postMessage( { type: 'ready' } );
		} catch ( error ) {
			self.postMessage( { type: 'ready', error: String( error?.message || error ).slice( 0, 240 ) } );
		}
		return;
	}
	if ( data?.type !== 'run' || ! instance || ! memory ) return;
	try {
		const input = new Uint8Array( data.input );
		const inputPointer = instance.exports.alloc( input.byteLength ) >>> 0;
		if ( inputPointer + input.byteLength > memory.buffer.byteLength ) throw new Error( 'input buffer is out of bounds' );
		new Uint8Array( memory.buffer, inputPointer, input.byteLength ).set( input );
		const outputPointer = instance.exports.run( inputPointer, input.byteLength ) >>> 0;
		const view = new DataView( memory.buffer );
		if ( outputPointer + 4 > memory.buffer.byteLength ) throw new Error( 'result header is out of bounds' );
		const outputLength = view.getUint32( outputPointer, true );
		if ( outputLength > WORLD_WASM_EXTENSION_MAX_OUTPUT_BYTES || outputPointer + 4 + outputLength > memory.buffer.byteLength ) throw new Error( 'result exceeds the 16 KiB limit or is out of bounds' );
		const outputBytes = new Uint8Array( memory.buffer, outputPointer + 4, outputLength );
		const result = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( outputBytes ) );
		if ( ! result || typeof result !== 'object' || Array.isArray( result ) ) throw new Error( 'result must be a JSON object' );
		self.postMessage( { id: data.id, result } );
	} catch ( error ) {
		self.postMessage( { id: data.id, error: String( error?.message || error ).slice( 0, 240 ) } );
	}
} );
