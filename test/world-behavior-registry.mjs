import assert from 'node:assert/strict';
import { createWorldBehaviorExtensions, createWorldBehaviorRuntime, dispatchWorldBehaviorHooks, hasWorldBehavior, registerWorldBehavior, registerWorldBehaviorImplementation, worldBehaviorData, worldBehaviorsFor } from '../src/network/WorldBehaviorRegistry.js';
import { WORLD_JAVASCRIPT_EXTENSION_PROTOCOL } from '../src/network/WorldJavaScriptExtension.js';

registerWorldBehavior( 'elsemesh.registry-test/1', {
	validateExperienceData: data => { if ( Object.keys( data ).length ) throw new Error( 'invalid test data' ); },
	validateExtensionEvent: event => { if ( event.type !== 'ping' ) throw new Error( 'invalid test event' ); },
	validateExtensionResult: result => { if ( result.echo?.type !== 'ping' ) throw new Error( 'invalid test result' ); },
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
let webglKey = null;
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onHostedWorldActivated: state => { worldActivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWebGLWorldActivated: state => { webglActivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onBuiltinWorldActivated: state => { builtInActivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWorldFrame: state => { worldFrame = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWorldDeactivated: state => { worldDeactivation = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWebGLWorldFrame: state => { webglFrame = state; } } );
registerWorldBehaviorImplementation( 'elsemesh.registry-test/1', { onWebGLKeyDown: state => { webglKey = state; return state.active && state.code === 'KeyE'; } } );
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
assert.equal( dispatchWorldBehaviorHooks( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'onWebGLKeyDown', { code: 'KeyE' } ), true, 'input hooks can claim a behavior-specific key' );
assert.equal( dispatchWorldBehaviorHooks( { behaviors: {} }, 'onWebGLKeyDown', { code: 'KeyE' } ), false, 'inactive behaviors cannot claim input' );
assert.equal( webglKey.active, false );
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
const extensionExperience = { behaviors: { [ behaviorID ]: {} }, extensions: [ { behaviorId: behaviorID, assetId: extensionAssetID } ] };
const extensions = createWorldBehaviorExtensions( extensionExperience, new Map( [ [ extensionAssetID, new TextEncoder().encode( 'export function run(event) { return { echo: event }; }' ) ] ] ), { workerFactory: () => worker } );
assert.equal( extensions.has( 'elsemesh.registry-test/1' ), true, 'the manager exposes registered Worker availability without custom hooks' );
assert.deepEqual( await extensions.run( 'elsemesh.registry-test/1', { type: 'ping' } ), { echo: { type: 'ping' } }, 'generic behavior extensions exchange bounded JSON through the Worker manager' );
assert.deepEqual( worker.messages.filter( message => message.type === 'run' ).map( message => message.event.type ), [ 'initialize', 'ping' ], 'the worker receives behavior data before normal events' );
await assert.rejects( extensions.run( 'elsemesh.registry-test/1', { type: 'unknown' } ), /invalid test event/, 'event meaning stays in the registered behavior package' );
extensions.dispose();
assert.equal( worker.terminated, true, 'world extension teardown terminates its Worker' );

const worldOwnedBehaviorID = 'elsemesh.world-owned-test/1';
const worldOwnedExtensionExperience = {
	behaviors: { [ worldOwnedBehaviorID ]: { privateRule: 'module-owned' } },
	extensions: [ { behaviorId: worldOwnedBehaviorID, assetId: extensionAssetID } ],
};
assert.deepEqual( worldBehaviorsFor( worldOwnedExtensionExperience ).map( ( { id } ) => id ), [ worldOwnedBehaviorID ], 'an owner-signed extension can define a behavior without an engine registration' );
const worldOwnedWorker = new FakeWorker();
const worldOwnedExtensions = createWorldBehaviorExtensions( worldOwnedExtensionExperience, new Map( [ [ extensionAssetID, new TextEncoder().encode( 'export function run(event) { return { accepted: event }; }' ) ] ] ), { workerFactory: () => worldOwnedWorker } );
assert.deepEqual( await worldOwnedExtensions.ready( worldOwnedBehaviorID ), { echo: { type: 'initialize', behaviorData: { privateRule: 'module-owned' } } }, 'the generic Worker initialization receives its owner-authored behavior data' );
assert.deepEqual( await worldOwnedExtensions.run( worldOwnedBehaviorID, { action: 'world-specific' } ), { echo: { action: 'world-specific' } }, 'unregistered world behavior messages are delegated to the owner module' );
worldOwnedExtensions.dispose();
assert.equal( worldOwnedWorker.terminated, true, 'owner-defined behavior worker is terminated with its world' );

console.log( 'world behavior registry: ok' );
