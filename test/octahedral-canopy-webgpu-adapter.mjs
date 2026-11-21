import assert from 'node:assert/strict';
import { GPU } from '../src/engine/gpu/GPU.js';
import { Texture } from '../src/engine/gpu/Texture.js';
import { setupLife } from './life-harness.mjs';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { OCTAHEDRAL_CANOPY_COMPONENT_TYPE } from '../src/network/OctahedralCanopyDescriptor.js';
import { createWorldPackageRoot, disposeWorldPackage } from '../src/network/WorldPackage.js';
import { signedCanopyFixture } from './octahedral-canopy-adapters.mjs';
import { loadCanopyProductionPackage } from './octahedral-canopy-production-package.mjs';

await import( '../src/network/WebGPUWorldComponentAdapters.js' );
const adapter = worldComponentBackendAdapter( 'webgpu', OCTAHEDRAL_CANOPY_COMPONENT_TYPE );
assert.equal( typeof adapter, 'function' );
const candidate = process.env.ELSEMESH_CANOPY_EXPORT
	? await loadCanopyProductionPackage( process.env.ELSEMESH_CANOPY_EXPORT )
	: signedCanopyFixture;
const errors = [];
const L = await setupLife( { W: 128, H: 128, shadowSplits: [ 12 ] } );
const root = createWorldPackageRoot( candidate.connector );
L.scene.add( root );
let result, nearResult, detailTexture;
try {
	GPU.device.addEventListener( 'uncapturederror', event => errors.push( event.error?.message || 'unknown GPU error' ) );
	result = await adapter( { root, connector: candidate.connector }, candidate.component );
	assert.equal( result.installed, true );
	const mesh = root.children.find( object => object.isInstancedMesh );
	assert.ok( mesh, 'the WebGPU adapter installs an instanced canopy batch under the world root' );
	assert.equal( mesh.receiveShadow, true );
	assert.equal( mesh.castShadow, false );
	assert.equal( root.userData.worldPackage.textureAssets.size, 2, 'uploaded data atlases are owned by the world package' );
	L.camera.position.set( ...( candidate.cameraPosition || [ 50, 0, 0 ] ) );
	L.camera.lookAt( ...( candidate.target || [ 0, 2, 0 ] ) );
	result.runtime.update( 1 / 60, L.camera );
	assert.ok( mesh.count > 0, 'the shared plan selects signed far cards for this camera' );
	if ( candidate.packageDocument ) {
		const nearAdapter = worldComponentBackendAdapter( 'webgpu', 'elsemesh.static-model-instance-set/1' );
		assert.equal( typeof nearAdapter, 'function', 'WebGPU registers the generic near-model adapter' );
		detailTexture = new Texture( { label: 'tidewater-canopy-near-detail', width: 1, height: 1, format: 'rgba8unorm', data: Uint8Array.from( [ 96, 128, 144, 255 ] ), sampler: 'linearRepeat' } );
		nearResult = await nearAdapter( { root, connector: candidate.connector, installed: [ { terrainSurface: true, terrainGPU: { detailTexture } } ] }, candidate.packageDocument.nearComponent );
		const nearPosition = candidate.target.map( ( value, index ) => value + [ 0, 5, 8 ][ index ] );
		L.camera.position.set( ...nearPosition );
		L.camera.lookAt( ...candidate.target );
		nearResult.runtime.update( 1 / 60, L.camera );
		const readyDeadline = Date.now() + 20000;
		while ( ! nearResult.runtime.isCoarseReadyForView() && Date.now() < readyDeadline ) await new Promise( resolve => setTimeout( resolve, 10 ) );
		assert.equal( nearResult.runtime.isCoarseReadyForView(), true, 'the visible Tidewater near-model GLB finishes loading through the generic adapter' );
		nearResult.runtime.update( 1 / 60, L.camera );
		const nearMesh = root.children.find( object => object.isInstancedMesh && ! object.userData.shadowOnly && object.count > 0 );
		assert.ok( nearMesh, 'the generic adapter draws authored Tidewater near canopy instances' );
		const nearVertexBuffers = L.mr._layout( nearMesh, nearMesh.geometry, nearMesh.material ).buffers.length;
		assert.ok( nearVertexBuffers <= GPU.device.limits.maxVertexBuffers, `Tidewater near canopy uses ${nearVertexBuffers} WebGPU vertex buffers within the device limit of ${GPU.device.limits.maxVertexBuffers}` );
		await L.run( 2 );
		assert.deepEqual( errors, [], `Tidewater near canopy graph renders without WebGPU validation errors: ${errors.join( '; ' )}` );
		L.camera.position.set( ...candidate.cameraPosition );
		L.camera.lookAt( ...candidate.target );
		nearResult.runtime.update( 1 / 60, L.camera );
		result.runtime.update( 1 / 60, L.camera );
		assert.ok( mesh.count > 0, 'the Tidewater far presenter draws source atlases after near-model installation' );
	}
	await L.run( 2 );
	assert.deepEqual( errors, [], `WebGPU canopy adapter renders without validation errors: ${errors.join( '; ' )}` );
	nearResult?.runtime?.dispose();
	result.runtime.dispose();
	assert.equal( root.children.includes( mesh ), false, 'disposing the component removes its draw batch' );
	assert.equal( root.userData.worldPackage.textureAssets.size, 0, 'disposing the component releases its world-package texture entries' );
	await L.run( 1 );
	console.log( `WebGPU canopy adapters render ${mesh.count} planned far cards and dispose their resources cleanly` );
} finally {
	nearResult?.runtime?.dispose();
	result?.runtime?.dispose();
	detailTexture?.destroy();
	root.parent?.remove( root );
	disposeWorldPackage( root );
	GPU.device?.destroy();
}
