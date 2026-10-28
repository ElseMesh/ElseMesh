import assert from 'node:assert/strict';
import { createWorldBehaviorRuntime, dispatchWorldExtensionState, hasWorldBehavior, registerWorldBehavior, worldBehaviorsFor } from '../src/network/WorldBehaviorRegistry.js';
import { FishingGameRuntime } from '../src/game/FishingGameRuntime.js';

const experience = { behaviors: [ 'elsemesh.fishing-game/1', 'elsemesh.shore-aware-boat/1' ] };
assert.deepEqual( worldBehaviorsFor( experience ).map( ( { id, fishingGame, shoreAwareBoat, onExtensionState } ) => ( { id, fishingGame, shoreAwareBoat, consumesExtensionState: typeof onExtensionState === 'function' } ) ), [
	{ id: 'elsemesh.fishing-game/1', fishingGame: true, shoreAwareBoat: undefined, consumesExtensionState: true },
	{ id: 'elsemesh.shore-aware-boat/1', fishingGame: undefined, shoreAwareBoat: true, consumesExtensionState: false },
] );
const runtime = createWorldBehaviorRuntime( experience, 'elsemesh.fishing-game/1', { worldId: 'elsemesh:registry-test', load: false } );
const otherRuntime = createWorldBehaviorRuntime( experience, 'elsemesh.fishing-game/1', { worldId: 'elsemesh:registry-test-other', load: false } );
assert.ok( runtime instanceof FishingGameRuntime );
assert.notEqual( runtime, otherRuntime, 'each world receives its own registered gameplay runtime' );
assert.notEqual( runtime.state, otherRuntime.state, 'world runtimes do not share game state' );
assert.notEqual( runtime.state.storageKey, otherRuntime.state.storageKey, 'world runtimes persist under distinct world identities' );
assert.equal( runtime.state.storageKey, 'elsemesh.save.v1:elsemesh%3Aregistry-test', 'registered game runtime receives its owning world identity' );
dispatchWorldExtensionState( experience, 'elsemesh.fishing-game/1', 'elsemesh-extension:fishing-rhythm', { biteRateMultiplier: 1.5 }, { gameRuntime: runtime } );
assert.equal( runtime.biteRateMultiplier, 1.5, 'registered fishing behavior applies signed extension state in the browser runtime' );
assert.equal( otherRuntime.biteRateMultiplier, 1, 'one world extension cannot mutate another world gameplay runtime' );
runtime.bite = { phase: 'wait', t: 5 };
runtime.stepBite( 1, { habitat: () => ( { shallows: 1 } ), hour: 12 } );
assert.equal( runtime.bite.t, 3.5, 'extension rate changes local browser bite-wait timing' );
assert.throws( () => dispatchWorldExtensionState( experience, 'elsemesh.fishing-game/1', 'elsemesh-extension:fishing-rhythm', { biteRateMultiplier: 20 }, { gameRuntime: runtime } ), /Invalid fishing extension state/ );
assert.throws( () => dispatchWorldExtensionState( experience, 'elsemesh.fishing-game/1', 'elsemesh-extension:fishing-rhythm', { biteRateMultiplier: 1 }, {} ), /no active browser game runtime/ );
assert.equal( hasWorldBehavior( experience, 'elsemesh.fishing-game/1' ), true );
assert.throws( () => worldBehaviorsFor( { behaviors: [ 'tidewater.fishing-game/1' ] } ), /does not support required world behavior/ );
assert.throws( () => registerWorldBehavior( 'elsemesh.invalid/1', {} ), /Invalid world behavior/ );

registerWorldBehavior( 'elsemesh.registry-test/1', { fishingGame: true } );
assert.equal( hasWorldBehavior( { behaviors: [ 'elsemesh.registry-test/1' ] }, 'elsemesh.registry-test/1' ), true );
assert.throws( () => registerWorldBehavior( 'elsemesh.registry-test/1', { fishingGame: true } ), /Invalid or duplicate/ );

let consumed = null;
registerWorldBehavior( 'elsemesh.extension-consumer/1', { onExtensionState: value => { consumed = value; } } );
	const extensionState = { extensionId: 'elsemesh-extension:simulation', state: { tick: 7 }, root: {}, connector: {} };
	dispatchWorldExtensionState( { behaviors: [ 'elsemesh.extension-consumer/1' ] }, 'elsemesh.extension-consumer/1', extensionState.extensionId, extensionState.state, { root: extensionState.root, connector: extensionState.connector } );
assert.equal( consumed.extensionId, extensionState.extensionId );
assert.equal( consumed.state, extensionState.state );
assert.equal( consumed.root, extensionState.root );
assert.equal( consumed.connector, extensionState.connector );

console.log( 'world behavior registry: ok' );
