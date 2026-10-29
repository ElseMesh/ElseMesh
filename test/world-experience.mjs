import assert from 'node:assert/strict';
import { GENERIC_WORLD_EXPERIENCE, validateWorldExperience } from '../src/network/WorldExperience.js';

assert.match( GENERIC_WORLD_EXPERIENCE.tagline, /place shaped by its owner/i, 'remote worlds without copy use neutral loader text' );
assert.equal( Object.values( GENERIC_WORLD_EXPERIENCE.stages ).every( ( text ) => text.includes( 'ThruHold' ) ), true, 'generic stage labels do not impose game-specific copy' );
assert.equal( GENERIC_WORLD_EXPERIENCE.behaviors, undefined, 'the generic loading presentation does not select world behavior' );
const fishing = { fishStand: { position: [ 12, -8 ], yaw: 1.2, interactionRadius: 4 }, chandlery: { position: [ 30, 5 ], yaw: -0.5, interactionRadius: 3 } };
assert.deepEqual( validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, behaviors: { 'elsemesh.fishing-game/1': fishing } } ).behaviors[ 'elsemesh.fishing-game/1' ], fishing, 'behavior-owned vendor placements are validated by their registry entry' );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, behaviors: { 'elsemesh.fishing-game/1': { fishStand: { position: [ 1 ], yaw: 0, interactionRadius: 3 } } } } ), /fishing location/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, behaviors: { 'elsemesh.unregistered/1': {} } } ), /does not support required world behavior/ );
const wasmAssetID = `sha256:${'a'.repeat( 64 )}`;
const wasmExtension = { behaviorId: 'elsemesh.fishing-game/1', assetId: wasmAssetID };
const withWasm = { ...GENERIC_WORLD_EXPERIENCE, behaviors: { 'elsemesh.fishing-game/1': fishing }, extensions: [ wasmExtension ] };
assert.deepEqual( validateWorldExperience( withWasm ).extensions, [ wasmExtension ], 'world Wasm modules bind to a declared registered behavior' );
assert.doesNotThrow( () => validateWorldExperience( withWasm, [ { id: wasmAssetID, kind: 'wasm/1', bytes: 8, priority: 'visible' } ] ), 'signed wasm/1 asset matches the bounded module reference' );
for ( const asset of [ undefined, { id: wasmAssetID, kind: 'glb', bytes: 8, priority: 'visible' }, { id: wasmAssetID, kind: 'wasm/1', bytes: 1024 * 1024 + 1, priority: 'visible' }, { id: wasmAssetID, kind: 'wasm/1', bytes: 8, priority: 'background' } ] ) assert.throws( () => validateWorldExperience( withWasm, asset ? [ asset ] : [] ), /invalid Wasm asset reference/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, extensions: [ wasmExtension ] } ), /Invalid world Wasm extension reference/ );
assert.throws( () => validateWorldExperience( { ...withWasm, extensions: [ wasmExtension, wasmExtension ] } ), /Invalid world Wasm extension reference/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, extra: 'not allowed' } ), /descriptor/ );
const markupText = '<script>alert(1)</script>';
assert.equal( validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, tips: [ markupText ] } ).tips[ 0 ], markupText, 'authored text remains data for the UI text renderer, never HTML' );
const themed = validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { logo: { src: '/world/logo.svg', alt: 'World logo' }, colors: { accent: '#c6a664', button: '#302d35' } } } );
assert.equal( themed.theme.logo.src, '/world/logo.svg', 'world-owned logo assets can be declared by path' );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { colors: { accent: 'red' } } } ), /theme colors/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { logo: { src: 'javascript:alert(1)', alt: 'bad' } } } ), /loading logo/ );

console.log( 'ok   world-owned loading copy and validated visual themes with a neutral remote fallback' );
