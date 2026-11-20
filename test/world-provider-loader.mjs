import assert from 'node:assert/strict';
import { loadMatchingWorldProviders, loadWorldManifestProviders, loadWorldPackageProviders } from '../src/network/WorldProviderLoader.js';

const calls = [];
const loader = async descriptor => calls.push( descriptor );
const components = [ { id: 'fixture', type: 'elsemesh.fixture/1' } ];
const experience = { behaviors: { 'elsemesh.fixture-behavior/1': {} } };
const packageSource = { worldId: 'elsemesh:fixture', components, experience, rules: { maxPackageBytes: 4096 } };
const worldPackage = { source: packageSource, assets: new Map() };
const manifest = { protocol: 'elsemesh.world/1', worldId: 'elsemesh:fixture', components, experience, rules: { maxPackageBytes: 4096 } };

await loadWorldPackageProviders( worldPackage, loader );
await loadWorldManifestProviders( manifest, loader );
await loadWorldPackageProviders( { assets: new Map() }, loader );
await loadWorldManifestProviders( null, loader );
await loadWorldPackageProviders( worldPackage, null );

assert.deepEqual( calls, [ packageSource, manifest ], 'providers receive the full world-owned declaration without field loss' );

const selected = [];
const providerIndexes = [
	{ componentTypes: [ 'elsemesh.fixture/1' ], behaviorIds: [], load: async () => ( { loadWorldProvider: async () => selected.push( 'fixture' ) } ) },
	{ componentTypes: [ 'elsemesh.other/1' ], behaviorIds: [ 'elsemesh.other-behavior/1' ], load: async () => ( { loadWorldProvider: async () => selected.push( 'other' ) } ) },
];
await loadMatchingWorldProviders( { components: [ { type: 'elsemesh.fixture/1' } ] }, providerIndexes );
assert.deepEqual( selected, [ 'fixture' ], 'only provider code matching the invited world manifest is imported' );
await loadMatchingWorldProviders( { components: [], experience: { behaviors: { 'elsemesh.other-behavior/1': {} } } }, providerIndexes );
assert.deepEqual( selected, [ 'fixture', 'other' ], 'behavior-only manifests load their matching provider' );
console.log( 'World provider loading preserves package and manifest declarations' );
