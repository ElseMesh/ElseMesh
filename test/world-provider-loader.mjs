import assert from 'node:assert/strict';
import { loadWorldManifestProviders, loadWorldPackageProviders } from '../src/network/WorldProviderLoader.js';

const calls = [];
const loader = async descriptor => calls.push( descriptor );
const components = [ { id: 'fixture', type: 'elsemesh.fixture/1' } ];
const experience = { behaviors: { 'elsemesh.fixture-behavior/1': {} } };
const packageSource = { worldId: 'elsemesh:fixture', components, experience, rules: { maxPackageBytes: 4096 } };
const worldPackage = { source: packageSource, assets: new Map() };
const manifest = { protocol: 'elsemesh.world/3', worldId: 'elsemesh:fixture', components, experience, rules: { maxPackageBytes: 4096 } };

await loadWorldPackageProviders( worldPackage, loader );
await loadWorldManifestProviders( manifest, loader );
await loadWorldPackageProviders( { assets: new Map() }, loader );
await loadWorldManifestProviders( null, loader );
await loadWorldPackageProviders( worldPackage, null );

assert.deepEqual( calls, [ packageSource, manifest ], 'providers receive the full world-owned declaration without field loss' );
console.log( 'World provider loading preserves package and manifest declarations' );
