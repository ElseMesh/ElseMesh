import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerWorldComponentBackendAdapter, worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';

const webgpu = ( context, component ) => ( { backend: 'webgpu', context, component } );
const webgl = ( context, component ) => ( { backend: 'webgl', context, component } );
const type = 'elsemesh.backend-fixture/1';

registerWorldComponentBackendAdapter( 'webgpu', type, webgpu );
registerWorldComponentBackendAdapter( 'webgl', type, webgl );

const context = Object.freeze( {} ), component = Object.freeze( { id: 'fixture', type } );
assert.deepEqual( worldComponentBackendAdapter( 'webgpu', type )( context, component ), { backend: 'webgpu', context, component } );
assert.deepEqual( worldComponentBackendAdapter( 'webgl', type )( context, component ), { backend: 'webgl', context, component } );
assert.equal( worldComponentBackendAdapter( 'webgpu', 'elsemesh.unhandled/1' ), null, 'missing backend adapter is explicit' );
assert.throws( () => registerWorldComponentBackendAdapter( 'webgpu', type, webgpu ), /Duplicate/ );
assert.throws( () => registerWorldComponentBackendAdapter( 'canvas', 'elsemesh.invalid/1', webgpu ), /Invalid/ );

await import( '../src/App.js' );
await import( '../src/fallback/WebGLFallback.js' );
const appSource = await readFile( new URL( '../src/App.js', import.meta.url ), 'utf8' );
const fallbackSource = await readFile( new URL( '../src/fallback/WebGLFallback.js', import.meta.url ), 'utf8' );
const entrySource = await readFile( new URL( '../src/main.js', import.meta.url ), 'utf8' );
assert.doesNotMatch( appSource, /from ['"]\.\.\/worlds\/default\.js['"]/, 'the engine App receives the default world package from its entry point' );
assert.doesNotMatch( fallbackSource, /from ['"]\.\.\/\.\.\/worlds\/default\.js['"]/, 'the renderer fallback consumes the App-provided world package' );
assert.doesNotMatch( entrySource, /virtual:elsemesh-default-world/, 'the application entry point does not eagerly import the built-in world' );
assert.match( appSource, /if \( ! worldLink && ! this\.worldPackage \) this\.worldPackage = \( await import\( 'virtual:elsemesh-default-world' \) \)\.defaultWorldPackage/, 'App loads the built-in world only for a launch without a world link' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.water-body/1' ), 'function', 'App registers the WebGPU water-body adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.water-body/1' ), 'function', 'WebGLFallback registers the WebGL water-body adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.island-ocean/1' ), 'function', 'WebGLFallback registers the ocean adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.static-model-instance-set/1' ), 'function', 'ElseMesh registers a generic WebGPU static-model adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.static-model-instance-set/1' ), 'function', 'ElseMesh registers a generic WebGL static-model adapter' );
console.log( 'World component backend registry selects engine adapters by backend and component type' );
