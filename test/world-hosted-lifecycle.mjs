import assert from 'node:assert/strict';
import { App } from '../src/App.js';
import { registerWorldBehavior, registerWorldBehaviorImplementation, WORLD_EXTENSION_EVENT_ACTIVATED } from '../src/network/WorldBehaviorRegistry.js';

const behaviorID = 'elsemesh.hosted-lifecycle-test/1';
registerWorldBehavior( behaviorID, {
	validateExtensionEvent: event => { if ( event.type !== WORLD_EXTENSION_EVENT_ACTIVATED ) throw new Error( 'unexpected world event' ); },
	validateExtensionResult: ( result, event ) => { if ( result.echo?.type !== event.type ) throw new Error( 'unexpected world event result' ); },
} );
let resolveExtensionResult;
const extensionResult = new Promise( resolve => { resolveExtensionResult = resolve; } );
registerWorldBehaviorImplementation( behaviorID, { onWorldExtensionResult: state => resolveExtensionResult( state ) } );

class FakeWorker {
	terminated = false;
	onmessage = null;
	postMessage( message ) {
		if ( message.type === 'init' ) queueMicrotask( () => this.onmessage( { data: { protocol: 'elsemesh.world-extension/1', type: 'ready' } } ) );
		if ( message.type === 'run' ) queueMicrotask( () => this.onmessage( { data: { protocol: 'elsemesh.world-extension/1', id: message.id, result: { echo: message.event } } } ) );
	}
	terminate() { this.terminated = true; }
}
const originalWorker = globalThis.Worker;
let worker;
globalThis.Worker = class extends FakeWorker { constructor() { super(); worker = this; } };

const app = Object.create( App.prototype );
const surface = {}, query = { allocate: () => 9 };
Object.assign( app, {
	player: { boat: null, mode: 'walk', velocity: { set() {} }, audio: null },
	localLights: { setWorldPackage() {} },
	hostedQueries: new WeakMap( [ [ surface, query ] ] ),
	hostedWaterSurface: surface,
	hostedColliders: {},
	hostedQuery: query,
	hostedPlayerSlot: 0,
	worldPresence: null,
	worldExtensionGeneration: 0,
	activeHostedBoat: null,
	activeHostedExperience: null,
	activeHostedExtensions: null,
	activeHostedWildlife: null,
	activeHostedWhale: null,
	activeHostedOcean: false,
	hostedBreakers: null,
	hostedSurfaceState: null,
} );

assert.doesNotThrow( () => app.deactivateHostedWorld(), 'hosted teardown works when no built-in island services were created' );
assert.equal( app.underwaterLighting, null, 'hosted teardown leaves no fabricated built-in lighting service' );
assert.equal( app.activeHostedBoat, null );

const worldId = 'elsemesh:hosted-lifecycle-test';
const assetId = `sha256:${'d'.repeat( 64 )}`;
const experience = {
	behaviors: { [ behaviorID ]: {} },
	extensions: [ { behaviorId: behaviorID, assetId, events: [ WORLD_EXTENSION_EVENT_ACTIVATED ] } ],
};
const connector = { worldId, manifest: { experience, components: [], objects: [], rules: {} }, assets: new Map( [ [ assetId, new TextEncoder().encode( 'export function run(event) { return { echo: event }; }' ) ] ] ), localOnly: true };
const root = { userData: { worldComponents: [] } };
assert.doesNotThrow( () => app.activateHostedWorld( root, connector ), 'hosted activation accepts only the renderer-neutral player and water-query services' );
assert.equal( app.player.query, query );
assert.equal( app.player.slot, 9 );
assert.equal( app.player.hostedSeaLevel, null );
const activated = await extensionResult;
assert.equal( activated.event.type, WORLD_EXTENSION_EVENT_ACTIVATED, 'hosted App activation dispatches the subscribed Worker event' );
assert.equal( activated.event.worldId, worldId );
assert.equal( activated.result.echo.worldId, worldId );
app.deactivateHostedWorld();
assert.equal( worker.terminated, true, 'hosted world departure terminates its extension Worker' );
globalThis.Worker = originalWorker;
console.log( 'hosted lifecycle tears down cleanly and dispatches subscribed extension events through App' );
