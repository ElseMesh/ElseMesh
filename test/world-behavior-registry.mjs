import assert from 'node:assert/strict';
import { App } from '../src/App.js';
import { createWorldBehaviorExtensions, createWorldBehaviorRuntime, dispatchWorldBehaviorExtensionEvent, dispatchWorldInputExtensionEvent, dispatchWorldBehaviorHooks, hasWorldBehavior, registerWorldBehavior, registerWorldBehaviorImplementation, worldBehaviorData, worldBehaviorsFor, WORLD_EXTENSION_EVENT_ACTIVATED, WORLD_EXTENSION_EVENT_FRAME, WORLD_EXTENSION_EVENT_INPUT, worldInputExtensionEvent } from '../src/network/WorldBehaviorRegistry.js';
import { WORLD_JAVASCRIPT_EXTENSION_PROTOCOL } from '../src/network/WorldJavaScriptExtension.js';

registerWorldBehavior( 'elsemesh.registry-test/1', {
	validateExperienceData: data => { if ( Object.keys( data ).length ) throw new Error( 'invalid test data' ); },
	validateExtensionEvent: event => { if ( event.type !== WORLD_EXTENSION_EVENT_ACTIVATED ) throw new Error( 'invalid test event' ); },
	validateExtensionResult: result => { if ( result.echo?.type !== WORLD_EXTENSION_EVENT_ACTIVATED ) throw new Error( 'invalid test result' ); },
	createRuntime: options => ( { options } ),
} );
const behaviorID = 'elsemesh.registry-test/1';
const extensionAsset = `sha256:${'1'.repeat(64)}`;
const experience = { behaviors: { [ behaviorID ]: {} }, extensions: [ { behaviorId: behaviorID, assetId: extensionAsset } ] };
assert.deepEqual( worldBehaviorsFor( experience ).map( ( { id } ) => id ), [ behaviorID ] );
assert.deepEqual( worldBehaviorData( experience, behaviorID ), {}, 'behavior-owned data is available through the registry' );
assert.equal( hasWorldBehavior( experience, behaviorID ), true );
const runtime = createWorldBehaviorRuntime( experience, behaviorID, { worldId: 'elsemesh:registry-test' } );
const otherRuntime = createWorldBehaviorRuntime( experience, behaviorID, { worldId: 'elsemesh:registry-test-other' } );
assert.notEqual( runtime, otherRuntime, 'each world receives its own registered runtime' );
assert.notEqual( runtime.options, otherRuntime.options, 'world runtimes receive isolated creation options' );
assert.equal( runtime.options.worldId, 'elsemesh:registry-test' );
assert.throws( () => worldBehaviorsFor( { behaviors: { [ behaviorID ]: { worldRule: true } } } ), /invalid test data/ );
assert.throws( () => worldBehaviorsFor( { behaviors: { 'elsemesh.owner-defined/1': {} } } ), /does not support required world behavior/ );
assert.throws( () => worldBehaviorsFor( { behaviors: { 'owner.fishing-game/1': {} } } ), /Invalid world behavior ID/, 'behavior IDs remain in the ElseMesh wire namespace' );
assert.throws( () => registerWorldBehavior( 'elsemesh.invalid/1', {} ), /Invalid world behavior/ );
assert.throws( () => registerWorldBehavior( 'elsemesh.registry-test/1', { validateExperienceData: () => {} } ), /Invalid or duplicate/ );
let worldActivation = null;
let webglActivation = null;
let builtInActivation = null;
let worldFrame = null;
let worldDeactivation = null;
let webglFrame = null;
let inputGate = null;
let worldKeyDown = null;
let extensionResult = null;
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onHostedWorldActivated: state => { worldActivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWebGLWorldActivated: state => { webglActivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onBuiltinWorldActivated: state => { builtInActivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWorldFrame: state => { worldFrame = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWorldDeactivated: state => { worldDeactivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWorldExtensionResult: state => { extensionResult = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWebGLWorldFrame: state => { webglFrame = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWorldBlocksPlayerInput: state => { inputGate = state; return state.active && state.app?.testBlocksInput === true; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWorldKeyDown: state => { worldKeyDown = state; return state.active && state.event?.code === 'KeyE'; } } );
dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onHostedWorldActivated', { marker: 7 } );
assert.deepEqual( { active: worldActivation.active, data: worldActivation.data, behaviorId: worldActivation.behaviorId, marker: worldActivation.marker }, { active: true, data: {}, behaviorId: 'elsemesh.registry-test/1', marker: 7 }, 'registered handlers receive their active behavior data through generic dispatch' );
dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onWebGLWorldActivated', { marker: 8 } );
assert.deepEqual( { active: webglActivation.active, data: webglActivation.data, behaviorId: webglActivation.behaviorId, marker: webglActivation.marker }, { active: true, data: {}, behaviorId: 'elsemesh.registry-test/1', marker: 8 }, 'separate renderers can register different hooks for one behavior' );
dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onBuiltinWorldActivated', { marker: 9 } );
assert.equal( builtInActivation.active, true, 'built-in world behavior activation uses the same registry' );
dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onWorldFrame', { dt: 1 / 60 } );
assert.equal( worldFrame.dt, 1 / 60, 'browser behavior frame work is registry-dispatched' );
dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onWorldDeactivated', { mode: 'hosted' } );
assert.equal( worldDeactivation.mode, 'hosted', 'world teardown is registry-dispatched' );
dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onWebGLWorldFrame', { dt: 1 / 30 } );
assert.equal( webglFrame.dt, 1 / 30, 'WebGL behavior frame work is registry-dispatched' );
assert.equal( dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onWorldBlocksPlayerInput', { app: { testBlocksInput: true } } ), true, 'player input gating uses a renderer-neutral behavior hook' );
assert.equal( inputGate.active, true );
assert.equal( dispatchWorldBehaviorHooks( { behaviors: {} }, 'onWorldBlocksPlayerInput', { app: { testBlocksInput: true } } ), false, 'inactive behaviors cannot block player input' );
assert.equal( inputGate.active, false );
assert.equal( dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onWorldKeyDown', { event: { code: 'KeyE' } } ), true, 'world key actions use a backend-neutral behavior hook' );
assert.equal( worldKeyDown.active, true );
assert.equal( dispatchWorldBehaviorHooks( { behaviors: {} }, 'onWorldKeyDown', { event: { code: 'KeyE' } } ), false, 'inactive behaviors cannot claim keyboard input' );
assert.deepEqual( worldInputExtensionEvent( 'down', { code: 'KeyE', repeat: false, shiftKey: true, target: { value: 'private text must not be copied' } }, 'elsemesh:registry-test' ), {
	type: WORLD_EXTENSION_EVENT_INPUT, phase: 'down', code: 'KeyE', repeat: false,
	modifiers: { alt: false, control: false, meta: false, shift: true }, worldId: 'elsemesh:registry-test',
}, 'input bridge exposes only the key code, modifiers, phase, and world route' );
assert.throws( () => worldInputExtensionEvent( 'down', { code: 'a'.repeat( 33 ) } ), /Invalid world keyboard input/, 'input bridge rejects unbounded key strings' );
const inputUpdates = [];
const testApp = Object.assign( Object.create( App.prototype ), {
	freeCam: false,
	player: { update: dt => inputUpdates.push( [ 'walk', dt ] ), updateHostedWorld: dt => inputUpdates.push( [ 'hosted', dt ] ) },
	updateFreeCamera: dt => inputUpdates.push( [ 'free-camera', dt ] ),
	testBlocksInput: true,
} );
assert.equal( testApp.updatePlayerInput( 1 / 60, 'builtin', { behaviors: { [ behaviorID ]: {} } }, null ), false, 'App skips player movement when the active world blocks input' );
assert.deepEqual( inputUpdates, [], 'blocked input does not advance the player or free camera' );
testApp.testBlocksInput = false;
assert.equal( testApp.updatePlayerInput( 1 / 60, 'hosted', { behaviors: { [ behaviorID ]: {} } }, null ), true, 'App advances hosted player input when the world permits it' );
assert.deepEqual( inputUpdates, [ [ 'hosted', 1 / 60 ] ], 'hosted player update follows the world input gate' );
dispatchWorldBehaviorHooks( { behaviors: {} }, 'onHostedWorldActivated', {} );
assert.equal( worldActivation.active, false, 'registered handlers receive inactive lifecycle notifications for worlds without their behavior' );
assert.throws( () => registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onHostedWorldActivated: () => {} } ), /Invalid or duplicate/ );

class FakeWorker {
	terminated = false;
	messages = [];
	postMessage( message ) {
		this.messages.push( message );
		if ( message.type === 'init' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, type: 'ready' } } ) );
		if ( message.type === 'run' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, id: message.id, result: { echo: message.event } } } ) );
	}
	terminate() { this.terminated = true; }
}
const worker = new FakeWorker();
const extensionAssetID = `sha256:${'c'.repeat( 64 )}`;
const extensionExperience = { behaviors: { [ behaviorID ]: {} }, extensions: [ { behaviorId: behaviorID, assetId: extensionAssetID, events: [ WORLD_EXTENSION_EVENT_ACTIVATED ] } ] };
const extensions = createWorldBehaviorExtensions( extensionExperience, new Map( [ [ extensionAssetID, new TextEncoder().encode( 'export function run(event) { return { echo: event }; }' ) ] ] ), { workerFactory: () => worker } );
assert.equal( extensions.has( 'elsemesh.registry-test/1' ), true, 'the manager exposes registered Worker availability without custom hooks' );
const activatedEvent = { type: WORLD_EXTENSION_EVENT_ACTIVATED, worldId: 'elsemesh:registry-test' };
assert.deepEqual( await extensions.run( behaviorID, activatedEvent ), { echo: activatedEvent }, 'generic behavior extensions exchange bounded JSON through the Worker manager' );
assert.deepEqual( await dispatchWorldBehaviorExtensionEvent( extensionExperience, extensions, activatedEvent, { marker: 11 } ), [ { behaviorId: behaviorID, result: { echo: activatedEvent } } ], 'the Engine broadcasts only a signed event subscription to the world extension' );
assert.deepEqual( { behaviorId: extensionResult.behaviorId, active: extensionResult.active, data: extensionResult.data, marker: extensionResult.marker, event: extensionResult.event, result: extensionResult.result }, { behaviorId: behaviorID, active: true, data: {}, marker: 11, event: activatedEvent, result: { echo: activatedEvent } }, 'extension results return through the registered world behavior adapter' );
await dispatchWorldBehaviorExtensionEvent( extensionExperience, extensions, activatedEvent, { marker: 12, isCurrent: () => false } );
assert.equal( extensionResult.marker, 11, 'late extension results are ignored after a world switch' );
assert.deepEqual( worker.messages.filter( message => message.type === 'run' ).map( message => message.event.type ), [ 'initialize', WORLD_EXTENSION_EVENT_ACTIVATED, WORLD_EXTENSION_EVENT_ACTIVATED, WORLD_EXTENSION_EVENT_ACTIVATED ], 'the worker receives behavior data before direct and Engine-dispatched events' );
assert.equal( 'marker' in worker.messages.filter( message => message.type === 'run' )[ 2 ].event, false, 'Engine-only adapter context is not sent into the Worker' );
assert.deepEqual( await extensions.dispatch( { type: 'elsemesh.world.frame/1', dt: 1 / 60 } ), [], 'modules do not receive events outside their signed subscription list' );
await assert.rejects( extensions.run( behaviorID, { type: 'unknown' } ), /invalid test event/, 'event meaning stays in the registered behavior package' );
extensions.dispose();
assert.equal( worker.terminated, true, 'world extension teardown terminates its Worker' );

const worldOwnedBehaviorID = 'elsemesh.world-owned-test/1';
const worldOwnedExtensionExperience = {
	behaviors: { [ worldOwnedBehaviorID ]: { privateRule: 'module-owned' } },
	extensions: [ { behaviorId: worldOwnedBehaviorID, assetId: extensionAssetID, events: [ worldOwnedBehaviorID ] } ],
};
assert.deepEqual( worldBehaviorsFor( worldOwnedExtensionExperience ).map( ( { id } ) => id ), [ worldOwnedBehaviorID ], 'an owner-signed extension can define a behavior without an engine registration' );
const worldOwnedWorker = new FakeWorker();
const worldOwnedExtensions = createWorldBehaviorExtensions( worldOwnedExtensionExperience, new Map( [ [ extensionAssetID, new TextEncoder().encode( 'export function run(event) { return { accepted: event }; }' ) ] ] ), { workerFactory: () => worldOwnedWorker } );
assert.deepEqual( await worldOwnedExtensions.ready( worldOwnedBehaviorID ), { echo: { type: 'initialize', behaviorData: { privateRule: 'module-owned' } } }, 'the generic Worker initialization receives its owner-authored behavior data' );
assert.deepEqual( await worldOwnedExtensions.run( worldOwnedBehaviorID, { action: 'world-specific' } ), { echo: { action: 'world-specific' } }, 'unregistered world behavior messages are delegated to the owner module' );
assert.deepEqual( await worldOwnedExtensions.dispatch( { type: 'elsemesh.world.event/1', value: 3 } ), [], 'an extension receives no generic event unless its signed reference subscribes' );
assert.deepEqual( await worldOwnedExtensions.dispatch( { type: 'elsemesh.world-owned-test/1', value: 3 } ), [ { behaviorId: worldOwnedBehaviorID, result: { echo: { type: 'elsemesh.world-owned-test/1', value: 3 } } } ], 'the Engine can broadcast subscribed events to owner-defined extensions without a built-in behavior registration' );
worldOwnedExtensions.dispose();
assert.equal( worldOwnedWorker.terminated, true, 'owner-defined behavior worker is terminated with its world' );

const inputExtensionExperience = {
	behaviors: { [ worldOwnedBehaviorID ]: { privateRule: 'module-owned' } },
	extensions: [ { behaviorId: worldOwnedBehaviorID, assetId: extensionAssetID, events: [ WORLD_EXTENSION_EVENT_INPUT ] } ],
};
const inputWorker = new FakeWorker();
const inputExtensions = createWorldBehaviorExtensions( inputExtensionExperience, new Map( [ [ extensionAssetID, new TextEncoder().encode( 'export function run(event) { return { accepted: event }; }' ) ] ] ), { workerFactory: () => inputWorker } );
const inputKey = { code: 'KeyR', shiftKey: true, target: { value: 'not forwarded' } };
assert.equal( App.prototype.handleWorldKeyDown.call( {
	remoteWorldActive: false,
	localWorldExperience: inputExtensionExperience,
	localWorldExtensions: inputExtensions,
	isCurrentWorldExtensions: () => true,
}, inputKey ), true, 'App routes and consumes a subscribed key through the signed world Worker' );
assert.deepEqual( await dispatchWorldInputExtensionEvent( inputExtensionExperience, inputExtensions, 'down', inputKey, { worldId: 'elsemesh:input-test' } ), [ {
	behaviorId: worldOwnedBehaviorID,
	result: { echo: { type: WORLD_EXTENSION_EVENT_INPUT, phase: 'down', code: 'KeyR', repeat: false, modifiers: { alt: false, control: false, meta: false, shift: true }, worldId: 'elsemesh:input-test' } },
} ], 'signed Worker input subscriptions receive the normalized renderer-neutral event' );
assert.deepEqual( inputWorker.messages.filter( message => message.type === 'run' ).at( -1 ).event, {
	type: WORLD_EXTENSION_EVENT_INPUT, phase: 'down', code: 'KeyR', repeat: false,
	modifiers: { alt: false, control: false, meta: false, shift: true }, worldId: 'elsemesh:input-test',
}, 'Worker message excludes DOM event objects and text-entry fields' );
inputExtensions.dispose();

const frameBehaviorID = 'elsemesh.frame-bridge-test/1';
let latestFrameResult = null;
registerWorldBehavior( frameBehaviorID, {
	validateExtensionEvent: event => { if ( event.type !== WORLD_EXTENSION_EVENT_FRAME ) throw new Error( 'unexpected frame event' ); },
	validateExtensionResult: ( result, event ) => { if ( result.echo?.sequence !== event.sequence ) throw new Error( 'invalid frame result' ); },
} );
registerWorldBehaviorImplementation( frameBehaviorID, { onWorldExtensionResult: state => { latestFrameResult = state; } } );
const frameAssetID = `sha256:${'d'.repeat( 64 )}`;
const frameExperience = { behaviors: { [ frameBehaviorID ]: {} }, extensions: [ { behaviorId: frameBehaviorID, assetId: frameAssetID, events: [ WORLD_EXTENSION_EVENT_FRAME ] } ] };
class BlockingWorker extends FakeWorker {
	blocked = [];
	postMessage( message ) {
		this.messages.push( message );
		if ( message.type === 'init' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, type: 'ready' } } ) );
		else if ( message.type === 'run' && message.event.type === 'initialize' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, id: message.id, result: { echo: message.event } } } ) );
		else if ( message.type === 'run' ) this.blocked.push( message );
	}
	respond( message ) {
		this.blocked.splice( this.blocked.indexOf( message ), 1 );
		this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, id: message.id, result: { echo: message.event } } } );
	}
}
const frameWorker = new BlockingWorker();
const frameExtensions = createWorldBehaviorExtensions( frameExperience, new Map( [ [ frameAssetID, new TextEncoder().encode( 'export function run(event) { return { echo: event }; }' ) ] ] ), { workerFactory: () => frameWorker } );
assert.equal( frameExtensions.subscribes( WORLD_EXTENSION_EVENT_FRAME ), true, 'the Worker manager exposes signed event subscriptions to the engine' );
assert.equal( frameExtensions.subscribes( WORLD_EXTENSION_EVENT_ACTIVATED ), false, 'activation is not delivered without an explicit signed subscription' );
const waitFor = async predicate => {
	const deadline = Date.now() + 1500;
	while ( ! predicate() ) {
		if ( Date.now() >= deadline ) throw new Error( 'Timed out waiting for the frame Worker bridge' );
		await new Promise( resolve => setTimeout( resolve, 2 ) );
	}
};
const frameApp = {
	worldExtensionGeneration: 0,
	worldExtensionFrameSequence: 0,
	localWorldExtensions: frameExtensions,
	activeHostedExtensions: null,
	webglFallback: null,
	isCurrentWorldExtensions: App.prototype.isCurrentWorldExtensions,
};
App.prototype.dispatchWorldActivated.call( frameApp, frameExperience, frameExtensions, 'elsemesh:frame-test', { mode: 'hosted' } );
assert.equal( frameApp.worldExtensionGeneration, 1, 'world activation establishes the generation even when the Worker only subscribes to frame events' );
const playerSnapshot = { position: { x: 1, y: 2, z: 3 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0.4, pitch: -0.1, mode: 'walk', grounded: true, avatarProfileId: 'elsemesh.avatar.stock-male/1', vehicleType: null };
const publishFrame = () => {
	playerSnapshot.position.x = frameApp.worldExtensionFrameSequence + 1;
	App.prototype.dispatchWorldFrameEvent.call( frameApp, frameExperience, frameExtensions, 'elsemesh:frame-test', 1 / 60, frameApp.worldExtensionFrameSequence / 60, playerSnapshot );
};
publishFrame();
await waitFor( () => frameWorker.blocked.length === 1 );
publishFrame();
publishFrame();
frameWorker.respond( frameWorker.blocked[ 0 ] );
await waitFor( () => frameWorker.blocked.length === 1 && frameWorker.blocked[ 0 ].event.sequence === 3 );
assert.ok( Math.abs( frameWorker.blocked[ 0 ].event.dt - 2 / 60 ) < 1e-9, 'coalescing accumulates elapsed simulation delta while retaining the latest snapshot' );
frameWorker.respond( frameWorker.blocked[ 0 ] );
await waitFor( () => latestFrameResult?.event.sequence === 3 );
assert.equal( frameWorker.messages.filter( message => message.type === 'run' && message.event.type === WORLD_EXTENSION_EVENT_FRAME ).length, 2, 'the latest-only frame lane skips superseded snapshots instead of queueing every frame' );
assert.equal( latestFrameResult.result.echo.avatar.position[ 0 ], 3, 'the Worker receives plain renderer-neutral avatar state' );
assert.equal( latestFrameResult.result.echo.avatar.yaw, 0.4, 'the frame snapshot carries renderer-neutral avatar orientation' );
frameExtensions.dispose();
assert.equal( frameWorker.terminated, true, 'disposing a world clears and terminates its coalesced event Worker' );

console.log( 'world behavior registry: ok' );
