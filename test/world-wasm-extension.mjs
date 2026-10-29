import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { compileWorldWasmExtension, createWorldWasmExtensionRuntime } from '../src/network/WorldWasmExtension.js';

const bytes = Uint8Array.from( [
	0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
	1, 12, 2, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 1, 0x7f,
	3, 3, 2, 0, 1,
	5, 4, 1, 1, 1, 64,
	7, 24, 3, 5, 97, 108, 108, 111, 99, 0, 0, 6, 109, 101, 109, 111, 114, 121, 2, 0, 3, 114, 117, 110, 0, 1,
	10, 11, 2, 4, 0, 0x41, 0, 0x0b, 4, 0, 0x20, 0, 0x0b,
] );

const compiled = await compileWorldWasmExtension( bytes );
assert.deepEqual( compiled.memory, { initial: 1, maximum: 64 } );
const instance = await WebAssembly.instantiate( compiled.module );
assert.equal( instance.exports.alloc( 8 ), 0 );
assert.equal( instance.exports.run( 3, 4 ), 3 );

const tooMuchMemory = bytes.slice();
tooMuchMemory[ 32 ] = 65;
await assert.rejects( compileWorldWasmExtension( tooMuchMemory ), /64-page limit/ );

const unboundedMemory = bytes.slice();
unboundedMemory[ 28 ] = 3;
unboundedMemory[ 30 ] = 0;
await assert.rejects( compileWorldWasmExtension( unboundedMemory ), /fixed maximum/ );

const imported = new Uint8Array( bytes.length + 13 );
imported.set( bytes.subarray( 0, 22 ) );
imported.set( [ 2, 11, 1, 3, 101, 110, 118, 3, 102, 111, 111, 0, 0 ], 22 );
imported.set( bytes.subarray( 22 ), 35 );
await assert.rejects( compileWorldWasmExtension( imported ), /imports are forbidden/ );

const wrongABI = bytes.slice();
wrongABI[ 18 ] = 1;
await assert.rejects( compileWorldWasmExtension( wrongABI ), /run must have the signature/ );

await assert.rejects( compileWorldWasmExtension( new Uint8Array( 8 + 1024 * 1024 ) ), /1 MiB/ );

class FakeWorker {
	terminated = false;
	onmessage = null;
	onerror = null;
	onmessageerror = null;
	postMessage( message ) {
		if ( message.type === 'init' ) queueMicrotask( () => this.onmessage( { data: { type: 'ready' } } ) );
		else if ( message.type === 'run' ) {
			const event = JSON.parse( new TextDecoder().decode( message.input ) );
			queueMicrotask( () => this.onmessage( { data: { id: message.id, result: { echo: event } } } ) );
		}
	}
	terminate() { this.terminated = true; }
}

const fake = new FakeWorker();
const runtime = createWorldWasmExtensionRuntime( { moduleBytes: bytes, workerFactory: () => fake } );
assert.deepEqual( await runtime.run( { type: 'tick', dt: 1 / 60 } ), { echo: { type: 'tick', dt: 1 / 60 } } );
await assert.rejects( runtime.run( { payload: 'x'.repeat( 20 * 1024 ) } ), /16 KiB/ );
runtime.dispose();
assert.equal( fake.terminated, true, 'disposing the runtime terminates its worker' );

const timeoutWorker = new FakeWorker();
timeoutWorker.postMessage = message => {
	if ( message.type === 'init' ) queueMicrotask( () => timeoutWorker.onmessage( { data: { type: 'ready' } } ) );
};
const timeoutRuntime = createWorldWasmExtensionRuntime( { moduleBytes: bytes, timeoutMs: 1, workerFactory: () => timeoutWorker } );
await assert.rejects( timeoutRuntime.run( { type: 'loop' } ), /exceeded its 1 ms run limit/ );
assert.equal( timeoutWorker.terminated, true, 'a timed-out worker is terminated to stop runaway code' );

const vite = await createServer( { configFile: './vite.config.js', server: { middlewareMode: true }, appType: 'custom' } );
try {
	const extensionModule = await vite.transformRequest( '/src/network/WorldWasmExtension.js' );
	const workerModule = await vite.transformRequest( '/src/network/WorldWasmExtensionWorker.js' );
	assert.match( extensionModule.code, /WorldWasmExtensionWorker\.js/, 'Vite preserves the worker module URL in the production source graph' );
	assert.match( workerModule.code, /compileWorldWasmExtension/, 'Vite transforms the isolated Wasm worker module' );
} finally {
	await vite.close();
}

console.log( 'World Wasm guard: fixed ABI, import denial, memory/input caps and worker timeout passed' );
