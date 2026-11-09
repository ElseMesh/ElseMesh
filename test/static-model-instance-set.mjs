import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';
import { decodeWorldComponentAsset } from '../src/network/WorldComponentAssetCodecRegistry.js';
import { loadStaticModelInstanceSetAssets, staticModelInstanceSetLoadOrder } from '../src/network/StaticModelInstanceSetAssets.js';
import { worldComponentAssetIDs } from '../src/network/WorldComponentRegistry.js';
import { WorldConnector } from '../src/network/WorldConnector.js';
import { StaticModelInstanceSetRuntime } from '../src/engine/render/StaticModelInstanceSetRuntime.js';
import { StaticModelInstanceSetPlanner, staticModelInstanceCamera } from '../src/engine/render/StaticModelInstanceSetPlanner.js';
import { updateWorldComponentRuntimes } from '../src/engine/scene/WorldComponentUpdate.js';
import {
	decodeStaticModelInstanceSet,
	STATIC_MODEL_INSTANCE_SET_ASSET_KIND,
	STATIC_MODEL_INSTANCE_SET_FORMAT,
	validateStaticModelInstanceSet,
} from '../src/network/StaticModelInstanceSet.js';

const hi = `sha256:${'a'.repeat( 64 )}`;
const low = `sha256:${'b'.repeat( 64 )}`;
const lowest = `sha256:${'c'.repeat( 64 )}`;
const setAssetID = `sha256:${'d'.repeat( 64 )}`;
const valid = {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ {
		id: 'market-table-fish',
		bounds: { center: [ 0, 0.1, 0 ], radius: 0.6 },
		geometryMirrorX: false,
		lods: [ { assetId: lowest }, { assetId: low }, { assetId: hi } ],
		lodThresholds: [ 0.004, 0.018 ],
		lodMetric: 'projected-radius',
		lodFadeFraction: 0.1,
		shadowLod: 0,
		shadowMaxDistance: 22,
		drawMaxDistance: 350,
		drawFadeStartDistance: 350,
	} ],
	instances: [ { model: 'market-table-fish', position: [ 1, 2, 3 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
};

const coarseLoadDocument = {
	...valid,
	models: [
		{ ...valid.models[ 0 ], id: 'far-furniture', bounds: { center: [ 0, 0.1, 0 ], radius: 6 } },
		{ ...valid.models[ 0 ], id: 'near-bench' },
	],
	instances: [
		{ ...valid.instances[ 0 ], model: 'far-furniture', position: [ 0, 2, -18 ] },
		{ ...valid.instances[ 0 ], model: 'near-bench', position: [ 0, 2, -4 ] },
	],
};
assert.deepEqual( staticModelInstanceSetLoadOrder( coarseLoadDocument, [ 0, 2, 0 ] ), [ 1, 0 ], 'coarse model downloads use nearest placed surface before source descriptor order' );
assert.deepEqual( staticModelInstanceSetLoadOrder( coarseLoadDocument, null ), [ 0, 1 ], 'missing view position preserves deterministic descriptor order' );

assert.equal( validateStaticModelInstanceSet( valid ), valid, 'accepts backend-neutral model assets and transforms' );
const bytes = new TextEncoder().encode( JSON.stringify( valid ) );
assert.equal( decodeStaticModelInstanceSet( bytes, { availableAssetIDs: new Set( [ hi, low, lowest ] ) } ).instances.length, 1 );
const providerLocalID = 'local-mesh-lod:great-hall:component:0';
const providerLocalDocument = structuredClone( valid );
providerLocalDocument.models[ 0 ].lods[ 0 ].assetId = providerLocalID;
assert.equal( validateStaticModelInstanceSet( providerLocalDocument, { availableAssetIDs: new Set( [ providerLocalID, low, hi ] ) } ).models[ 0 ].lods[ 0 ].assetId, providerLocalID, 'provider-scoped model IDs require declaration in the connector inventory' );
assert.throws( () => validateStaticModelInstanceSet( providerLocalDocument, { availableAssetIDs: new Set( [ hi ] ) } ), /missing/ );
assert.equal( decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, bytes ).models[ 0 ].id, 'market-table-fish', 'the engine asset-codec registry applies the generic validator' );
assert.throws( () => decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, bytes, { availableAssetIDs: new Set( [ hi ] ) } ), /missing/ );
assert.throws( () => validateStaticModelInstanceSet( valid, { availableAssetIDs: new Set( [ hi ] ) } ), /missing/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, renderer: 'webgpu' } ), /format or fields/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], geometryMirrorX: 1 } ] } ), /static model record/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], rotation: [ 0, 0, 0, 0 ] } ] } ), /normalized quaternion/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], scale: [ 1, 0, 1 ] } ] } ), /transform/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], materialData: [ 1, 2, 3 ] } ] } ), /material data/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], materialData: [ 1, 2, 3, 4, 5, 6, 7, Infinity ] } ] } ), /material data/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], lodThresholds: [ 0.018, 0.004 ] } ] } ), /overlapping LOD/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], drawMaxDistance: 0 } ] } ), /draw distance/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], lodMetric: 'scaled-distance', lodThresholds: [ 28, 26 ] } ] } ), /overlapping LOD/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], drawFadeStartDistance: 351 } ] } ), /draw fade distance/ );
assert.throws( () => decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, new Uint8Array( [ 0xff ] ) ), /UTF-8 JSON/ );

const loadedGLB = staticModelGLB();
const requestedAssets = [];
const assetConnector = {
	manifest: { assets: [
		{ id: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND },
		{ id: hi, kind: 'glb' },
		{ id: low, kind: 'glb' },
		{ id: lowest, kind: 'glb' },
	] },
	assets: new Map( [ [ setAssetID, bytes ] ] ),
	getAsset: async assetId => { requestedAssets.push( assetId ); return loadedGLB; },
};
const componentAssets = [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND }, { assetId: hi, kind: 'glb' }, { assetId: low, kind: 'glb' }, { assetId: lowest, kind: 'glb' } ];
assert.deepEqual( worldComponentAssetIDs( { type: 'elsemesh.static-model-instance-set/1', assets: componentAssets } ), [ setAssetID ], 'component startup preload includes the compact instance-set descriptor, not every possible LOD' );
const preloadConnector = new WorldConnector( { worldId: 'elsemesh:test-static-model-lod' } );
preloadConnector.manifest = {
	assets: [ setAssetID, hi, low, lowest ].map( id => ( { id, priority: 'visible' } ) ),
	objects: [],
	components: [ { type: 'elsemesh.static-model-instance-set/1', assets: componentAssets } ],
};
const preloadedIDs = [];
preloadConnector.getAsset = async id => { preloadedIDs.push( id ); return new Uint8Array( [ 1 ] ); };
await preloadConnector.preload( { through: 'visible' } );
assert.deepEqual( preloadedIDs, [ setAssetID ], 'ordinary component preload skips every lazy static-model LOD' );
await preloadConnector.preload( { through: 'visible', assetIDs: [ hi ] } );
assert.deepEqual( preloadedIDs, [ setAssetID, hi ], 'explicit caller demand may still preload a declared LOD asset' );
const resolved = await loadStaticModelInstanceSetAssets( assetConnector, { assets: componentAssets } );
assert.equal( resolved.document.models[ 0 ].id, 'market-table-fish' );
assert.deepEqual( requestedAssets, [], 'resolving the compact descriptor does not prefetch any model GLBs' );
await resolved.loadModelLOD( 0, 0 );
assert.deepEqual( requestedAssets, [ lowest ], 'the renderer explicitly requests the coarsest signed GLB to start rendering' );
await resolved.loadModelLOD( 0, 1 );
await resolved.loadModelLOD( 0, 2 );
assert.deepEqual( requestedAssets, [ lowest, low, hi ], 'finer GLBs are fetched only when the runtime requests them' );
for ( let lodIndex = 0; lodIndex < valid.models[ 0 ].lods.length; lodIndex ++ ) resolved.releaseModelLOD( 0, lodIndex );
assert.equal( resolved.modelAssets.size, 0, 'the adapter can release its temporary encoded copies after decoding each level' );
assert.equal( resolved.parsedModels.size, 0, 'the adapter can release temporary validated GLTF parses after decoding each level' );
await assert.rejects( () => loadStaticModelInstanceSetAssets( { ...assetConnector, manifest: { assets: assetConnector.manifest.assets.map( asset => asset.id === lowest ? { ...asset, kind: 'image/1' } : asset ) } }, { assets: componentAssets } ), /missing/ );
await assert.rejects( () => loadStaticModelInstanceSetAssets( assetConnector, { assets: [ componentAssets[ 0 ] ] } ), /component GLB/ );

const placements = [ 20, 35, 100, 300 ].map( z => ( { model: 'market-table-fish', position: [ 1, 2, z ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ) );
placements.push( { model: 'market-table-fish', position: [ 500, 2, 20 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
placements.push( { model: 'market-table-fish', position: [ 5, 2, 20 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
placements.push( { model: 'market-table-fish', position: [ 1, 2, 400 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
const planner = new StaticModelInstanceSetPlanner( {
	...valid,
	models: [ ...valid.models, { id: 'single-lod-model', bounds: { center: [ 0, 0, 0 ], radius: 0.3 }, geometryMirrorX: false, lods: [ { assetId: hi } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 10, drawMaxDistance: 100, drawFadeStartDistance: 100 }, { id: 'short-range-model', bounds: { center: [ 0, 0, 0 ], radius: 0.3 }, geometryMirrorX: false, lods: [ { assetId: hi } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 10, drawMaxDistance: 4, drawFadeStartDistance: 4 } ],
	instances: [ ...placements, { model: 'single-lod-model', position: [ 0, 0, 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] }, { model: 'short-range-model', position: [ 0, 0, 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
} ).update( {
	position: [ 0, 0, 0 ],
	verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ 1, 0, 0, 2 ], [ -1, 0, 0, 2 ], [ 0, 1, 0, 100 ], [ 0, -1, 0, 100 ], [ 0, 0, 1, 500 ], [ 0, 0, -1, 500 ] ],
} );
const [ coarseLod, middleLod, fineLod ] = planner.groups;
assert.deepEqual( Array.from( coarseLod.indices.subarray( 0, coarseLod.count ) ), [ 3 ] );
assert.deepEqual( Array.from( middleLod.indices.subarray( 0, middleLod.count ) ), [ 1, 2 ] );
assert.deepEqual( Array.from( fineLod.indices.subarray( 0, fineLod.count ) ), [ 0, 1 ] );
const loadBiasedPlanner = new StaticModelInstanceSetPlanner( { ...valid, instances: [ { ...valid.instances[ 0 ], position: [ 0, 0, 20 ] } ] } );
loadBiasedPlanner.update( {
	position: [ 0, 0, 0 ], verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ 1, 0, 0, 100 ], [ -1, 0, 0, 100 ], [ 0, 1, 0, 100 ], [ 0, -1, 0, 100 ], [ 0, 0, 1, 100 ], [ 0, 0, -1, 100 ] ],
} );
assert.equal( loadBiasedPlanner.groups[ 2 ].count, 1, 'the nearest LOD is selected without renderer-load bias' );
loadBiasedPlanner.update( {
	position: [ 0, 0, 0 ], verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ 1, 0, 0, 100 ], [ -1, 0, 0, 100 ], [ 0, 1, 0, 100 ], [ 0, -1, 0, 100 ], [ 0, 0, 1, 100 ], [ 0, 0, -1, 100 ] ],
}, { renderLoadBias: 1 } );
assert.equal( loadBiasedPlanner.groups[ 1 ].count, 1, 'sustained renderer load moves a projected-size model one authored LOD coarser' );
assert.throws( () => loadBiasedPlanner.update( { position: [ 0, 0, 0 ], verticalFovRadians: 1, frustumPlanes: [ [ 1, 0, 0, 1 ], [ -1, 0, 0, 1 ], [ 0, 1, 0, 1 ], [ 0, -1, 0, 1 ], [ 0, 0, 1, 1 ], [ 0, 0, -1, 1 ] ] }, { renderLoadBias: 3 } ), /bias/ );
const outgoingOffset = Array.from( middleLod.indices.subarray( 0, middleLod.count ) ).indexOf( 1 );
const incomingOffset = Array.from( fineLod.indices.subarray( 0, fineLod.count ) ).indexOf( 1 );
assert.ok( fineLod.fade[ incomingOffset ] > 0.4 && fineLod.fade[ incomingOffset ] < 0.6, 'shared LOD transition produces a fractional incoming fade' );
assert.equal( middleLod.fade[ outgoingOffset ], fineLod.fade[ incomingOffset ], 'both transition LODs use the same complementary screen-door threshold' );
assert.equal( middleLod.incoming[ outgoingOffset ], 0 );
assert.equal( fineLod.incoming[ incomingOffset ], 1 );
assert.equal( planner.shadowGroups[ 0 ].count, 2, 'shadow candidates are distance-limited independently of the camera frustum' );
assert.equal( planner.shadowGroups[ 0 ].indices[ 0 ], 0 );
assert.equal( planner.shadowGroups[ 0 ].indices[ 1 ], 5 );
assert.equal( planner.groups[ 3 ].indices.length, 1, 'per-model output buffers use that model\'s instance count' );
assert.equal( planner.shadowGroups[ 1 ].indices.length, 1 );
assert.equal( planner.groups[ 3 ].incoming[ 0 ], 2, 'a steady LOD is distinct from the outgoing transition side' );
assert.ok( ! Array.from( coarseLod.indices.subarray( 0, coarseLod.count ) ).includes( 6 ), 'instances beyond drawMaxDistance are omitted from color draws' );
assert.equal( planner.groups[ 4 ].count, 0, 'color draw distance can hide a model independently of its shadow range' );
assert.equal( planner.shadowGroups[ 2 ].indices[ 0 ], 8, 'shadow selection remains independent of color draw distance' );
assert.throws( () => planner.update( { position: [ 0, 0 ], verticalFovRadians: 1, frustumPlanes: [] } ), /camera/ );

const distanceModel = { ...valid.models[ 0 ], id: 'scaled-distance-model', lods: [ { assetId: low }, { assetId: hi } ], lodThresholds: [ 28 ], lodMetric: 'scaled-distance', lodFadeFraction: 0.12, shadowLod: 0, drawMaxDistance: 90, drawFadeStartDistance: 81 };
const distancePlanner = new StaticModelInstanceSetPlanner( {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ distanceModel ],
	instances: [ 24, 26.5, 30, 85 ].map( z => ( { model: distanceModel.id, position: [ 0, 0, z ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ) ),
} ).update( {
	position: [ 0, 0, 0 ],
	verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ 1, 0, 0, 100 ], [ -1, 0, 0, 100 ], [ 0, 1, 0, 100 ], [ 0, -1, 0, 100 ], [ 0, 0, 1, 100 ], [ 0, 0, -1, 100 ] ],
} );
const [ distanceCoarse, distanceFine ] = distancePlanner.groups;
assert.deepEqual( Array.from( distanceCoarse.indices.subarray( 0, distanceCoarse.count ) ), [ 2, 3 ], 'scaled-distance LOD starts coarse and keeps farther instances at lower detail' );
assert.deepEqual( Array.from( distanceFine.indices.subarray( 0, distanceFine.count ) ), [ 0, 1, 2 ], 'closer instances refine as distance falls below the authored boundary' );
assert.ok( distanceFine.fade[ 2 ] > 0.4 && distanceFine.fade[ 2 ] < 0.6, 'distance LOD fade fraction is author-configurable' );
assert.equal( distanceFine.drawFadeEnabled[ 0 ], 1 );
assert.equal( distanceFine.drawFade[ 0 ], 1 );
assert.ok( distanceCoarse.drawFade[ 1 ] > 0 && distanceCoarse.drawFade[ 1 ] < 1, 'draw range fades over an authored distance band' );

for ( const camera of [ new PerspectiveCamera( 60, 1, 0.1, 100 ), new THREE.PerspectiveCamera( 60, 1, 0.1, 100 ) ] ) {
	camera.position.set( 0, 0, 0 );
	camera.lookAt( 0, 0, - 1 );
	const cameraView = staticModelInstanceCamera( camera );
	assert.deepEqual( cameraView.position, [ 0, 0, 0 ] );
	assert.equal( cameraView.frustumPlanes.length, 6 );
	assert.doesNotThrow( () => planner.update( cameraView ), 'camera conversion works with both engine and Three.js perspective cameras' );
}
const infiniteFarCamera = new PerspectiveCamera( 60, 1, 0.1, 100 );
infiniteFarCamera.infiniteFar = true;
infiniteFarCamera.updateProjectionMatrix();
assert.deepEqual( staticModelInstanceCamera( infiniteFarCamera ).frustumPlanes[ 5 ], [ 0, 0, 0, 1 ], 'an infinite far plane does not reject visible instances' );

const runtimeDocument = { ...valid, instances: [ { ...valid.instances[ 0 ], position: [ 0, 0, - 5 ], materialData: [ 11, 12, 13, 14, 21, 22, 23, 24 ] } ] };
const runtimePlanner = new StaticModelInstanceSetPlanner( runtimeDocument );
const makeRuntimeBatch = ( capacity = 1 ) => {
	return {
		mesh: { count: 0, visible: false },
		matrixAttribute: { array: new Float32Array( capacity * 16 ), needsUpdate: false },
		fadeAttribute: { array: new Float32Array( capacity * 4 ), needsUpdate: false },
		materialData0Attribute: { array: new Float32Array( capacity * 4 ), needsUpdate: false },
		materialData1Attribute: { array: new Float32Array( capacity * 4 ), needsUpdate: false },
	};
};
let allowRefinement = false;
const gatedLODRequests = [];
const gatedRuntime = new StaticModelInstanceSetRuntime( runtimeDocument, {
	batches: runtimePlanner.groups.map( () => [ makeRuntimeBatch() ] ),
	shadowBatches: null,
	canRefine: () => allowRefinement,
	loadLOD: async ( modelIndex, lodIndex ) => { gatedLODRequests.push( [ modelIndex, lodIndex ] ); },
} );
const gatedCamera = new PerspectiveCamera( 60, 1, 0.1, 100 );
gatedCamera.lookAt( 0, 0, - 1 );
gatedRuntime.update( 1 / 60, gatedCamera );
assert.deepEqual( gatedLODRequests, [], 'static model meshes do not refine before the current view is covered coarsely' );
allowRefinement = true;
gatedRuntime.update( 1 / 60, gatedCamera );
await new Promise( resolve => setImmediate( resolve ) );
assert.deepEqual( gatedLODRequests, [ [ 0, 1 ] ], 'mesh refinement resumes as soon as the shared coverage gate opens, without requiring camera movement' );
gatedRuntime.dispose();

const priorityDocument = {
	...valid,
	models: [
		{ ...valid.models[ 0 ], id: 'far-furniture', bounds: { ...valid.models[ 0 ].bounds, radius: 6 } },
		{ ...valid.models[ 0 ], id: 'near-bench' },
	],
	instances: [
		{ ...valid.instances[ 0 ], model: 'far-furniture', position: [ 0, 0, - 18 ] },
		{ ...valid.instances[ 0 ], model: 'near-bench', position: [ 0, 0, - 4 ] },
	],
};
const priorityPlanner = new StaticModelInstanceSetPlanner( priorityDocument );
const priorityRequests = [];
const priorityRuntime = new StaticModelInstanceSetRuntime( priorityDocument, {
	batches: priorityPlanner.groups.map( () => [ makeRuntimeBatch() ] ),
	shadowBatches: null,
	loadLOD: async ( modelIndex, lodIndex ) => { priorityRequests.push( [ priorityDocument.models[ modelIndex ].id, lodIndex ] ); },
} );
const priorityCamera = new PerspectiveCamera( 60, 1, 0.1, 100 );
priorityCamera.lookAt( 0, 0, - 1 );
priorityRuntime.update( 1 / 60, priorityCamera );
await new Promise( resolve => setImmediate( resolve ) );
assert.deepEqual( priorityRequests, [ [ 'near-bench', 1 ], [ 'far-furniture', 1 ] ], 'visible mesh refinement prioritizes the closer surface before a larger distant bound, independent of model descriptor order' );
priorityRuntime.dispose();

let disposedRuntime = false;
const runtime = new StaticModelInstanceSetRuntime( runtimeDocument, {
	batches: runtimePlanner.groups.map( () => [ makeRuntimeBatch() ] ),
	shadowBatches: runtimePlanner.shadowGroups.map( () => [ makeRuntimeBatch() ] ),
	dispose: () => { disposedRuntime = true; },
} );
const runtimeCamera = new PerspectiveCamera( 60, 1, 0.1, 100 );
runtimeCamera.lookAt( 0, 0, - 1 );
let runtimePlannerUpdates = 0;
const updateRuntimePlanner = runtime.planner.update.bind( runtime.planner );
runtime.planner.update = ( ...args ) => { runtimePlannerUpdates ++; return updateRuntimePlanner( ...args ); };
let lodStateReads = 0;
runtime.planner._groupsByModel = new Proxy( runtime.planner._groupsByModel, {
	get( target, property, receiver ) {
		if ( /^\d+$/.test( String( property ) ) ) lodStateReads ++;
		return Reflect.get( target, property, receiver );
	},
} );
runtime.update( 1 / 60, runtimeCamera );
const activeRuntimeBatch = runtime.batches.find( group => group[ 0 ].mesh.count > 0 )[ 0 ];
assert.equal( runtimePlannerUpdates, 1 );
const initialLODStateReads = lodStateReads;
assert.equal( activeRuntimeBatch.matrixAttribute.array[ 14 ], - 5, 'shared runtime compacts world transforms into renderer instance buffers' );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 0 ], 1 );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 2 ], 1 );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 3 ], 0 );
assert.deepEqual( Array.from( activeRuntimeBatch.materialData0Attribute.array ), [ 11, 12, 13, 14 ], 'runtime compacts the first material-data vec4 in visible-instance order' );
assert.deepEqual( Array.from( activeRuntimeBatch.materialData1Attribute.array ), [ 21, 22, 23, 24 ], 'runtime compacts the second material-data vec4 in visible-instance order' );
const cachedBatchAttributes = runtime._batchAttributeGroups.slice();
activeRuntimeBatch.matrixAttribute.needsUpdate = false;
activeRuntimeBatch.fadeAttribute.needsUpdate = false;
activeRuntimeBatch.materialData0Attribute.needsUpdate = false;
activeRuntimeBatch.materialData1Attribute.needsUpdate = false;
runtime.update( 1 / 60, runtimeCamera );
assert.deepEqual( runtime._batchAttributeGroups, cachedBatchAttributes, 'unchanged LOD groups reuse their cached batch attributes' );
assert.equal( runtimePlannerUpdates, 1, 'unchanged camera and projection skip static model LOD planning' );
assert.equal( lodStateReads, initialLODStateReads, 'unchanged views skip rescanning model LOD request state' );
assert.equal( activeRuntimeBatch.matrixAttribute.needsUpdate, false, 'unchanged view does not rewrite static model transforms' );
assert.equal( activeRuntimeBatch.fadeAttribute.needsUpdate, false, 'unchanged view does not rewrite static model fades' );
assert.equal( activeRuntimeBatch.materialData0Attribute.needsUpdate, false, 'unchanged view does not rewrite static model material data' );
runtimeCamera.position.x = 0.25;
runtime.update( 1 / 60, runtimeCamera );
assert.equal( runtimePlannerUpdates, 2, 'camera movement refreshes static model LOD planning' );
assert.ok( lodStateReads > initialLODStateReads, 'camera movement rechecks visible model LOD requests' );
runtime.update( 1 / 60, runtimeCamera, undefined, 1 );
assert.equal( runtimePlannerUpdates, 3, 'render-load bias changes refresh static model LOD planning' );
const updateCameraWorldMatrix = runtimeCamera.updateMatrixWorld.bind( runtimeCamera );
let cameraMatrixRefreshes = 0;
runtimeCamera.updateMatrixWorld = force => { cameraMatrixRefreshes ++; return updateCameraWorldMatrix( force ); };
runtimeCamera.position.x = 0.5;
let reusedCameraMatrixUpdates = 0;
const otherComponentRuntimes = Array.from( { length: 535 }, () => ( {
	update: ( _dt, _camera, _player, _argument, cameraWorldUpdated ) => {
		assert.equal( cameraWorldUpdated, true );
		reusedCameraMatrixUpdates ++;
	},
} ) );
updateWorldComponentRuntimes( [ runtime, ...otherComponentRuntimes ], 1 / 60, runtimeCamera, undefined, 0 );
assert.equal( cameraMatrixRefreshes, 1, 'a 536-runtime component batch refreshes camera matrices once' );
assert.equal( reusedCameraMatrixUpdates, 535, 'all other components reuse the refreshed camera matrices' );
assert.equal( runtimePlannerUpdates, 4, 'a moved camera replans after the shared matrix refresh' );
runtimeCamera.updateMatrixWorld = updateCameraWorldMatrix;
runtime.dispose();
assert.equal( disposedRuntime, true );

let retryLoads = 0;
const retryPlanner = new StaticModelInstanceSetPlanner( runtimeDocument );
const retryRuntime = new StaticModelInstanceSetRuntime( runtimeDocument, {
	batches: retryPlanner.groups.map( () => [ makeRuntimeBatch() ] ),
	shadowBatches: retryPlanner.shadowGroups.map( () => [ makeRuntimeBatch() ] ),
	loadLOD: async () => {
		retryLoads ++;
		if ( retryLoads === 1 ) throw new Error( 'temporary LOD miss' );
	},
} );
let retryPlannerNotices = 0;
retryRuntime.addPlannerRevisionListener( () => retryPlannerNotices ++ );
retryRuntime.planner.update = () => {
	for ( const group of retryRuntime.planner.groups ) group.count = 0;
	retryRuntime.planner._groupsByModel[ 0 ][ 2 ].count = 1;
};
const originalWarn = console.warn;
console.warn = () => {};
try {
	retryRuntime.update( 1 / 60, runtimeCamera );
	for ( let attempt = 0; attempt < 10 && ( retryRuntime.retryAfter.size === 0 || retryRuntime.pendingLods.size !== 0 ); attempt ++ ) await new Promise( resolve => setImmediate( resolve ) );
	assert.equal( retryLoads, 1, 'first visible LOD request is attempted' );
	assert.equal( retryRuntime.retryAfter.size, 1, 'a failed LOD request schedules its retry' );
	assert.equal( retryRuntime.desiredLods[ 0 ], 2, 'the desired fine LOD is retained while its placement falls back to coarse geometry' );
	assert.equal( retryRuntime.planner._groupsByModel[ 0 ][ 2 ].count, 0, 'the unavailable fine LOD is removed from the active draw group' );
	retryRuntime.update( 1 / 60, runtimeCamera );
	assert.equal( retryLoads, 1, 'unchanged view does not retry before its scheduled time' );
	const retryKey = [ ...retryRuntime.retryAfter.keys() ][ 0 ];
	retryRuntime.retryAfter.set( retryKey, performance.now() - 1 );
	retryRuntime._nextLODCheckAt = performance.now() - 1;
	retryRuntime.update( 1 / 60, runtimeCamera );
	await new Promise( resolve => setImmediate( resolve ) );
	assert.equal( retryLoads, 2, 'a due retry runs without requiring another camera move' );
	retryRuntime.update( 1 / 60, runtimeCamera );
	assert.equal( retryPlannerNotices, 1, 'a completed LOD load notifies texture prioritization without camera movement' );
} finally {
	console.warn = originalWarn;
	retryRuntime.dispose();
}
assert.equal( retryRuntime.plannerRevisionListeners.size, 0, 'disposing the runtime releases planner revision listeners' );

// A provider may report the same placement in several overlapping cells.
// Ownership follows the installed runtimes, including when an owner is evicted.
const claims = new Map();
const duplicate = { ...runtimeDocument.instances[ 0 ], placementId: 'source-a' };
const colocated = { ...duplicate, placementId: 'source-b' };
const duplicateDocument = { ...runtimeDocument, instances: [ duplicate, duplicate, colocated ] };
validateStaticModelInstanceSet( duplicateDocument );
const makeClaimRuntime = document => {
	const shape = new StaticModelInstanceSetPlanner( document );
	const batch = () => ( { mesh: { count: 0, visible: false }, matrixAttribute: { array: new Float32Array( document.instances.length * 16 ) }, fadeAttribute: { array: new Float32Array( document.instances.length * 4 ) } } );
	return new StaticModelInstanceSetRuntime( document, { batches: shape.groups.map( () => [ batch() ] ), shadowBatches: shape.shadowGroups.map( () => [ batch() ] ), placementOwners: claims } );
};
const drawn = r => r.batches.reduce( ( n, group ) => n + group.reduce( ( sum, b ) => sum + b.mesh.count, 0 ), 0 );
const first = makeClaimRuntime( duplicateDocument );
let second = makeClaimRuntime( duplicateDocument );
first.update( 0, runtimeCamera ); second.update( 0, runtimeCamera );
assert.equal( drawn( first ), 2, 'duplicate placement within a component draws once while distinct colocated placement remains' );
assert.equal( drawn( second ), 0, 'overlapping cell does not draw duplicate placements' );
second.dispose();
first.update( 0, runtimeCamera );
assert.equal( drawn( first ), 2, 'removing a non-owner preserves the owner' );
second = makeClaimRuntime( duplicateDocument );
second.update( 0, runtimeCamera );
first.dispose();
second.update( 0, runtimeCamera );
assert.equal( drawn( second ), 2, 'owner removal transfers each placement before the next frame' );
const reloaded = makeClaimRuntime( duplicateDocument );
reloaded.update( 0, runtimeCamera );
assert.equal( drawn( reloaded ), 0, 'a reloaded cell shares existing ownership' );
second.dispose(); reloaded.update( 0, runtimeCamera );
assert.equal( drawn( reloaded ), 2, 'reloaded cell takes ownership after eviction' );
reloaded.dispose();
assert.equal( claims.size, 0, 'all placement claims are released' );

console.log( 'static model instance-set contract checks passed' );
