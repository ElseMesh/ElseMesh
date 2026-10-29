import assert from 'node:assert/strict';
import { validateWorldExtensions, WorldExtensionHost, WORLD_EXTENSION_PROTOCOL, WORLD_EXTENSION_STEP_BUDGET_MS, WORLD_EXTENSION_STEP_BUDGET_WINDOW_MS } from '../src/network/WorldExtensionHost.js';
import { registerWorldBehavior } from '../src/network/WorldBehaviorRegistry.js';
import { WorldExtensionSession } from '../src/network/WorldExtensionSession.js';
import { stepWorldPackageExtensions } from '../src/network/WorldPackage.js';

let consumedState = null;
registerWorldBehavior( 'elsemesh.extension-test/1', { onExtensionState( value ) { consumedState = value; } } );
registerWorldBehavior( 'elsemesh.extension-test-two/1', { onExtensionState() {} } );
registerWorldBehavior( 'elsemesh.extension-test-capability/1', { extensionCapabilities: [ 'test.rules' ], onExtensionState() {} } );
const experience = { behaviors: { 'elsemesh.extension-test/1': {}, 'elsemesh.extension-test-two/1': {} } };
const descriptor = { id: 'elsemesh-extension:counter', protocol: WORLD_EXTENSION_PROTOCOL, assetId: `sha256:${'a'.repeat(64)}`, memoryPages: 2, capabilities: [], behaviorId: 'elsemesh.extension-test/1' };
const assets = [ { id: descriptor.assetId, kind: 'application/wasm', bytes: 8 } ];
assert.throws( () => new WorldExtensionHost( { stepTimeoutMs: 51 } ), /timeout must be an integer from 1 to 50 ms/ );
assert.throws( () => new WorldExtensionHost( { stepTimeoutMs: 0 } ), /timeout must be an integer from 1 to 50 ms/ );
assert.throws( () => new WorldExtensionHost( { stepTimeoutMs: Infinity } ), /timeout must be an integer from 1 to 50 ms/ );
assert.throws( () => new WorldExtensionHost( { clock: 1 } ), /clock must be a function/ );
assert.equal( validateWorldExtensions( [ descriptor ], assets, experience )[ 0 ], descriptor );
assert.equal( validateWorldExtensions( [ { ...descriptor, capabilities: [ 'test.rules' ], behaviorId: 'elsemesh.extension-test-capability/1' } ], assets, { behaviors: { 'elsemesh.extension-test-capability/1': {} } } )[ 0 ].capabilities[ 0 ], 'test.rules' );
assert.throws( () => validateWorldExtensions( [ { ...descriptor, capabilities: [ 'fishing.rules' ] } ], assets, experience ), /capability not allowed by behavior/ );
assert.throws( () => validateWorldExtensions( [ { ...descriptor, capabilities: [ 'unknown.rules' ], behaviorId: 'elsemesh.extension-test-capability/1' } ], assets, { behaviors: { 'elsemesh.extension-test-capability/1': {} } } ), /capability not allowed by behavior/ );
assert.deepEqual( validateWorldExtensions( undefined, undefined, experience ), [] );
assert.throws( () => validateWorldExtensions( [ { ...descriptor, protocol: 'tidewater.world-extension/1' } ], assets, experience ), /Unsupported world extension protocol/ );
assert.throws( () => validateWorldExtensions( [ { ...descriptor, memoryPages: 257 } ], assets, experience ), /memory limit/ );
assert.throws( () => validateWorldExtensions( [ descriptor ], [ { ...assets[ 0 ], kind: 'glb' } ], experience ), /bounded application\/wasm asset/ );
assert.throws( () => validateWorldExtensions( [ descriptor, { ...descriptor, behaviorId: 'elsemesh.extension-test-two/1' } ], assets, experience ), /duplicate world extension ID/ );
assert.throws( () => validateWorldExtensions( [ descriptor, { ...descriptor, id: 'elsemesh-extension:second' } ], assets, experience ), /behavior binding is invalid or duplicated/ );
assert.throws( () => validateWorldExtensions( [ { ...descriptor, behaviorId: 'elsemesh.unknown/1' } ], assets, experience ), /registered state consumer/ );
assert.throws( () => validateWorldExtensions( [ { ...descriptor, behaviorId: undefined } ], assets, experience ), /behavior binding is invalid or duplicated/ );

class FakeWorker {
	constructor( behavior = 'success' ) { this.behavior = behavior; this.terminated = false; this.stepCalls = 0; }
	postMessage( message ) {
		if ( message.type === 'step' ) { this.stepCalls ++; this.lastInput = message.input; }
		if ( this.behavior === 'timeout' && message.type === 'step' ) return;
		queueMicrotask( () => {
			if ( this.terminated ) return;
			if ( message.type === 'load' ) this.onmessage( { data: { type: 'ready' } } );
			else if ( this.behavior === 'failure' && message.type === 'step' ) this.onmessage( { data: { type: 'error', message: 'fixture failure' } } );
			else this.onmessage( { data: { type: 'result', requestId: message.requestId, value: { frame: message.input.frame ?? 0 } } } );
		} );
	}
	terminate() { this.terminated = true; }
}

const worker = new FakeWorker();
const host = new WorldExtensionHost( { workerFactory: () => worker, stepTimeoutMs: 20 } );
await host.load( descriptor, new Uint8Array( 8 ), { frame: 0 } );
assert.deepEqual( await host.step( descriptor.id, { frame: 4 } ), { frame: 4 } );
assert.deepEqual( host.getState( descriptor.id ), { frame: 4 } );
host.dispose();
assert.equal( worker.terminated, true );

const sessionWorker = new FakeWorker();
const sessionConnector = { manifest: { experience }, getAsset: async () => new Uint8Array( 8 ) };
const sessionRoot = {};
const gameRuntime = {};
const session = new WorldExtensionSession( { connector: sessionConnector, root: sessionRoot, host: new WorldExtensionHost( { workerFactory: () => sessionWorker, stepTimeoutMs: 20 } ) } );
await session.load( [ descriptor ] );
session.step( 1 / 60, {
	player: { position: { x: 1, y: 2, z: 3 }, velocity: { x: 0, y: 0, z: 1 }, yaw: 0.4, pitch: - 0.1, mode: 'walk' },
	input: { keys: new Set( [ 'KeyW' ] ), pressed: new Set(), moveAxes: () => ( { x: 0, y: 1, sprint: 0 } ) },
	timeOfDay: 19.25,
	gameRuntime,
} );
await new Promise( resolve => setImmediate( resolve ) );
assert.deepEqual( session.states.get( descriptor.id ), { frame: 0 }, 'the common renderer session stores extension results' );
assert.deepEqual( sessionWorker.lastInput.avatar.position, [ 1, 2, 3 ], 'the shared session serializes browser player state for extensions' );
assert.equal( sessionWorker.lastInput.controls.keys[ 0 ], 'KeyW' );
assert.equal( sessionWorker.lastInput.timeOfDay, 19.25 );
assert.equal( consumedState.root, sessionRoot );
assert.equal( consumedState.connector, sessionConnector );
assert.equal( consumedState.gameRuntime, gameRuntime, 'the shared extension session dispatches state to the browser behavior runtime' );
session.dispose();
assert.equal( sessionWorker.terminated, true );

let extensionFrame = null;
const packageRoot = { userData: { worldPackage: {
	connector: { manifest: { experience } },
	extensionSession: { step( deltaSeconds, context ) { extensionFrame = { deltaSeconds, ...context }; } },
} } };
stepWorldPackageExtensions( packageRoot, 1 / 60, {
	player: { position: { x: 1, y: 2, z: 3 }, velocity: { x: 0, y: 0, z: 1 }, yaw: 0.4, pitch: - 0.1, mode: 'walk' },
	input: { keys: new Set( [ 'KeyW' ] ), pressed: new Set(), moveAxes: () => ( { x: 0, y: 1, sprint: 0 } ) },
	timeOfDay: 19.25,
} );
assert.deepEqual( extensionFrame.player.position, { x: 1, y: 2, z: 3 }, 'WebGPU package forwards the browser-owned player context to the shared session' );
assert.equal( extensionFrame.timeOfDay, 19.25 );

const failureWorker = new FakeWorker( 'failure' );
const failureHost = new WorldExtensionHost( { workerFactory: () => failureWorker, stepTimeoutMs: 20 } );
await failureHost.load( descriptor, new Uint8Array( 8 ), {} );
await assert.rejects( failureHost.step( descriptor.id, {} ), /fixture failure/ );
assert.equal( failureWorker.terminated, true );
await assert.rejects( failureHost.step( descriptor.id, {} ), /fixture failure/ );
assert.equal( failureWorker.stepCalls, 1, 'a failed extension cannot be re-entered' );

const timeoutWorker = new FakeWorker( 'timeout' );
const timeoutHost = new WorldExtensionHost( { workerFactory: () => timeoutWorker, stepTimeoutMs: 10 } );
await timeoutHost.load( descriptor, new Uint8Array( 8 ), {} );
await assert.rejects( timeoutHost.step( descriptor.id, {} ), /exceeded its 10 ms time limit/ );
assert.equal( timeoutWorker.terminated, true );

let budgetTime = 0;
const budgetWorker = {
	terminated: false,
	postMessage( message ) {
		if ( message.type === 'step' ) budgetTime += 100;
		queueMicrotask( () => {
			if ( this.terminated ) return;
			if ( message.type === 'load' ) this.onmessage( { data: { type: 'ready' } } );
			else this.onmessage( { data: { type: 'result', requestId: message.requestId, value: {} } } );
		} );
	},
	terminate() { this.terminated = true; },
};
const budgetHost = new WorldExtensionHost( { workerFactory: () => budgetWorker, clock: () => budgetTime } );
await budgetHost.load( descriptor, new Uint8Array( 8 ), {} );
await budgetHost.step( descriptor.id, {} );
await budgetHost.step( descriptor.id, {} );
await assert.rejects( budgetHost.step( descriptor.id, {} ), new RegExp( `exceeded its ${WORLD_EXTENSION_STEP_BUDGET_MS} ms execution budget in a ${WORLD_EXTENSION_STEP_BUDGET_WINDOW_MS / 1000} s window` ) );
assert.equal( budgetWorker.terminated, true, 'the host terminates a module that exhausts its aggregate step budget' );

const invalidClockWorker = {
	terminated: false,
	postMessage( message ) {
		queueMicrotask( () => {
			if ( this.terminated ) return;
			if ( message.type === 'load' ) this.onmessage( { data: { type: 'ready' } } );
			else this.onmessage( { data: { type: 'result', requestId: message.requestId, value: {} } } );
		} );
	},
	terminate() { this.terminated = true; },
};
let invalidClockCalls = 0;
const invalidClockHost = new WorldExtensionHost( { workerFactory: () => invalidClockWorker, clock: () => ++ invalidClockCalls === 3 ? NaN : invalidClockCalls } );
await invalidClockHost.load( descriptor, new Uint8Array( 8 ), {} );
await assert.rejects( invalidClockHost.step( descriptor.id, {} ), /clock returned an invalid value/ );
assert.equal( invalidClockWorker.terminated, true, 'the host terminates a module when budget accounting cannot read its clock' );

console.log( 'world extension host: ok' );
