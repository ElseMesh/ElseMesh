import assert from 'node:assert/strict';
import { GroundCoverFieldRuntime } from '../src/engine/render/GroundCoverFieldRuntime.js';

const densityAssetId = `sha256:${'a'.repeat( 64 )}`;
const modelAssetId = `sha256:${'b'.repeat( 64 )}`;
const componentAssets = [ { assetId: densityAssetId, kind: 'grass-density/1' }, { assetId: modelAssetId, kind: 'glb' } ];
const data = {
	densityAssetId, seed: 7, cellSize: 8, pointsPerCell: 4, placementAlgorithm: 'blue-noise/1',
	distanceBands: [ { maxDistance: 4, cellCapacity: 8 }, { maxDistance: 24, cellCapacity: 16 } ],
	species: [ {
		id: 'meadow-grass', densityExpression: { op: 'channel', index: 1 }, densityThreshold: 8, modelAssetIds: [ modelAssetId ],
		bounds: { center: [ 0, 0.5, 0 ], radius: 0.8 }, geometryMirrorX: false,
		lodMetric: 'scaled-distance', lodThresholds: [], lodFadeFraction: 0.12,
		drawMaxDistance: 24, drawFadeStartDistance: 20, scaleRange: [ 0.7, 1.3 ],
		windInfluence: 1, castsShadow: false, shadowMaxDistance: 0,
	} ],
};
const terrain = {
	res: 16, size: 16, origin: 0, texel: 1, heights: new Float32Array( 256 ),
	heightAt: ( x, z ) => x * 0.01 + z * 0.02,
};
const densityData = new Uint8Array( 16 * 16 * 4 );
for ( let index = 1; index < densityData.length; index += 4 ) densityData[ index ] = 255;
const density = { res: 16, size: 16, origin: 0, data: densityData };
const first = new GroundCoverFieldRuntime( { data, componentAssets, terrain, density } );
const firstView = first.update( { x: 3, z: 3 } ).map( record => ( { ...record, position: [ ...record.position ], rotation: [ ...record.rotation ], scale: [ ...record.scale ] } ) );
const repeatedView = first.update( { x: 3, z: 3 } );
assert.deepEqual( repeatedView, firstView, 'candidate positions and species choices are deterministic across updates' );
assert.ok( firstView.length > 0, 'full density creates candidate instances in occupied cells' );
assert.ok( firstView.every( record => record.speciesId === 'meadow-grass' && record.modelAssetIds[ 0 ] === modelAssetId ), 'records carry the renderer-neutral species and signed model reference' );
assert.ok( firstView.every( record => record.position[ 1 ] === record.position[ 0 ] * 0.01 + record.position[ 2 ] * 0.02 ), 'instance heights come from the shared terrain query' );
assert.ok( firstView.every( record => record.position[ 0 ] >= 0 && record.position[ 0 ] <= terrain.size && record.position[ 2 ] >= 0 && record.position[ 2 ] <= terrain.size ), 'candidate transforms stay within their authored terrain cells' );
assert.ok( firstView.some( record => record.cellLodIndex === 0 ) && firstView.some( record => record.cellLodIndex === 1 ), 'visible cells are assigned through the shared distance bands' );
const drawPlan = first.planDraws( {
	position: [ 3, 5, 3 ], verticalFovRadians: Math.PI / 2,
	frustumPlanes: Array.from( { length: 6 }, () => [ 0, 0, 0, 1 ] ),
} );
const drawCount = [ ...drawPlan.visibleGroups.values() ].flat().reduce( ( total, group ) => total + group.indices.length, 0 );
assert.ok( drawCount > 0 && drawCount <= firstView.length, 'the engine draw planner selects renderer-neutral runtime instances for backend batches' );
assert.deepEqual( new GroundCoverFieldRuntime( { data, componentAssets, terrain, density } ).update( { x: 3, z: 3 } ), firstView, 'separate runtimes produce identical candidate transforms' );
assert.deepEqual( first.update( { x: 1000, z: 1000 } ), [], 'camera movement outside the authored field removes visible candidates' );
first.dispose();
assert.throws( () => first.update( { x: 3, z: 3 } ), /disposed/ );
assert.throws( () => first.planDraws( { position: [ 0, 0, 0 ], verticalFovRadians: 1, frustumPlanes: [] } ), /disposed/ );

console.log( 'ground-cover shared placement runtime: ok' );
