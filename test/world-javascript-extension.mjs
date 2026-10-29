import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createWorldJavaScriptExtensionRuntime, decodeWorldJavaScriptExtension, WORLD_JAVASCRIPT_EXTENSION_PROTOCOL } from '../src/network/WorldJavaScriptExtension.js';

const source = 'export function run(event) { return { type: event.type }; }';
const bytes = new TextEncoder().encode( source );
assert.equal( decodeWorldJavaScriptExtension( bytes ), source );
assert.throws( () => decodeWorldJavaScriptExtension( Uint8Array.of( 0xff ) ), /encoded data/ );
assert.throws( () => decodeWorldJavaScriptExtension( new Uint8Array( 1024 * 1024 + 1 ) ), /1 MiB/ );
assert.throws( () => decodeWorldJavaScriptExtension( 'export async function run() { return import("https://example.invalid/module.js"); }' ), /self-contained/ );

class FakeWorker {
	terminated = false;
	onmessage = null;
	onerror = null;
	onmessageerror = null;
	postMessage( message ) {
		if ( message.type === 'init' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, type: 'ready' } } ) );
		else if ( message.type === 'run' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, id: message.id, result: { echo: message.event } } } ) );
	}
	terminate() { this.terminated = true; }
}

const fake = new FakeWorker();
const runtime = createWorldJavaScriptExtensionRuntime( { moduleBytes: bytes, workerFactory: () => fake } );
assert.deepEqual( await runtime.run( { type: 'tick', dt: 1 / 60 } ), { echo: { type: 'tick', dt: 1 / 60 } } );
await assert.rejects( runtime.run( { payload: 'x'.repeat( 20 * 1024 ) } ), /16 KiB/ );
runtime.dispose();
assert.equal( fake.terminated, true, 'disposing the runtime terminates its worker' );

const startupWorker = new FakeWorker();
startupWorker.postMessage = () => {};
const startupTimeout = createWorldJavaScriptExtensionRuntime( { moduleBytes: bytes, startupTimeoutMs: 1, workerFactory: () => startupWorker } );
await assert.rejects( startupTimeout.run( { type: 'tick' } ), /1 ms startup limit/ );
assert.equal( startupWorker.terminated, true, 'a stalled module startup is terminated' );

const timeoutWorker = new FakeWorker();
timeoutWorker.postMessage = message => {
	if ( message.type === 'init' ) queueMicrotask( () => timeoutWorker.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, type: 'ready' } } ) );
};
const timeoutRuntime = createWorldJavaScriptExtensionRuntime( { moduleBytes: bytes, timeoutMs: 1, workerFactory: () => timeoutWorker } );
await assert.rejects( timeoutRuntime.run( { type: 'loop' } ), /run limit/ );
assert.equal( timeoutWorker.terminated, true, 'a timed-out call terminates the worker' );

const vite = await createServer( { configFile: './vite.config.js', server: { middlewareMode: true }, appType: 'custom' } );
try {
	const extensionModule = await vite.transformRequest( '/src/network/WorldJavaScriptExtension.js' );
	const workerModule = await vite.transformRequest( '/src/network/WorldJavaScriptExtensionWorker.js' );
	assert.match( extensionModule.code, /WorldJavaScriptExtensionWorker\.js/, 'Vite preserves the Worker module URL in the production source graph' );
	assert.match( workerModule.code, /extension\.run/, 'Vite transforms the isolated JavaScript module Worker' );
} finally {
	await vite.close();
}

console.log( 'World JavaScript extension: UTF-8, byte and message limits, startup/run deadlines, teardown and Vite transform passed' );
