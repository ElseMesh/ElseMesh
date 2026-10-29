import assert from 'node:assert/strict';
import { BUILTIN_WORLD_EXPERIENCE, createWorldBehaviorExtensions, createWorldBehaviorRuntime, dispatchWorldBehaviorHooks, hasWorldBehavior, registerWorldBehavior, registerWorldBehaviorImplementation, worldBehaviorData, worldBehaviorsFor } from '../src/network/WorldBehaviorRegistry.js';
import { WORLD_JAVASCRIPT_EXTENSION_PROTOCOL } from '../src/network/WorldJavaScriptExtension.js';
import { FishingGameRuntime } from '../src/game/FishingGameRuntime.js';

const biteRateSchedule = { defaultMultiplier: 1, windows: [ { startHour: 0, endHour: 5, multiplier: 0.8 }, { startHour: 5, endHour: 8.1, multiplier: 1.4 }, { startHour: 17, endHour: 20.1, multiplier: 1.4 }, { startHour: 22, endHour: 24, multiplier: 0.8 } ] };
const experience = { behaviors: { 'elsemesh.fishing-game/1': { fishStand: { position: [ 12, -8 ], yaw: 1.2, interactionRadius: 4 }, biteRateSchedule }, 'elsemesh.shore-aware-boat/1': {} } };
assert.deepEqual( worldBehaviorsFor( BUILTIN_WORLD_EXPERIENCE ).map( behavior => behavior.id ), [ 'elsemesh.fishing-game/1' ], 'offline built-in gameplay is activated through its registered behavior descriptor' );
assert.deepEqual( worldBehaviorsFor( experience ).map( ( { id } ) => id ), [ 'elsemesh.fishing-game/1', 'elsemesh.shore-aware-boat/1' ] );
assert.deepEqual( worldBehaviorData( experience, 'elsemesh.fishing-game/1' ).fishStand, experience.behaviors[ 'elsemesh.fishing-game/1' ].fishStand, 'behavior-owned experience data is available through the registry' );
const runtime = createWorldBehaviorRuntime( experience, 'elsemesh.fishing-game/1', { worldId: 'elsemesh:registry-test', load: false } );
const otherRuntime = createWorldBehaviorRuntime( { behaviors: { 'elsemesh.fishing-game/1': {} } }, 'elsemesh.fishing-game/1', { worldId: 'elsemesh:registry-test-other', load: false } );
assert.ok( runtime instanceof FishingGameRuntime );
assert.notEqual( runtime, otherRuntime, 'each world receives its own registered gameplay runtime' );
assert.notEqual( runtime.state, otherRuntime.state, 'world runtimes do not share game state' );
assert.notEqual( runtime.state.storageKey, otherRuntime.state.storageKey, 'world runtimes persist under distinct world identities' );
assert.equal( runtime.state.storageKey, 'elsemesh.save.v1:elsemesh%3Aregistry-test', 'registered game runtime receives its owning world identity' );
runtime.bite = { phase: 'wait', t: 5 };
runtime.stepBite( 1, { habitat: () => ( { shallows: 1 } ), hour: 6.5 } );
assert.equal( runtime.bite.t, 3.6, 'signed declarative fishing rules change local browser bite-wait timing' );
assert.equal( otherRuntime.biteRateSchedule, undefined, 'a world without a bite-rate rule retains the default game behavior' );
assert.throws( () => worldBehaviorsFor( { behaviors: { 'elsemesh.fishing-game/1': { biteRateSchedule: { defaultMultiplier: 1, windows: [ { startHour: 4, endHour: 6, multiplier: 1.2 }, { startHour: 5, endHour: 7, multiplier: 1.3 } ] } } } } ), /Invalid fishing bite-rate schedule window/ );
assert.equal( hasWorldBehavior( experience, 'elsemesh.fishing-game/1' ), true );
assert.throws( () => worldBehaviorsFor( { behaviors: { 'tidewater.fishing-game/1': {} } } ), /Invalid world behavior ID/, 'world-owned behavior IDs stay inside the ElseMesh namespace' );
assert.throws( () => registerWorldBehavior( 'elsemesh.invalid/1', {} ), /Invalid world behavior/ );

registerWorldBehavior( 'elsemesh.registry-test/1', {
	validateExperienceData: data => { if ( Object.keys( data ).length ) throw new Error( 'invalid test data' ); },
	validateExtensionEvent: event => { if ( event.type !== 'ping' ) throw new Error( 'invalid test event' ); },
	validateExtensionResult: result => { if ( result.echo?.type !== 'ping' ) throw new Error( 'invalid test result' ); },
} );
assert.equal( hasWorldBehavior( { behaviors: { 'elsemesh.registry-test/1': {} } }, 'elsemesh.registry-test/1' ), true );
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
	postMessage( message ) {
		if ( message.type === 'init' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, type: 'ready' } } ) );
		if ( message.type === 'run' ) queueMicrotask( () => this.onmessage( { data: { protocol: WORLD_JAVASCRIPT_EXTENSION_PROTOCOL, id: message.id, result: { echo: message.event } } } ) );
	}
	terminate() { this.terminated = true; }
}
const worker = new FakeWorker();
const extensionAssetID = `sha256:${'c'.repeat( 64 )}`;
const extensionExperience = { behaviors: { 'elsemesh.registry-test/1': {} }, extensions: [ { behaviorId: 'elsemesh.registry-test/1', assetId: extensionAssetID } ] };
const extensions = createWorldBehaviorExtensions( extensionExperience, new Map( [ [ extensionAssetID, new TextEncoder().encode( 'export function run(event) { return { echo: event }; }' ) ] ] ), { workerFactory: () => worker } );
assert.deepEqual( await extensions.run( 'elsemesh.registry-test/1', { type: 'ping' } ), { echo: { type: 'ping' } }, 'generic behavior extensions exchange bounded JSON through the Worker manager' );
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
assert.deepEqual( await worldOwnedExtensions.run( worldOwnedBehaviorID, { action: 'world-specific' } ), { echo: { action: 'world-specific' } }, 'unregistered world behavior messages are delegated to the owner module' );
worldOwnedExtensions.dispose();
assert.equal( worldOwnedWorker.terminated, true, 'owner-defined behavior worker is terminated with its world' );

console.log( 'world behavior registry: ok' );
