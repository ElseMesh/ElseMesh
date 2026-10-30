import assert from 'node:assert/strict';
import { supportsWorldManifest, loadWorldProvider } from '../worlds/tidewater/world-provider.js';

assert.equal( supportsWorldManifest( { components: [ { type: 'elsemesh.water-body/1' } ] } ), false, 'generic worlds do not load Tidewater runtime modules' );
assert.equal( supportsWorldManifest( { components: [ { type: 'elsemesh.terrain-surface/1' } ] } ), true, 'Tidewater component manifests select the Tidewater provider' );
assert.equal( supportsWorldManifest( { components: [], experience: { behaviors: { 'elsemesh.shore-aware-boat/1': {} } } } ), true, 'Tidewater behavior manifests select the Tidewater provider' );

await loadWorldProvider();
const { worldComponentDescriptor } = await import( '../src/network/WorldComponentRegistry.js' );
const { hasWorldBehavior } = await import( '../src/network/WorldBehaviorRegistry.js' );
const { verifySignedWorldManifest } = await import( '../src/network/WorldConnector.js' );
assert.equal( typeof worldComponentDescriptor( 'elsemesh.terrain-surface/1' )?.install, 'function', 'loading the provider registers its component installers' );
assert.equal( hasWorldBehavior( { behaviors: { 'elsemesh.shore-aware-boat/1': {} } }, 'elsemesh.shore-aware-boat/1' ), true, 'loading the provider registers its world behavior' );
let untrustedProviderCalls = 0;
await assert.rejects( verifySignedWorldManifest( {}, { loadWorldProviders: async () => { untrustedProviderCalls ++; } } ), /Invalid signed world document/ );
assert.equal( untrustedProviderCalls, 0, 'unverified manifests cannot trigger runtime provider imports' );
console.log( 'world provider selection loads Tidewater registrations only for matching manifests' );
