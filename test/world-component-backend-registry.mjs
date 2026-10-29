import assert from 'node:assert/strict';
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
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.water-body/1' ), 'function', 'App registers the WebGPU water-body adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.water-body/1' ), 'function', 'WebGLFallback registers the WebGL water-body adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.island-ocean/1' ), 'function', 'WebGLFallback registers the ocean adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.static-fish-props/1' ), 'function', 'App registers the WebGPU fish-props adapter' );
assert.equal( typeof worldComponentBackendAdapter( 'webgl', 'elsemesh.static-fish-props/1' ), 'function', 'WebGLFallback registers the WebGL fish-props adapter' );

console.log( 'World component backend registry selects engine adapters by backend and component type' );
