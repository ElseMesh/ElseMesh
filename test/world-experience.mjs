import assert from 'node:assert/strict';
import { registerWorldBehavior } from '../src/network/WorldBehaviorRegistry.js';
import { GENERIC_WORLD_EXPERIENCE, validateWorldExperience, worldTimeOfDay } from '../src/network/WorldExperience.js';

const behaviorID = 'elsemesh.fixture-world-experience/1';
registerWorldBehavior( behaviorID, {
	validateExperienceData: data => { if ( ! Number.isSafeInteger( data.seed ) ) throw new Error( 'fixture behavior requires a safe integer seed' ); },
} );

assert.match( GENERIC_WORLD_EXPERIENCE.tagline, /place shaped by its owner/i, 'remote worlds without copy use neutral loader text' );
assert.equal( Object.values( GENERIC_WORLD_EXPERIENCE.stages ).every( ( text ) => text.includes( 'ThruHold' ) ), true, 'generic stage labels do not impose game-specific copy' );
assert.equal( GENERIC_WORLD_EXPERIENCE.behaviors, undefined, 'the generic loading presentation does not select world behavior' );
const worldClock = { environment: { timeOfDay: { hour: 22.5 } } };
assert.equal( worldTimeOfDay( worldClock, 9 ), 22.5, 'world time stays authoritative without explicit engine override opt-in' );
assert.equal( worldTimeOfDay( { environment: { timeOfDay: { hour: 22.5, engineOverride: true } } }, 9 ), 9, 'worlds may opt in to the engine time override' );
assert.equal( worldTimeOfDay( worldClock, 9, 26 ), 2, 'the world runtime supplies its current time when available' );
assert.equal( worldTimeOfDay( GENERIC_WORLD_EXPERIENCE, 9 ), null, 'worlds without a clock do not inherit an engine time' );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, environment: { timeOfDay: { hour: 24, engineOverride: true } } } ), /time-of-day profile/ );
const javascriptAssetID = `sha256:${'a'.repeat( 64 )}`;
const behaviorData = { seed: 3 };
const javascriptExtension = { behaviorId: behaviorID, assetId: javascriptAssetID };
const withJavaScript = { ...GENERIC_WORLD_EXPERIENCE, behaviors: { [ behaviorID ]: behaviorData }, extensions: [ javascriptExtension ] };
assert.deepEqual( validateWorldExperience( withJavaScript ).behaviors[ behaviorID ], behaviorData, 'behavior-owned data is validated by its registry entry' );
assert.throws( () => validateWorldExperience( { ...withJavaScript, behaviors: { [ behaviorID ]: { seed: 'invalid' } } } ), /safe integer seed/ );
assert.doesNotThrow( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, stages: { 'world-assets': 'Loading world assets…' } } ), 'world owners can use bounded stage names for their content' );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, stages: { 'invalid stage': 'Loading…' } } ), /loading stage/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, behaviors: { 'elsemesh.unregistered/1': {} } } ), /does not support required world behavior/ );
assert.deepEqual( validateWorldExperience( withJavaScript ).extensions, [ javascriptExtension ], 'signed JavaScript modules bind to a declared registered behavior' );
assert.doesNotThrow( () => validateWorldExperience( withJavaScript, [ { id: javascriptAssetID, kind: 'javascript/1', bytes: 1, priority: 'visible' } ] ), 'signed javascript/1 asset matches the bounded module reference' );
for ( const asset of [ undefined, { id: javascriptAssetID, kind: 'glb', bytes: 1, priority: 'visible' }, { id: javascriptAssetID, kind: 'javascript/1', bytes: 1024 * 1024 + 1, priority: 'visible' }, { id: javascriptAssetID, kind: 'javascript/1', bytes: 1, priority: 'background' } ] ) assert.throws( () => validateWorldExperience( withJavaScript, asset ? [ asset ] : [] ), /invalid JavaScript asset reference/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, extensions: [ javascriptExtension ] } ), /Invalid world JavaScript extension reference/ );
assert.throws( () => validateWorldExperience( { ...withJavaScript, extensions: [ javascriptExtension, javascriptExtension ] } ), /Invalid world JavaScript extension reference/ );
const subscribedExtension = { ...javascriptExtension, events: [ 'elsemesh.world.activated/1' ] };
assert.deepEqual( validateWorldExperience( { ...withJavaScript, extensions: [ subscribedExtension ] } ).extensions, [ subscribedExtension ], 'signed extensions can opt into versioned generic browser events' );
for ( const events of [ null, [ 'invalid' ], [ 'elsemesh.world.activated/1', 'elsemesh.world.activated/1' ], Array( 17 ).fill( 'elsemesh.world.activated/1' ) ] ) assert.throws( () => validateWorldExperience( { ...withJavaScript, extensions: [ { ...javascriptExtension, events } ] } ), /Invalid world JavaScript extension reference/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, extra: 'not allowed' } ), /descriptor/ );
const markupText = '<script>alert(1)</script>';
assert.equal( validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, tips: [ markupText ] } ).tips[ 0 ], markupText, 'authored text remains data for the UI text renderer, never HTML' );
const themed = validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { logo: { src: '/world/logo.svg', alt: 'World logo' }, colors: { accent: '#c6a664', button: '#302d35' } } } );
assert.equal( themed.theme.logo.src, '/world/logo.svg', 'world-owned logo assets can be declared by path' );
const navigation = validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, navigation: { compass: { north: 'N', east: 'E', south: 'S', west: 'W' }, map: { layers: [ { src: '/world/minimap.png', alt: 'World minimap', bounds: { minX: -20, maxX: 20, minZ: -30, maxZ: 30 } } ] } } } );
assert.equal( navigation.navigation.compass.west, 'W', 'worlds own the compass cardinal labels' );
assert.equal( navigation.navigation.map.layers[ 0 ].bounds.maxZ, 30, 'world-authored minimap bounds are retained' );
const layeredNavigation = validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, navigation: { map: { layers: [ { heightRange: { minY: -10, maxY: 0 }, src: '/world/lower.png', alt: 'Lower floor', bounds: { minX: -20, maxX: 20, minZ: -30, maxZ: 30 } }, { heightRange: { minY: 2, maxY: 12 }, src: '/world/upper.png', alt: 'Upper floor', bounds: { minX: -20, maxX: 20, minZ: -30, maxZ: 30 } } ] } } } );
assert.equal( layeredNavigation.navigation.map.layers.length, 2, 'worlds can author separate maps for vertical floors with a gap' );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, navigation: { compass: { north: 'N', east: 'E', south: 'S' } } } ), /compass labels/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, navigation: { map: { layers: [ { src: 'javascript:alert(1)', alt: 'bad', bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } } ] } } } ), /minimap source/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, navigation: { map: { layers: [ { src: '/world/minimap.png', alt: 'bad', bounds: { minX: 1, maxX: 1, minZ: 0, maxZ: 1 } } ] } } } ), /minimap source/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, navigation: { map: { layers: [ { heightRange: { minY: 0, maxY: 5 }, src: '/world/a.png', alt: 'A', bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } }, { heightRange: { minY: 4, maxY: 8 }, src: '/world/b.png', alt: 'B', bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } } ] } } } ), /minimap source/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { colors: { accent: 'red' } } } ), /theme colors/ );
assert.throws( () => validateWorldExperience( { ...GENERIC_WORLD_EXPERIENCE, theme: { logo: { src: 'javascript:alert(1)', alt: 'bad' } } } ), /loading logo/ );

console.log( 'ok   world-owned loading copy and validated visual themes with a neutral remote fallback' );
