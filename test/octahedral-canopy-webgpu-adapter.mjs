import assert from 'node:assert/strict';
import { Group } from '../src/engine/scene/Group.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { setupLife } from './life-harness.mjs';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { OCTAHEDRAL_CANOPY_COMPONENT_TYPE } from '../src/network/OctahedralCanopyDescriptor.js';
import { signedCanopyFixture } from './octahedral-canopy-adapters.mjs';

const adapter = worldComponentBackendAdapter( 'webgpu', OCTAHEDRAL_CANOPY_COMPONENT_TYPE );
assert.equal( typeof adapter, 'function' );
const errors = [];
const L = await setupLife( { W: 128, H: 128, shadowSplits: [ 12 ] } );
const root = new Group();
root.userData.worldPackage = { textureAssets: new Map(), progressiveController: new AbortController() };
L.scene.add( root );
let result;
try {
	GPU.device.addEventListener( 'uncapturederror', event => errors.push( event.error?.message || 'unknown GPU error' ) );
	result = await adapter( { root, connector: signedCanopyFixture.connector }, signedCanopyFixture.component );
	assert.equal( result.installed, true );
	const mesh = root.children.find( object => object.isInstancedMesh );
	assert.ok( mesh, 'the WebGPU adapter installs an instanced canopy batch under the world root' );
	assert.equal( mesh.receiveShadow, true );
	assert.equal( mesh.castShadow, false );
	assert.equal( root.userData.worldPackage.textureAssets.size, 2, 'uploaded data atlases are owned by the world package' );
	L.camera.position.set( 50, 0, 0 );
	L.camera.lookAt( 0, 2, 0 );
	result.runtime.update( 1 / 60, L.camera );
	assert.equal( mesh.count, 1, 'the shared plan selects the signed far card for this camera' );
	await L.run( 2 );
	assert.deepEqual( errors, [], `WebGPU canopy adapter renders without validation errors: ${errors.join( '; ' )}` );
	result.runtime.dispose();
	assert.equal( root.children.includes( mesh ), false, 'disposing the component removes its draw batch' );
	assert.equal( root.userData.worldPackage.textureAssets.size, 0, 'disposing the component releases its world-package texture entries' );
	await L.run( 1 );
	console.log( 'WebGPU canopy adapter loads signed assets, renders a planned far-card batch, and disposes it cleanly' );
} finally {
	result?.runtime?.dispose();
	root.parent?.remove( root );
	GPU.device?.destroy();
}
