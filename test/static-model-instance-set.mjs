import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { staticModelGLB } from './helpers/static-model-glb.mjs';
import { decodeWorldComponentAsset } from '../src/network/WorldComponentAssetCodecRegistry.js';
import { loadStaticModelInstanceSetAssets } from '../src/network/StaticModelInstanceSetAssets.js';
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
		lods: [ { assetId: hi }, { assetId: low }, { assetId: lowest } ],
		lodThresholds: [ 0.018, 0.004 ],
		lodMetric: 'projected-radius',
		lodFadeFraction: 0.1,
		shadowLod: 1,
		shadowMaxDistance: 22,
		drawMaxDistance: 350,
		drawFadeStartDistance: 350,
	} ],
	instances: [ { model: 'market-table-fish', position: [ 1, 2, 3 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
};

assert.equal( validateStaticModelInstanceSet( valid ), valid, 'accepts backend-neutral model assets and transforms' );
const bytes = new TextEncoder().encode( JSON.stringify( valid ) );
assert.equal( decodeStaticModelInstanceSet( bytes, { availableAssetIDs: new Set( [ hi, low, lowest ] ) } ).instances.length, 1 );
assert.equal( decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, bytes ).models[ 0 ].id, 'market-table-fish', 'the engine asset-codec registry applies the generic validator' );
assert.throws( () => decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, bytes, { availableAssetIDs: new Set( [ hi ] ) } ), /missing/ );
assert.throws( () => validateStaticModelInstanceSet( valid, { availableAssetIDs: new Set( [ hi ] ) } ), /missing/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, renderer: 'webgpu' } ), /format or fields/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], rotation: [ 0, 0, 0, 0 ] } ] } ), /normalized quaternion/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], scale: [ 1, 0, 1 ] } ] } ), /transform/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], lodThresholds: [ 0.004, 0.018 ] } ] } ), /overlapping LOD/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], drawMaxDistance: 0 } ] } ), /draw distance/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], lodMetric: 'scaled-distance', lodThresholds: [ 28, 24 ] } ] } ), /overlapping LOD/ );
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
const resolved = await loadStaticModelInstanceSetAssets( assetConnector, { assets: componentAssets } );
assert.equal( resolved.document.models[ 0 ].id, 'market-table-fish' );
assert.deepEqual( [ ...resolved.modelAssets.keys() ], [ hi, low, lowest ], 'resolves the signed nested GLB assets referenced by all LODs' );
assert.deepEqual( requestedAssets, [ hi, low, lowest ] );
await assert.rejects( () => loadStaticModelInstanceSetAssets( { ...assetConnector, manifest: { assets: assetConnector.manifest.assets.map( asset => asset.id === lowest ? { ...asset, kind: 'image/1' } : asset ) } }, { assets: componentAssets } ), /missing/ );
await assert.rejects( () => loadStaticModelInstanceSetAssets( assetConnector, { assets: [ componentAssets[ 0 ] ] } ), /component GLB/ );

const placements = [ 20, 35, 100, 300 ].map( z => ( { model: 'market-table-fish', position: [ 1, 2, z ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ) );
placements.push( { model: 'market-table-fish', position: [ 500, 2, 20 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
placements.push( { model: 'market-table-fish', position: [ 5, 2, 20 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
placements.push( { model: 'market-table-fish', position: [ 1, 2, 400 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
const planner = new StaticModelInstanceSetPlanner( {
	...valid,
	models: [ ...valid.models, { id: 'single-lod-model', bounds: { center: [ 0, 0, 0 ], radius: 0.3 }, lods: [ { assetId: hi } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 10, drawMaxDistance: 100, drawFadeStartDistance: 100 }, { id: 'short-range-model', bounds: { center: [ 0, 0, 0 ], radius: 0.3 }, lods: [ { assetId: hi } ], lodThresholds: [], lodMetric: 'projected-radius', lodFadeFraction: 0.1, shadowLod: 0, shadowMaxDistance: 10, drawMaxDistance: 4, drawFadeStartDistance: 4 } ],
	instances: [ ...placements, { model: 'single-lod-model', position: [ 0, 0, 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] }, { model: 'short-range-model', position: [ 0, 0, 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
} ).update( {
	position: [ 0, 0, 0 ],
	verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ 1, 0, 0, 2 ], [ -1, 0, 0, 2 ], [ 0, 1, 0, 100 ], [ 0, -1, 0, 100 ], [ 0, 0, 1, 500 ], [ 0, 0, -1, 500 ] ],
} );
const [ nearLod, middleLod, farLod ] = planner.groups;
assert.deepEqual( Array.from( nearLod.indices.subarray( 0, nearLod.count ) ), [ 0, 1 ] );
assert.deepEqual( Array.from( middleLod.indices.subarray( 0, middleLod.count ) ), [ 1, 2 ] );
assert.ok( middleLod.fade[ 0 ] > 0.4 && middleLod.fade[ 0 ] < 0.6, 'shared LOD transition produces a fractional incoming fade' );
const outgoingOffset = Array.from( nearLod.indices.subarray( 0, nearLod.count ) ).indexOf( 1 );
const incomingOffset = Array.from( middleLod.indices.subarray( 0, middleLod.count ) ).indexOf( 1 );
assert.equal( nearLod.fade[ outgoingOffset ], middleLod.fade[ incomingOffset ], 'both transition LODs use the same complementary screen-door threshold' );
assert.equal( nearLod.incoming[ outgoingOffset ], 0 );
assert.equal( middleLod.incoming[ incomingOffset ], 1 );
assert.deepEqual( Array.from( farLod.indices.subarray( 0, farLod.count ) ), [ 3 ] );
assert.equal( planner.shadowGroups[ 0 ].count, 2, 'shadow candidates are distance-limited independently of the camera frustum' );
assert.equal( planner.shadowGroups[ 0 ].indices[ 0 ], 0 );
assert.equal( planner.shadowGroups[ 0 ].indices[ 1 ], 5 );
assert.equal( planner.groups[ 3 ].indices.length, 1, 'per-model output buffers use that model\'s instance count' );
assert.equal( planner.shadowGroups[ 1 ].indices.length, 1 );
assert.equal( planner.groups[ 3 ].incoming[ 0 ], 2, 'a steady LOD is distinct from the outgoing transition side' );
assert.ok( ! Array.from( farLod.indices.subarray( 0, farLod.count ) ).includes( 6 ), 'instances beyond drawMaxDistance are omitted from color draws' );
assert.equal( planner.groups[ 4 ].count, 0, 'color draw distance can hide a model independently of its shadow range' );
assert.equal( planner.shadowGroups[ 2 ].indices[ 0 ], 8, 'shadow selection remains independent of color draw distance' );
assert.throws( () => planner.update( { position: [ 0, 0 ], verticalFovRadians: 1, frustumPlanes: [] } ), /camera/ );

const distanceModel = { ...valid.models[ 0 ], id: 'scaled-distance-model', lods: [ { assetId: hi }, { assetId: low } ], lodThresholds: [ 28 ], lodMetric: 'scaled-distance', lodFadeFraction: 0.12, shadowLod: 1, drawMaxDistance: 90, drawFadeStartDistance: 81 };
const distancePlanner = new StaticModelInstanceSetPlanner( {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ distanceModel ],
	instances: [ 24, 26.5, 30, 85 ].map( z => ( { model: distanceModel.id, position: [ 0, 0, z ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ) ),
} ).update( {
	position: [ 0, 0, 0 ],
	verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ 1, 0, 0, 100 ], [ -1, 0, 0, 100 ], [ 0, 1, 0, 100 ], [ 0, -1, 0, 100 ], [ 0, 0, 1, 100 ], [ 0, 0, -1, 100 ] ],
} );
const [ distanceNear, distanceFar ] = distancePlanner.groups;
assert.deepEqual( Array.from( distanceNear.indices.subarray( 0, distanceNear.count ) ), [ 0, 1 ], 'scaled-distance LOD starts with the high-detail model and cross-fades by world distance divided by instance scale' );
assert.deepEqual( Array.from( distanceFar.indices.subarray( 0, distanceFar.count ) ), [ 1, 2, 3 ] );
assert.ok( distanceNear.fade[ 1 ] > 0.5 && distanceNear.fade[ 1 ] < 0.6, 'distance LOD fade fraction is author-configurable' );
assert.equal( distanceNear.drawFadeEnabled[ 0 ], 1 );
assert.equal( distanceNear.drawFade[ 0 ], 1 );
assert.ok( distanceFar.drawFade[ 2 ] > 0 && distanceFar.drawFade[ 2 ] < 1, 'draw range fades over an authored distance band' );

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
runtime.update( 1 / 60, runtimeCamera );
const activeRuntimeBatch = runtime.batches.find( group => group[ 0 ].mesh.count > 0 )[ 0 ];
assert.equal( activeRuntimeBatch.matrixAttribute.array[ 14 ], - 5, 'shared runtime compacts world transforms into renderer instance buffers' );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 0 ], 1 );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 2 ], 1 );
assert.equal( activeRuntimeBatch.fadeAttribute.array[ 3 ], 0 );
runtime.dispose();
assert.equal( disposedRuntime, true );

console.log( 'static model instance-set contract checks passed' );
