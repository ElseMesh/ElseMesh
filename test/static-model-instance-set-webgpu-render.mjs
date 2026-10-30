import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setupLife } from './life-harness.mjs';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { Group } from '../src/engine/scene/Group.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { disposeWorldPackage } from '../src/network/WorldPackage.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT } from '../src/network/StaticModelInstanceSet.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';

await import( '../src/network/WebGPUWorldComponentAdapters.js' );

const hash = bytes => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const glbBytes = staticModelGLB(), modelAssetID = hash( glbBytes );
const document = {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ { id: 'render-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, lods: [ { assetId: modelAssetID } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 20, drawMaxDistance: 90, drawFadeStartDistance: 90 } ],
	instances: [ { model: 'render-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
};
const setBytes = new TextEncoder().encode( JSON.stringify( document ) ), setAssetID = hash( setBytes );
const component = { id: 'render-static-models', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: modelAssetID, kind: 'glb' } ] };
const connector = {
	manifest: { assets: [ { id: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { id: modelAssetID, kind: 'glb' } ] },
	assets: new Map( [ [ setAssetID, setBytes ] ] ),
	getAsset: async () => glbBytes,
};
const errors = [];
const L = await setupLife( { W: 192, H: 144, shadowSplits: [ 12 ] } );
let runtime;
try {
	GPU.device.addEventListener( 'uncapturederror', event => errors.push( event.error?.message || 'unknown GPU error' ) );
	const root = new Group();
	root.userData.worldPackage = { parsed: new Map(), loadedObjects: new Set(), connector, materialAdapterContexts: new Map() };
	const install = worldComponentBackendAdapter( 'webgpu', component.type );
	const result = await install( { root, connector }, component );
	runtime = result.runtime;
	L.scene.add( root );
	L.camera.position.set( 2, 1, 4 );
	L.camera.lookAt( 2, 0.5, - 5 );
	await L.run( 3, dt => runtime.update( dt, L.camera ) );
	assert.equal( runtime.planner.groups[ 0 ].count, 1, 'the shared planner retains the fixture in view' );
	const rendered = await readTexture( L.ldr.texture );
	const data = new Uint8Array( rendered.data );
	const background = data.slice( 0, 3 );
	let changedPixels = 0;
	for ( let offset = 0; offset < data.length; offset += 4 ) {
		if ( Math.abs( data[ offset ] - background[ 0 ] ) + Math.abs( data[ offset + 1 ] - background[ 1 ] ) + Math.abs( data[ offset + 2 ] - background[ 2 ] ) > 24 ) changedPixels ++;
	}
	if ( changedPixels === 0 ) await L.save( '/var/tmp/static-model-instance-webgpu.png' );
	assert.deepEqual( errors, [], `static model color/shadow pipelines have no WebGPU errors: ${errors.join( '; ' )}` );
	assert.ok( changedPixels > 30, `generic WebGPU static model renders visible pixels (found ${changedPixels})` );
	console.log( `generic WebGPU static-model render passed (${changedPixels} non-background pixels; color and shadow pipelines compiled)` );
} finally {
	runtime?.dispose();
	GPU.device?.destroy();
}
await new Promise( resolve => setTimeout( resolve, 200 ) );
