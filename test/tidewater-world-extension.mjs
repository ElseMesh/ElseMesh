import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorldExtensions } from '../src/network/WorldExtensionHost.js';
import { dispatchWorldExtensionState, createWorldBehaviorRuntime } from '../src/network/WorldBehaviorRegistry.js';
import { FishingGameRuntime } from '../src/game/FishingGameRuntime.js';
import { validateWorldSource } from '../src/network/WorldSource.js';

const repo = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const source = validateWorldSource( JSON.parse( await readFile( path.join( repo, 'worlds/tidewater/world-source.json' ), 'utf8' ) ) );
assert.ok( source.rules.requiredFeatures.includes( 'elsemesh.world-extension/1' ) );
const descriptor = source.extensions[ 0 ];
const bytes = new Uint8Array( await readFile( path.join( repo, 'worlds/tidewater/assets', descriptor.assetId.slice( 'sha256:'.length ) ) ) );
assert.equal( `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`, descriptor.assetId );
assert.equal( validateWorldExtensions( source.extensions, [ { id: descriptor.assetId, kind: 'application/wasm', bytes: bytes.length } ], source.experience )[ 0 ], descriptor );

const messages = [];
globalThis.self = { postMessage: message => messages.push( message ) };
await import( '../src/network/WorldExtensionWorker.js?tidewater-world-package' );
const send = async message => {
	await globalThis.self.onmessage( { data: message } );
	return messages.at( - 1 );
};
const moduleBytes = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
assert.deepEqual( await send( { type: 'load', bytes: moduleBytes, memoryPages: descriptor.memoryPages } ), { type: 'ready' } );
assert.deepEqual( await send( { type: 'init', requestId: 1, input: {} } ), { type: 'result', requestId: 1, value: { biteRateMultiplier: 1 } } );

const runtime = createWorldBehaviorRuntime( source.experience, descriptor.behaviorId, { load: false, worldId: source.worldId } );
assert.ok( runtime instanceof FishingGameRuntime );
for ( const [ requestId, hour, expected ] of [ [ 2, 6.5, 1.4 ], [ 3, 12, 1 ], [ 4, 23, 0.8 ] ] ) {
	const result = await send( { type: 'step', requestId, input: { timeOfDay: hour } } );
	assert.deepEqual( result, { type: 'result', requestId, value: { biteRateMultiplier: expected } } );
	dispatchWorldExtensionState( source.experience, descriptor.behaviorId, descriptor.id, result.value, { gameRuntime: runtime } );
	assert.equal( runtime.biteRateMultiplier, expected );
}
runtime.bite = { phase: 'wait', t: 5 };
runtime.stepBite( 1, { habitat: () => ( { shallows: 1 } ), hour: 18 } );
assert.equal( runtime.bite.t, 4.2, 'the packaged Wasm state affects browser gameplay through the shared runtime' );
for ( let requestId = 5; requestId < 5005; requestId ++ ) {
	const result = await send( { type: 'step', requestId, input: { timeOfDay: 12 } } );
	assert.equal( result.value.biteRateMultiplier, 1 );
}

console.log( 'Tidewater signed-world extension asset: validation, worker ABI, behavior dispatch, local gameplay effect and repeated steps passed' );
