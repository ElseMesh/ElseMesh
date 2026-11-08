import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportsWorldManifest, loadWorldProvider } from '../worlds/tidewater/world-provider.js';

const viteConfig = await readFile( new URL( '../vite.config.js', import.meta.url ), 'utf8' );
assert.doesNotMatch( viteConfig, /worlds\/tidewater/, 'the engine build does not name a specific world provider' );
assert.match( viteConfig, /readdirSync\( worldsPath[\s\S]*?world-provider\.js/, 'the build discovers provider descriptors from mounted world repositories' );

assert.equal( supportsWorldManifest( { components: [ { type: 'elsemesh.water-body/1' } ] } ), false, 'generic worlds do not load Tidewater runtime modules' );
assert.equal( supportsWorldManifest( { components: [ { type: 'elsemesh.static-fish-props/1' } ] } ), false, 'the engine-owned fish-props feature does not load Tidewater runtime modules' );
assert.equal( supportsWorldManifest( { components: [ { type: 'elsemesh.terrain-surface/1' } ] } ), true, 'Tidewater component manifests select the Tidewater provider' );
assert.equal( supportsWorldManifest( { components: [], experience: { behaviors: { 'elsemesh.fishing-game/1': {} } } } ), true, 'Tidewater fishing behavior manifests select the Tidewater provider' );

await loadWorldProvider();
const { worldComponentDescriptor } = await import( '../src/network/WorldComponentRegistry.js' );
const { hasWorldBehavior } = await import( '../src/network/WorldBehaviorRegistry.js' );
const { verifySignedWorldManifest } = await import( '../src/network/WorldConnector.js' );
const source = JSON.parse( await readFile( new URL( '../worlds/tidewater/world-source.json', import.meta.url ), 'utf8' ) );
assert.equal( typeof worldComponentDescriptor( 'elsemesh.terrain-surface/1' )?.install, 'function', 'loading the provider registers its component installers' );
assert.equal( hasWorldBehavior( source.experience, 'elsemesh.fishing-game/1' ), true, 'loading the provider registers its world-authored fishing behavior and extension' );
let untrustedProviderCalls = 0;
await assert.rejects( verifySignedWorldManifest( {}, { loadWorldProviders: async () => { untrustedProviderCalls ++; } } ), /Invalid signed world document/ );
assert.equal( untrustedProviderCalls, 0, 'unverified manifests cannot trigger runtime provider imports' );
console.log( 'world provider selection loads Tidewater registrations only for matching manifests' );
