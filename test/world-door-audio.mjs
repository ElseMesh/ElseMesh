import assert from 'node:assert/strict';
import { createWorldDoorAudioObserver } from '../src/network/WorldDoorAudio.js';

const soundID = `sha256:${'b'.repeat( 64 )}`;
const bytes = new Uint8Array( [ 1, 2, 3 ] );
const doorID = 'elsemesh-component:hall-door';
let requested = 0;
const played = [];
const connector = {
	worldId: 'elsemesh:test-world',
	manifest: {
		assets: [ { id: soundID, kind: 'audio/ogg', bytes: 3 } ],
		components: [ { id: doorID, type: 'elsemesh.interactive-door/1', data: { position: [ 3, 1, -2 ] } } ],
	},
	async getAsset( id ) { requested++; assert.equal( id, soundID ); return bytes; },
};
const audio = { enabled: true, playWorldOneShot: async ( ...event ) => { played.push( event ); return true; } };
const observe = createWorldDoorAudioObserver( audio, connector );
observe( [], [ { id: doorID, eventId: `${doorID}:1`, soundAssetId: soundID } ] );
observe( [], [ { id: doorID, eventId: `${doorID}:2`, soundAssetId: `sha256:${'c'.repeat( 64 )}` } ] );
await new Promise( resolve => setImmediate( resolve ) );
assert.equal( requested, 1, 'only a signed OGG listed in the world manifest is requested' );
assert.equal( played.length, 1, 'one valid world door transition reaches the shared audio engine' );
assert.equal( played[ 0 ][ 0 ], connector.worldId );
assert.equal( played[ 0 ][ 1 ], `${doorID}:1` );
assert.equal( played[ 0 ][ 2 ], soundID );
assert.equal( played[ 0 ][ 3 ], bytes );
assert.deepEqual( played[ 0 ][ 4 ], [ 3, 1, -2 ] );
createWorldDoorAudioObserver( { enabled: false, playWorldOneShot() { assert.fail( 'disabled audio must not fetch or play door audio' ); } }, connector )( [], [ { id: doorID, eventId: `${doorID}:3`, soundAssetId: soundID } ] );
await new Promise( resolve => setImmediate( resolve ) );
assert.equal( requested, 1, 'disabled browser audio does not fetch transition assets' );
const oversized = { ...connector, manifest: { ...connector.manifest, assets: [ { id: soundID, kind: 'audio/ogg', bytes: 16 * 1024 * 1024 + 1 } ] } };
createWorldDoorAudioObserver( audio, oversized )( [], [ { id: doorID, eventId: `${doorID}:4`, soundAssetId: soundID } ] );
await new Promise( resolve => setImmediate( resolve ) );
assert.equal( requested, 1, 'oversized one-shot assets are rejected before download' );
console.log( 'ok signed world door event audio routing' );
