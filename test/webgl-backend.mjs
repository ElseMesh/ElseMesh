import assert from 'node:assert/strict';
import { selectBackend } from '../src/engine/Backend.js';
import { loadThreeModule } from '../src/engine/Engine.js';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';

const three = await loadThreeModule();
assert.equal( typeof three.WebGLRenderer, 'function', 'the dynamically loaded Three.js namespace exposes the named renderer export' );

{
	let webgpuStarted = false;
	let webglStarted = false;
	const selected = await selectBackend( {
		forceWebGL: true,
		initWebGPU: async () => { webgpuStarted = true; },
		initWebGL: async () => { webglStarted = true; },
	} );
	assert.equal( webgpuStarted, false );
	assert.equal( webglStarted, true );
	assert.equal( selected.backend, 'webgl' );
}

{
	const selected = await selectBackend( { initWebGPU: async () => {}, initWebGL: async () => assert.fail( 'WebGL must not initialize when WebGPU succeeds' ) } );
	assert.deepEqual( selected, { backend: 'webgpu', fallbackReason: null } );
}

for ( const error of [ new Error( 'WebGPU unavailable' ), new Error( 'No adapter' ), new Error( 'Device creation failed' ) ] ) {
	let fallbackStarted = false;
	const selected = await selectBackend( {
		initWebGPU: async () => { throw error; },
		initWebGL: async () => { fallbackStarted = true; },
	} );
	assert.equal( fallbackStarted, true );
	assert.equal( selected.backend, 'webgl' );
	assert.equal( selected.fallbackReason, error.message );
}

await assert.rejects( selectBackend( {
	initWebGPU: async () => { throw new Error( 'WebGPU failed' ); },
	initWebGL: async () => { throw new Error( 'WebGL unavailable' ); },
} ), AggregateError );

// Exercise hosted initialization through lighting setup without needing a GPU.
// A world may omit its environment or explicitly request a skyless scene.
const previousLocation = globalThis.location;
try {
	globalThis.location = { search: '' };
	for ( const environment of [ undefined, { sky: 'none', clouds: 'none' } ] ) {
		const fallback = Object.create( WebGLFallback.prototype );
		const reachedWorldLoading = new Error( 'lighting initialized' );
		fallback.THREE = three;
		fallback.app = { qs: new URLSearchParams(), settings: { timeOfDay: 12, exposure: 1 }, worldManifestPromise: Promise.resolve( { manifest: { experience: { environment } } } ) };
		fallback.worldLink = {};
		fallback.renderer = { shadowMap: {} };
		fallback.scene = new three.Scene();
		fallback.ktx2Loader = {};
		fallback.loader = { setKTX2Loader() {} };
		fallback._sunDirection = () => new three.Vector3( 0, 1, 0 );
		fallback._makeCloudLayer = () => new three.Object3D();
		fallback._updateLighting = () => {};
		fallback._makeHUD = () => { throw reachedWorldLoading; };
		await assert.rejects( fallback.init(), error => error === reachedWorldLoading, 'skyless hosted worlds get past WebGL lighting initialization' );
		assert.equal( fallback.webglEnvironment, null );
		assert.equal( fallback.scene.environment, null );
		assert.equal( fallback.cloudLayer.visible, false );
		fallback.spray.geometry.dispose();
		fallback.spray.material.dispose();
	}
} finally {
	if ( previousLocation === undefined ) delete globalThis.location;
	else globalThis.location = previousLocation;
}

console.log( 'webgl backend selection passed' );
