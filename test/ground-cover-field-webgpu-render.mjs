import assert from 'node:assert/strict';
import { setupLife } from './life-harness.mjs';
import { groundCoverFieldRenderFixture } from './helpers/ground-cover-field-render-fixture.mjs';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { Group } from '../src/engine/scene/Group.js';
import { Mesh } from '../src/engine/scene/Mesh.js';
import { PlaneGeometry } from '../src/engine/geometry/PrimitiveGeometries.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { Texture } from '../src/engine/gpu/Texture.js';
import { standard } from '../src/materials/Materials.js';
import { readTexture } from '../src/engine/gpu/Readback.js';

await import( '../src/network/WebGPUWorldComponentAdapters.js' );

const { component, connector, terrain, terrainDetail } = await groundCoverFieldRenderFixture();
const L = await setupLife( { W: 192, H: 144, shadowSplits: [ 12 ] } );
let runtime, terrainDetailTexture;
try {
	const ground = new Mesh( new PlaneGeometry( 32, 32 ).rotateX( - Math.PI / 2 ), standard( { name: 'ground-cover-render-ground', color: 0xc3b895, roughness: 1 } ) );
	ground.position.y = - 0.02;
	ground.receiveShadow = true;
	L.scene.add( ground );
	const root = new Group();
	root.userData.terrainData = terrain;
	terrainDetailTexture = new Texture( { label: 'fixture-signed-terrain-detail', width: terrainDetail.width, height: terrainDetail.height, format: 'rgba8unorm', data: terrainDetail.data, sampler: 'aniso4Repeat' } );
	root.userData.worldComponents = [ { terrainSurface: true, terrainGPU: { detailTexture: terrainDetailTexture } } ];
	root.userData.worldPackage = { parsed: new Map(), loadedObjects: new Set(), connector, progressiveController: new AbortController() };
	const install = worldComponentBackendAdapter( 'webgpu', component.type );
	const installed = await install( { app: {}, root, connector }, component );
	assert.equal( installed.installed, true, 'the signed ground-cover component installs through the WebGPU registry' );
	runtime = installed.runtime;
	L.scene.add( root );
	L.camera.position.set( 0, 3, 8 );
	L.camera.lookAt( 0, 0.5, 0 );
	const deadline = Date.now() + 5000;
	while ( ! runtime.isCoarseReadyForView() && Date.now() < deadline ) {
		await L.run( 1, dt => runtime.update( dt, L.camera ) );
		await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	assert.equal( runtime.isCoarseReadyForView(), true, 'the signed model reaches coarse view coverage' );
	await L.run( 2, dt => runtime.update( dt, L.camera ) );
	const meshes = [];
	root.traverse( object => { if ( object.isMesh ) meshes.push( object ); } );
	const visible = meshes.filter( mesh => ! mesh.userData.shadowOnly );
	const shadows = meshes.filter( mesh => mesh.userData.shadowOnly );
	assert.ok( visible.length > 0 && visible.every( mesh => ! mesh.castShadow && mesh.receiveShadow ), 'WebGPU visible draws receive shadows without duplicating shadow casters' );
	assert.ok( shadows.length > 0 && shadows.every( mesh => mesh.castShadow && ! mesh.material.colorWrite && mesh.count > 0 ), 'WebGPU shadow-only draws contain the same visible instances and enter the depth pass' );
	const visibleInstances = visible.reduce( ( n, mesh ) => n + mesh.count, 0 ), shadowInstances = shadows.reduce( ( n, mesh ) => n + mesh.count, 0 );
	assert.ok( visibleInstances > 0 && shadowInstances > 0, `the signed fixed-cell fixture selects visible and near-shadow patch instances (${ visibleInstances } visible; ${ shadowInstances } shadows)` );
	const errors = [];
	GPU.device.addEventListener( 'uncapturederror', event => errors.push( event.error?.message || 'unknown GPU error' ) );
	await L.run( 2, dt => runtime.update( dt, L.camera ) );
	const lit = new Uint8Array( ( await readTexture( L.ldr.texture ) ).data );
	L.shadows.enabled = false;
	await L.run( 2, dt => runtime.update( dt, L.camera ) );
	const unshadowed = new Uint8Array( ( await readTexture( L.ldr.texture ) ).data );
	let shadowChangedPixels = 0;
	for ( let offset = 0; offset < lit.length; offset += 4 ) if ( Math.abs( lit[ offset ] - unshadowed[ offset ] ) + Math.abs( lit[ offset + 1 ] - unshadowed[ offset + 1 ] ) + Math.abs( lit[ offset + 2 ] - unshadowed[ offset + 2 ] ) > 12 ) shadowChangedPixels ++;
	assert.deepEqual( errors, [], `WebGPU ground-cover color and shadow pipelines compile cleanly: ${ errors.join( '; ' ) }` );
	assert.ok( shadowChangedPixels > 0, `WebGPU ground-cover shadows change receiving pixels (${ shadowChangedPixels })` );
	console.log( `ground-cover WebGPU fixed-cell fixture rendered (${ visibleInstances } visible; ${ shadowInstances } shadow instances; ${ shadowChangedPixels } receiver pixels changed when shadows were disabled)` );
} finally {
	runtime?.dispose();
	terrainDetailTexture?.destroy();
	GPU.device?.destroy();
}
await new Promise( resolve => setTimeout( resolve, 200 ) );
