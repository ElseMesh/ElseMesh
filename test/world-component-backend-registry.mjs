import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerWorldComponentBackendAdapter, registerWorldComponentBackendBatchAdapter, worldComponentBackendAdapter, worldComponentBackendBatchAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { worldComponentAssetIDs, worldComponentDescriptor } from '../src/network/WorldComponentRegistry.js';
import { BREAKER_STATIONS_ASSET_KIND, encodeBreakerStationsAsset } from '../src/network/BreakerStationsAsset.js';

const webgpu = ( context, component ) => ( { backend: 'webgpu', context, component } );
const webgl = ( context, component ) => ( { backend: 'webgl', context, component } );
const type = 'elsemesh.backend-fixture/1';
const batchType = 'elsemesh.backend-batch-fixture/1';

registerWorldComponentBackendAdapter( 'webgpu', type, webgpu );
registerWorldComponentBackendAdapter( 'webgl', type, webgl );
registerWorldComponentBackendBatchAdapter( 'webgl', batchType, ( context, components ) => ( { context, componentIDs: components.map( component => component.id ) } ) );

const context = Object.freeze( {} ), component = Object.freeze( { id: 'fixture', type } );
assert.deepEqual( worldComponentBackendAdapter( 'webgpu', type )( context, component ), { backend: 'webgpu', context, component } );
assert.deepEqual( worldComponentBackendAdapter( 'webgl', type )( context, component ), { backend: 'webgl', context, component } );
assert.deepEqual( worldComponentBackendBatchAdapter( 'webgl', batchType )( context, [ component ] ), { context, componentIDs: [ 'fixture' ] } );
assert.equal( worldComponentBackendBatchAdapter( 'webgpu', batchType ), null, 'batch adapters are selected by backend and component type' );
assert.equal( worldComponentBackendAdapter( 'webgpu', 'elsemesh.unhandled/1' ), null, 'missing backend adapter is explicit' );
assert.throws( () => registerWorldComponentBackendAdapter( 'webgpu', type, webgpu ), /Duplicate/ );
assert.throws( () => registerWorldComponentBackendAdapter( 'webgl', batchType, webgl ), /Duplicate/, 'batch and single adapters cannot claim the same backend/type pair' );
assert.throws( () => registerWorldComponentBackendBatchAdapter( 'webgl', type, () => true ), /Duplicate/, 'single and batch adapters cannot claim the same backend/type pair' );
assert.throws( () => registerWorldComponentBackendAdapter( 'canvas', 'elsemesh.invalid/1', webgpu ), /Invalid/ );

await import( '../src/App.js' );
await import( '../src/fallback/WebGLFallback.js' );
const appSource = await readFile( new URL( '../src/App.js', import.meta.url ), 'utf8' );
assert.match( appSource, /const worldOcean = components\.find\( component => component\.isWorldOcean \)/, 'App detects the generic world-ocean runtime capability' );
assert.match( appSource, /this\.activeHostedOcean = Boolean\( worldOcean \)/, 'App activates hosted ocean effects from the generic runtime capability' );
assert.doesNotMatch( appSource, /component\.islandOcean/, 'App does not depend on a Tidewater-specific ocean runtime flag' );
assert.doesNotMatch( appSource, /elsemesh\.island-ocean\/1/, 'App resolves the registered world-ocean capability without naming a component version' );
const fallbackSource = await readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' );
const playerSource = await readFile( new URL( '../src/player/Player.js', import.meta.url ), 'utf8' );
const soundScapeSource = await readFile( new URL( '../src/audio/SoundScape.js', import.meta.url ), 'utf8' );
const entrySource = await readFile( new URL( '../src/main.js', import.meta.url ), 'utf8' );
const connectorSource = await readFile( new URL( '../src/network/WorldConnector.js', import.meta.url ), 'utf8' );
assert.doesNotMatch( appSource, /from ['"]\.\.\/worlds\/default\.js['"]/, 'the engine App receives the default world package from its entry point' );
assert.doesNotMatch( appSource, /from ['"]\.\/world\/WorldLayout\.js['"]/, 'App has no direct static import of built-in world layout' );
assert.doesNotMatch( appSource, /from ['"]\.\/world\/Vegetation\.js['"]/, 'App does not import a Tidewater vegetation renderer from engine source' );
assert.match( appSource, /this\.worldPackage\?\.presentation\?\.createVegetation/, 'built-in vegetation is provided by the active world package' );
assert.match( appSource, /if \( ! worldLink \) \{\s+this\.worldLayout = this\.worldPackage\.presentation\?\.layout \|\| null/, 'App takes the built-in layout from the injected default world package' );
assert.doesNotMatch( playerSource, /from ['"]\.\.\/world\/WorldLayout\.js['"]/, 'the generic player receives world layout data from its caller' );
assert.doesNotMatch( playerSource, /from ['"]\.\.\/world\/boat\/BoatSpecs\.js['"]/, 'vehicle control geometry comes from the supplied design rather than Tidewater specifications' );
assert.doesNotMatch( soundScapeSource, /from ['"]\.\.\/world\/WorldLayout\.js['"]/, 'the audio engine receives optional world acoustic layout from its caller' );
assert.match( appSource, /new Player\( \{[^\n]*worldLayout: this\.worldLayout/, 'the built-in WebGPU player receives its world layout from App' );
assert.match( fallbackSource, /new Player\( \{[^\n]*worldLayout \}/, 'the built-in WebGL player receives the App-provided world layout' );
assert.match( soundScapeSource, /constructor\( \{[^\n]*worldLayout = null/, 'world acoustic layout is an optional SoundScape input' );
assert.doesNotMatch( fallbackSource, /from ['"]\.\.\/\.\.\/worlds\/default\.js['"]/, 'the renderer fallback consumes the App-provided world package' );
assert.doesNotMatch( fallbackSource, /from ['"]\.\.\/world\/IslandDefinition\.js['"]/, 'hosted WebGL does not eagerly import the built-in island definition' );
assert.match( fallbackSource, /async _loadIsland\( progress \)[\s\S]*?const WORLD = this\.worldLayout/, 'WebGL built-in presentation consumes the injected package layout' );
assert.doesNotMatch( entrySource, /from ['"]virtual:elsemesh-default-world['"]/, 'the application entry point does not eagerly import the built-in world' );
assert.match( entrySource, /loadDefaultWorldPackage: async \(\) => \( await import\( 'virtual:elsemesh-default-world' \) \)\.defaultWorldPackage/, 'the entry point provides a lazy default-world loader' );
assert.match( entrySource, /loadWorldProviders: async \( manifest \) => \( await import\( 'virtual:elsemesh-world-providers' \) \)\.loadWorldProviders\( manifest \)/, 'the entry point provides manifest-selected world runtime providers' );
assert.match( appSource, /if \( ! worldLink && ! this\.worldPackage \) \{[\s\S]*?this\.worldPackage = await this\.loadDefaultWorldPackage\(\)/, 'App requests the built-in world only for a launch without a world link' );
assert.match( appSource, /if \( ! worldLink \) await loadWorldPackageProviders\( this\.worldPackage, this\.loadWorldProviders \)/, 'built-in package providers use the shared provider loader' );
assert.match( appSource, /new WorldConnector\( \{ \.\.\.worldLink, loadWorldProviders: this\.loadWorldProviders \} \)/, 'App passes the generic provider loader into world verification' );
assert.match( connectorSource, /await verifySignedWorldManifest\( reply\.document, \{ loadWorldProviders: this\.loadWorldProviders \} \)/, 'WorldConnector loads matching providers during manifest verification' );
assert.doesNotMatch( appSource, /IslandWorldState|world\/TerrainData\.js/, 'App does not depend on a world-specific terrain implementation' );
assert.match( appSource, /if \( engine\.backend !== 'webgl' \|\| ! worldLink \) await this\.initializeWorldState\(\)/, 'built-in runtime state is not created for hosted WebGL startup' );
assert.match( appSource, /async initializeWorldState\(\)[\s\S]*?presentation\?\.createWorldState/, 'built-in world state is created through the package presentation boundary' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.water-body/1' ), 'function', 'App registers the WebGPU water-body adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.island-ocean/1' ), 'function', 'ElseMesh owns the WebGPU island-ocean presenter' );
const oceanSurface = {}, oceanRoot = { children: [], add( child ) { this.children.push( child ); }, remove( child ) { this.children.splice( this.children.indexOf( child ), 1 ); } };
const oceanInstallation = await worldComponentBackendAdapter( 'webgpu', 'elsemesh.island-ocean/1' )( {
	app: { qs: { get: () => null }, waterMaterial: {}, surface: oceanSurface }, root: oceanRoot,
}, { id: 'elsemesh-component:ocean', type: 'elsemesh.island-ocean/1' } );
assert.equal( oceanInstallation?.installed, true, 'the engine WebGPU island-ocean presenter installs the water mesh' );
assert.equal( oceanInstallation.runtime.isWorldOcean, true, 'the adapter exposes the world-ocean runtime capability' );
assert.equal( oceanInstallation.runtime.surface, oceanSurface, 'the runtime exposes its surface to shared engine effects' );
assert.equal( oceanRoot.children.length, 1, 'the adapter adds one water mesh to the world root' );
assert.equal( oceanRoot.children[ 0 ].receiveShadow, true, 'the water mesh retains its receive-shadow setting' );
oceanInstallation.runtime.dispose();
assert.equal( oceanRoot.children.length, 0, 'the engine adapter removes the water mesh on disposal' );
const stationBytes = encodeBreakerStationsAsset( { data: new Float32Array( [ 1, 2, 0, 1, 2, 2, 0, 1 ] ), count: 2, spacing: 1 } );
const builtinMesh = { layers: { set() {} } }, builtinLOD = { geometry: {}, update() {} }, builtinRoot = { added: 0, add() { this.added ++; } };
const builtinInstallation = await worldComponentBackendAdapter( 'webgpu', 'elsemesh.island-ocean/1' )( {
	app: { qs: { get: () => null }, waterMaterial: {}, surface: oceanSurface, ocean: builtinMesh, oceanLOD: builtinLOD },
	root: builtinRoot, builtin: true,
	connector: { assets: new Map( [ [ 'sha256:stations', stationBytes ] ] ) },
}, { id: 'elsemesh-component:ocean', type: 'elsemesh.island-ocean/1', assets: [ { assetId: 'sha256:stations', kind: BREAKER_STATIONS_ASSET_KIND } ] } );
assert.equal( builtinInstallation.runtime.breakerStations.count, 2, 'the built-in route gets shared station data from the engine adapter' );
assert.equal( builtinRoot.added, 0, 'the built-in adapter reuses App’s existing water mesh instead of duplicating presentation' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.terrain-surface/1' ), 'function', 'ElseMesh registers the WebGPU terrain-surface adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.water-body/1' ), 'function', 'WebGLFallback registers the WebGL water-body adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.island-ocean/1' ), 'function', 'WebGLFallback registers the ocean adapter' );
assert.doesNotMatch( fallbackSource, /component\.type === 'elsemesh\.island-ocean\/1'/, 'the WebGL fallback selects the ocean through its registered adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.static-model-instance-set/1' ), 'function', 'ElseMesh registers a generic WebGPU static-model adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.static-model-instance-set/1' ), 'function', 'ElseMesh registers a generic WebGL static-model adapter' );
const groundCoverType = 'elsemesh.ground-cover-field/1';
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', groundCoverType ), 'function', 'ElseMesh registers a generic WebGPU ground-cover presenter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', groundCoverType ), 'function', 'ElseMesh registers a generic WebGL ground-cover presenter' );
assert.equal( worldComponentDescriptor( groundCoverType )?.vegetation, true, 'ground-cover fields participate in renderer-neutral vegetation visibility policy' );
assert.deepEqual( worldComponentAssetIDs( { type: groundCoverType, assets: [ { assetId: 'density', kind: 'grass-density/1' }, { assetId: 'near', kind: 'glb' }, { assetId: 'far', kind: 'glb' } ] } ), [ 'density' ], 'ground-cover density loads with the component while model GLBs remain lazy' );
const tidewaterFishProps = 'elsemesh.static-fish-props/1';
assert.ok( worldComponentDescriptor( tidewaterFishProps ), 'ElseMesh registers the generic fish-props component contract' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', tidewaterFishProps ), 'function', 'ElseMesh owns the WebGPU fish-props presenter' );
assert.equal( typeof worldComponentBackendBatchAdapter( 'webgl', tidewaterFishProps ), 'function', 'ElseMesh owns the WebGL fish-props presenter' );
await import( '../worlds/tidewater/register-components.js' );
assert.equal( worldComponentDescriptor( 'elsemesh.island-ocean/1' )?.install, null, 'the engine ocean capability does not install a world-owned renderer presenter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.island-ocean/1' ), 'function', 'loading Tidewater does not replace the engine WebGPU ocean presenter' );
assert.ok( worldComponentDescriptor( tidewaterFishProps ), 'Tidewater uses the engine component contract without registering a presenter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', tidewaterFishProps ), 'function', 'loading Tidewater does not replace the engine WebGPU presenter' );
assert.equal( typeof worldComponentBackendBatchAdapter( 'webgl', tidewaterFishProps ), 'function', 'loading Tidewater does not replace the engine WebGL presenter' );
console.log( 'World component backend registry selects engine adapters by backend and component type' );
