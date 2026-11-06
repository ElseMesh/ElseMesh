import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';
import { decodeWorldComponentAsset } from '../src/network/WorldComponentAssetCodecRegistry.js';
import { loadStaticModelInstanceSetAssets } from '../src/network/StaticModelInstanceSetAssets.js';
import { worldComponentAssetIDs } from '../src/network/WorldComponentRegistry.js';
import { WorldConnector } from '../src/network/WorldConnector.js';
import { StaticModelInstanceSetRuntime } from '../src/engine/render/StaticModelInstanceSetRuntime.js';
import { StaticModelInstanceSetPlanner, staticModelInstanceCamera } from '../src/engine/render/StaticModelInstanceSetPlanner.js';
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

const runtimeDocument = { ...valid, instances: [ { ...valid.instances[ 0 ], position: [ 0, 0, - 5 ] } ] };
const runtimePlanner = new StaticModelInstanceSetPlanner( runtimeDocument );
const makeRuntimeBatch = () => {
	const capacity = 1;
	return { mesh: { count: 0, visible: false }, matrixAttribute: { array: new Float32Array( capacity * 16 ), needsUpdate: false }, fadeAttribute: { array: new Float32Array( capacity * 4 ), needsUpdate: false } };
};
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
runtime.update( 1 / 60, runtimeCamera );
const activeRuntimeBatch = runtime.batches.find( group => group[ 0 ].mesh.count > 0 )[ 0 ];
assert.equal( runtimePlannerUpdates, 1 );
assert.equal( activeRuntimeBatch.matrixAttribute.array[ 14 ], - 5, 'shared runtime compacts world transforms into renderer instance buffers' );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 0 ], 1 );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 2 ], 1 );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 3 ], 0 );
const cachedBatchAttributes = runtime._batchAttributeGroups.slice();
activeRuntimeBatch.matrixAttribute.needsUpdate = false;
activeRuntimeBatch.fadeAttribute.needsUpdate = false;
runtime.update( 1 / 60, runtimeCamera );
assert.deepEqual( runtime._batchAttributeGroups, cachedBatchAttributes, 'unchanged LOD groups reuse their cached batch attributes' );
assert.equal( runtimePlannerUpdates, 1, 'unchanged camera and projection skip static model LOD planning' );
assert.equal( activeRuntimeBatch.matrixAttribute.needsUpdate, false, 'unchanged view does not rewrite static model transforms' );
assert.equal( activeRuntimeBatch.fadeAttribute.needsUpdate, false, 'unchanged view does not rewrite static model fades' );
runtimeCamera.position.x = 0.25;
runtime.update( 1 / 60, runtimeCamera );
assert.equal( runtimePlannerUpdates, 2, 'camera movement refreshes static model LOD planning' );
runtime.update( 1 / 60, runtimeCamera, undefined, 1 );
assert.equal( runtimePlannerUpdates, 3, 'render-load bias changes refresh static model LOD planning' );
runtime.dispose();
assert.equal( disposedRuntime, true );

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
