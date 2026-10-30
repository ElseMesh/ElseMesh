import assert from 'node:assert/strict';
import { decodeWorldComponentAsset } from '../src/network/WorldComponentAssetCodecRegistry.js';
import { loadStaticModelInstanceSetAssets } from '../src/network/StaticModelInstanceSetAssets.js';
import { StaticModelInstanceSetPlanner } from '../src/engine/render/StaticModelInstanceSetPlanner.js';
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
		shadowLod: 1,
		shadowMaxDistance: 22,
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
assert.throws( () => decodeWorldComponentAsset( STATIC_MODEL_INSTANCE_SET_ASSET_KIND, new Uint8Array( [ 0xff ] ) ), /UTF-8 JSON/ );

const loadedGLB = new Uint8Array( [ 1, 2, 3 ] );
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
const resolved = await loadStaticModelInstanceSetAssets( assetConnector, { assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND } ] } );
assert.equal( resolved.document.models[ 0 ].id, 'market-table-fish' );
assert.deepEqual( [ ...resolved.modelAssets.keys() ], [ hi, low, lowest ], 'resolves the signed nested GLB assets referenced by all LODs' );
assert.deepEqual( requestedAssets, [ hi, low, lowest ] );
await assert.rejects( () => loadStaticModelInstanceSetAssets( { ...assetConnector, manifest: { assets: assetConnector.manifest.assets.map( asset => asset.id === lowest ? { ...asset, kind: 'image/1' } : asset ) } }, { assets: [ { assetId: setAssetID, kind: STATIC_MODEL_INSTANCE_SET_ASSET_KIND } ] } ), /missing/ );

const placements = [ 20, 35, 100, 300 ].map( z => ( { model: 'market-table-fish', position: [ 1, 2, z ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ) );
placements.push( { model: 'market-table-fish', position: [ 500, 2, 20 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
placements.push( { model: 'market-table-fish', position: [ 5, 2, 20 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } );
const planner = new StaticModelInstanceSetPlanner( {
	...valid,
	models: [ ...valid.models, { id: 'single-lod-model', bounds: { center: [ 0, 0, 0 ], radius: 0.3 }, lods: [ { assetId: hi } ], lodThresholds: [], shadowLod: 0, shadowMaxDistance: 10 } ],
	instances: [ ...placements, { model: 'single-lod-model', position: [ 0, 0, 5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
} ).update( {
	position: [ 0, 0, 0 ],
	verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ 1, 0, 0, 2 ], [ -1, 0, 0, 2 ], [ 0, 1, 0, 100 ], [ 0, -1, 0, 100 ], [ 0, 0, 1, 500 ], [ 0, 0, -1, 500 ] ],
} );
const [ nearLod, middleLod, farLod ] = planner.groups;
assert.deepEqual( Array.from( nearLod.indices.subarray( 0, nearLod.count ) ), [ 0, 1 ] );
assert.deepEqual( Array.from( middleLod.indices.subarray( 0, middleLod.count ) ), [ 1, 2 ] );
assert.ok( middleLod.fade[ 0 ] > 0.4 && middleLod.fade[ 0 ] < 0.6, 'shared LOD transition produces a fractional incoming fade' );
assert.deepEqual( Array.from( farLod.indices.subarray( 0, farLod.count ) ), [ 3 ] );
assert.equal( planner.shadowGroups[ 0 ].count, 2, 'shadow candidates are distance-limited independently of the camera frustum' );
assert.equal( planner.shadowGroups[ 0 ].indices[ 0 ], 0 );
assert.equal( planner.shadowGroups[ 0 ].indices[ 1 ], 5 );
assert.equal( planner.groups[ 3 ].indices.length, 1, 'per-model output buffers use that model\'s instance count' );
assert.equal( planner.shadowGroups[ 1 ].indices.length, 1 );
assert.throws( () => planner.update( { position: [ 0, 0 ], verticalFovRadians: 1, frustumPlanes: [] } ), /camera/ );

console.log( 'static model instance-set contract checks passed' );
