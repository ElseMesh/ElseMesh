import assert from 'node:assert/strict';

const leb = value => {
	const bytes = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
	if ( value ) byte |= 0x80;
		bytes.push( byte );
	} while ( value );
	return bytes;
};
const wasmString = value => {
	const bytes = [ ...new TextEncoder().encode( value ) ];
	return [ ...leb( bytes.length ), ...bytes ];
};
const section = ( id, payload ) => [ id, ...leb( payload.length ), ...payload ];
const vector = values => [ ...leb( values.length ), ...values.flat() ];
const funcType = ( parameters, results ) => [ 0x60, ...vector( parameters ), ...vector( results ) ];
const functionBody = instructions => [ ...leb( instructions.length + 1 ), 0x00, ...instructions ];

const types = vector( [
	funcType( [], [ 0x7f ] ),
	funcType( [ 0x7f ], [ 0x7f ] ),
	funcType( [ 0x7f, 0x7f ], [ 0x7f ] ),
] );
const imports = vector( [ [ ...wasmString( 'elsemesh_host_v1' ), ...wasmString( 'memory' ), 0x02, 0x01, ...leb( 2 ), ...leb( 2 ) ] ] );
const functions = vector( [ [ 0 ], [ 1 ], [ 2 ], [ 0 ], [ 2 ] ] );
const exports = vector( [
	[ ...wasmString( 'abi_version' ), 0x00, ...leb( 0 ) ],
	[ ...wasmString( 'alloc' ), 0x00, ...leb( 1 ) ],
	[ ...wasmString( 'init' ), 0x00, ...leb( 2 ) ],
	[ ...wasmString( 'output_len' ), 0x00, ...leb( 3 ) ],
	[ ...wasmString( 'step' ), 0x00, ...leb( 4 ) ],
	[ ...wasmString( 'memory' ), 0x02, ...leb( 0 ) ],
] );
const output = [ ...new TextEncoder().encode( '{"tick":0}' ) ];
const data = vector( [ [ 0x00, 0x41, 0x80, 0x08, 0x0b, ...leb( output.length ), ...output ] ] );
const code = vector( [
	functionBody( [ 0x41, 0x01, 0x0b ] ),
	functionBody( [ 0x41, 0x80, 0x10, 0x0b ] ),
	functionBody( [ 0x41, 0x80, 0x08, 0x0b ] ),
	functionBody( [ 0x41, 0x0a, 0x0b ] ),
	functionBody( [ 0x41, 0x80, 0x08, 0x0b ] ),
] );
const moduleBytes = Uint8Array.from( [
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
	...section( 1, types ), ...section( 2, imports ), ...section( 3, functions ),
	...section( 7, exports ), ...section( 10, code ), ...section( 11, data ),
] );
assert.equal( WebAssembly.validate( moduleBytes ), true, 'fixture compiles as a real module using only the imported host memory' );

const messages = [];
globalThis.self = { postMessage: message => messages.push( message ) };
await import( '../src/network/WorldExtensionWorker.js?real-module-test' );
const send = async message => {
	await globalThis.self.onmessage( { data: message } );
	return messages.at( - 1 );
};

assert.deepEqual( await send( { type: 'load', requestId: 1, bytes: moduleBytes.buffer, memoryPages: 2 } ), { type: 'ready' } );
assert.deepEqual( await send( { type: 'init', requestId: 2, input: { seed: 42 } } ), { type: 'result', requestId: 2, value: { tick: 0 } } );
assert.deepEqual( await send( { type: 'step', requestId: 3, input: { deltaSeconds: 1 / 60 } } ), { type: 'result', requestId: 3, value: { tick: 0 } } );

console.log( 'world extension worker: real Wasm module passed ABI and state checks' );
