import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setupLife } from './life-harness.mjs';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { Group } from '../src/engine/scene/Group.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import { registerWorldPackageMaterialAdapter } from '../src/network/WorldPackageMaterialAdapterRegistry.js';
import { registerWorldMaterialProfile } from '../src/network/WorldMaterialProfileRegistry.js';
import { disposeWorldPackage } from '../src/network/WorldPackage.js';
import { STATIC_MODEL_INSTANCE_SET_ASSET_KIND, STATIC_MODEL_INSTANCE_SET_FORMAT } from '../src/network/StaticModelInstanceSet.js';
import { GPU } from '../src/engine/gpu/GPU.js';
import { standard } from '../src/materials/Materials.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';

await import( '../src/network/WebGPUWorldComponentAdapters.js' );

const previousAssetImageDecoder = globalThis.__assetImage;
globalThis.__assetImage = async () => ( { data: Uint8Array.from( [ 128, 200, 100, 255 ] ), width: 1, height: 1 } );

const hash = bytes => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const profile = 'elsemesh.fixture-static-model-material/1', materialAdapterType = 'elsemesh.fixture-static-model-materials/1';
registerWorldMaterialProfile( profile, { roles: [ 'tint' ] } );
const profileMaterial = standard( { name: 'fixture-profile', color: 0x35d8ff, roughness: 0.4, metalness: 0 } );
profileMaterial.userData.borrowedWorldMaterial = true;
registerWorldPackageMaterialAdapter( materialAdapterType, {
	prepare: async () => ( { context: { material: profileMaterial } } ),
	resolve: ( { profileRole, context } ) => profileRole === 'tint' ? { material: context.material } : null,
} );
const glbBytes = staticModelGLB( { materialExtras: { elsemeshMaterial: { profile, role: 'tint' } } } ), modelAssetID = hash( glbBytes );
const graph = { format: 'elsemesh.material-graph/1', nodes: [ { id: 'position', op: 'input', name: 'position' }, { id: 'normal', op: 'input', name: 'normal' }, { id: 'worldPosition', op: 'input', name: 'worldPosition' }, { id: 'worldVertexPosition', op: 'input', name: 'worldVertexPosition' }, { id: 'worldVertexX', op: 'x', args: [ 'worldVertexPosition' ] }, { id: 'worldVertexZ', op: 'z', args: [ 'worldVertexPosition' ] }, { id: 'worldVertexUV', op: 'vec2', args: [ 'worldVertexX', 'worldVertexZ' ] }, { id: 'worldNormal', op: 'input', name: 'worldNormal' }, { id: 'uv', op: 'input', name: 'uv' }, { id: 'frontFacing', op: 'input', name: 'frontFacing' }, { id: 'pixelPosition', op: 'input', name: 'pixelPosition' }, { id: 'pixelX', op: 'x', args: [ 'pixelPosition' ] }, { id: 'pixelScale', op: 'constant', value: 0.0001 }, { id: 'pixelDetail', op: 'multiply', args: [ 'pixelX', 'pixelScale' ] }, { id: 'z', op: 'z', args: [ 'position' ] }, { id: 'threshold', op: 'constant', value: 0.2 }, { id: 'above', op: 'greaterThan', args: [ 'z', 'threshold' ] }, { id: 'highColor', op: 'constant', value: [ 0.15, 0.8, 0.35 ] }, { id: 'lowColor', op: 'constant', value: [ 0.1, 0.25, 0.8 ] }, { id: 'albedo', op: 'select', args: [ 'above', 'highColor', 'lowColor' ] }, { id: 'frontScale', op: 'constant', value: 1 }, { id: 'backScale', op: 'constant', value: 0.5 }, { id: 'faceScale', op: 'select', args: [ 'frontFacing', 'frontScale', 'backScale' ] }, { id: 'albedoFacing', op: 'multiply', args: [ 'albedo', 'faceScale' ] }, { id: 'roughness', op: 'add', args: [ 'pixelDetail', 'pixelScale' ] }, { id: 'lift', op: 'constant', value: [ 0, 0.15, 0 ] }, { id: 'bentPosition', op: 'add', args: [ 'position', 'lift' ] }, { id: 'slope', op: 'constant', value: [ 0.08, - 0.04 ] }, { id: 'surfaceNormal', op: 'normalFromSlope', args: [ 'worldPosition', 'worldNormal', 'uv', 'slope' ] } ], outputs: { baseColor: 'albedoFacing', roughness: 'roughness', vertexPosition: 'bentPosition', vertexNormal: 'normal', surfaceNormal: 'surfaceNormal' } };
graph.nodes.push(
	{ id: 'data1', op: 'input', name: 'vdata1' }, { id: 'data2', op: 'input', name: 'vdata2' },
	{ id: 'dataX', op: 'x', args: [ 'data1' ] }, { id: 'dataY', op: 'y', args: [ 'data2' ] },
	{ id: 'dataLift', op: 'add', args: [ 'dataX', 'dataY' ] }, { id: 'zero', op: 'constant', value: 0 },
	{ id: 'dataOffset', op: 'vec3', args: [ 'zero', 'dataLift', 'zero' ] },
	{ id: 'bentWithData', op: 'add', args: [ 'bentPosition', 'dataOffset' ] },
);
graph.outputs.vertexPosition = 'bentWithData';
graph.nodes.push(
	{ id: 'windHeadingIntegral', op: 'input', name: 'windDirectionIntegral' },
	{ id: 'windVelocityIntegral', op: 'input', name: 'windVelocityIntegral' },
	{ id: 'windHeadingScale', op: 'constant', value: 1.5 },
	{ id: 'windVelocityScale', op: 'constant', value: 0.7 },
	{ id: 'windHeadingDrift', op: 'multiply', args: [ 'windHeadingIntegral', 'windHeadingScale' ] },
	{ id: 'windVelocityDrift', op: 'multiply', args: [ 'windVelocityIntegral', 'windVelocityScale' ] },
	{ id: 'windDrift', op: 'add', args: [ 'windHeadingDrift', 'windVelocityDrift' ] },
	{ id: 'gustUV', op: 'subtract', args: [ 'worldVertexUV', 'windDrift' ] },
	{ id: 'vertexLod', op: 'constant', value: 0 },
	{ id: 'vertexTexture', op: 'textureSampleLevel', slot: 'baseColor', uv: 'gustUV', lod: 'vertexLod' },
	{ id: 'vertexTextureGreen', op: 'y', args: [ 'vertexTexture' ] },
	{ id: 'vertexTextureScale', op: 'constant', value: 0.02 },
	{ id: 'vertexTextureLift', op: 'multiply', args: [ 'vertexTextureGreen', 'vertexTextureScale' ] },
	{ id: 'vertexTextureOffset', op: 'vec3', args: [ 'zero', 'vertexTextureLift', 'zero' ] },
	{ id: 'bentWithTexture', op: 'add', args: [ 'bentWithData', 'vertexTextureOffset' ] },
);
graph.outputs.vertexPosition = 'bentWithTexture';
const graphGLB = staticModelGLB( {
	doubleSided: true,
	materialTexture: true,
	materialExtras: { elsemeshMaterial: { profile: 'elsemesh.material-graph/1', role: 'graph', graph } },
	extraAttributes: {
		_ELSEMESH_VDATA1: [ 0.02, 0, 0, 0, 0.02, 0, 0, 0, 0.02, 0, 0, 0 ],
		_ELSEMESH_VDATA2: [ 0, 0.02, 0, 0, 0, 0.02, 0, 0, 0, 0.02, 0, 0 ],
	},
} ), graphAssetID = hash( graphGLB );
const document = {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [
		{ id: 'render-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: true, lods: [ { assetId: modelAssetID } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 20, drawMaxDistance: 90, drawFadeStartDistance: 90 },
		{ id: 'render-graph-triangle', bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: false, lods: [ { assetId: graphAssetID } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 20, drawMaxDistance: 90, drawFadeStartDistance: 90 },
	],
	instances: [
		{ model: 'render-triangle', position: [ 0, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0.25, 0.5, 0.75, 1, 2, 3, 4, 5 ] },
		{ model: 'render-graph-triangle', position: [ 1.5, 0, - 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0.25, 0.5, 0.75, 1, 2, 3, 4, 5 ] },
	],
};
const setBytes = new TextEncoder().encode( JSON.stringify( document ) ), setAssetID = hash( setBytes );
const component = { id: 'render-static-models', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: modelAssetID, kind: 'glb' }, { assetId: graphAssetID, kind: 'glb' } ] };
const connector = {
	manifest: { assets: [ { id: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { id: modelAssetID, kind: 'glb' }, { id: graphAssetID, kind: 'glb' } ], components: [ { type: materialAdapterType } ] },
	assets: new Map( [ [ setAssetID, setBytes ] ] ),
	getAsset: async id => id === graphAssetID ? graphGLB : glbBytes,
};
const errors = [];
const L = await setupLife( { W: 192, H: 144, shadowSplits: [ 12 ] } );
let runtime;
try {
	GPU.device.addEventListener( 'uncapturederror', event => errors.push( event.error?.message || 'unknown GPU error' ) );
	const root = new Group();
	root.userData.worldPackage = { parsed: new Map(), loadedObjects: new Set(), connector, materialAdapterContexts: new Map( [ [ materialAdapterType, { context: { material: profileMaterial } } ] ] ) };
	const install = worldComponentBackendAdapter( 'webgpu', component.type );
	const result = await install( { root, connector }, component );
	runtime = result.runtime;
	L.scene.add( root );
	L.camera.position.set( 2, 1, 4 );
	L.camera.lookAt( 2, 0.5, - 5 );
	const coarseDeadline = Date.now() + 3000;
	while ( ! runtime.isCoarseReadyForView() && Date.now() < coarseDeadline ) {
		await L.run( 1, dt => runtime.update( dt, L.camera ) );
		await new Promise( resolve => setTimeout( resolve, 10 ) );
	}
	assert.equal( runtime.isCoarseReadyForView(), true, 'the current view reaches coarse coverage before the render check' );
	const renderedMaterials = [];
	root.traverse( node => { if ( node.isMesh ) renderedMaterials.push( node.material ); } );
	const graphMesh = [];
	root.traverse( node => { if ( node.isMesh && node.material?.name === 'world-material-graph' ) graphMesh.push( node ); } );
	assert.ok( graphMesh.length > 0 && graphMesh.every( mesh => mesh.geometry.getAttribute( 'vdata1' ) && mesh.geometry.getAttribute( 'vdata2' ) ), 'WebGPU static GLB preparation maps both signed auxiliary vertex-data streams' );
	assert.ok( renderedMaterials.some( material => material.name === profileMaterial.name ), 'WebGPU static models resolve the registered world material profile' );
	assert.ok( renderedMaterials.some( material => material.name === 'world-material-graph' && material.surface.includes( 's.albedo *= emg_albedo' ) ), 'WebGPU compiles renderer-neutral GLB material graph data' );
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
	profileMaterial.dispose();
	GPU.device?.destroy();
	if ( previousAssetImageDecoder === undefined ) delete globalThis.__assetImage;
	else globalThis.__assetImage = previousAssetImageDecoder;
}
await new Promise( resolve => setTimeout( resolve, 200 ) );
