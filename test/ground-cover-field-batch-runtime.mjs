import assert from 'node:assert/strict';
import { GroundCoverFieldBatchRuntime } from '../src/engine/render/GroundCoverFieldBatchRuntime.js';
import { GroundCoverFieldRuntime } from '../src/engine/render/GroundCoverFieldRuntime.js';

const densityAssetId = `sha256:${'a'.repeat( 64 )}`;
const modelAssetId = `sha256:${'b'.repeat( 64 )}`;
const componentAssets = [ { assetId: densityAssetId, kind: 'grass-density/1' }, { assetId: modelAssetId, kind: 'glb' } ];
const data = {
	densityAssetId, seed: 11, cellSize: 8, pointsPerCell: 8, placementAlgorithm: 'blue-noise/1',
	distanceBands: [ { maxDistance: 4, cellCapacity: 8 }, { maxDistance: 24, cellCapacity: 16 } ],
	species: [ {
		id: 'meadow', densityExpression: { op: 'channel', index: 1 }, densityThreshold: 0, modelAssetIds: [ modelAssetId ],
		bounds: { center: [ 0, 0.5, 0 ], radius: 0.8 }, geometryMirrorX: false,
		lodMetric: 'scaled-distance', lodThresholds: [], lodFadeFraction: 0.12,
		drawMaxDistance: 24, drawFadeStartDistance: 20, scaleRange: [ 1, 1 ],
		windInfluence: 1, castsShadow: true, shadowMaxDistance: 12,
	} ],
};
const terrain = { res: 16, size: 16, origin: 0, texel: 1, heights: new Float32Array( 256 ), heightAt: () => 0 };
const bytes = new Uint8Array( 16 * 16 * 4 );
for ( let offset = 1; offset < bytes.length; offset += 4 ) bytes[ offset ] = 255;
const density = { res: 16, size: 16, origin: 0, data: bytes };
const field = new GroundCoverFieldRuntime( { data, componentAssets, terrain, density } );
const batches = new GroundCoverFieldBatchRuntime( field );
const camera = {
	position: [ 3, 5, 3 ], verticalFovRadians: Math.PI / 2,
	frustumPlanes: Array.from( { length: 6 }, () => [ 0, 0, 0, 1 ] ),
};
const visible = batches.update( camera );
assert.ok( visible.visible.length > 0 && visible.visible.every( batch => batch.assetId === modelAssetId ), 'visible batches resolve each selected LOD to its signed GLB' );
assert.ok( visible.visible.every( batch => batch.count > 0 && batch.matrices.length >= batch.count * 16 && batch.fades.length >= batch.count * 4 ), 'visible batches expose packed transforms and fades' );
assert.ok( visible.shadows.length > 0 && visible.shadows.every( batch => batch.shadow && batch.assetId === modelAssetId ), 'shadow intent produces separate packed shadow batches' );
assert.ok( visible.batches.every( batch => batch.count > 0 ), 'active batches are available for backend synchronization' );

const empty = batches.update( { ...camera, position: [ 1000, 5, 1000 ] } );
assert.equal( empty.visible.length, 0 );
assert.equal( empty.shadows.length, 0 );
assert.ok( empty.batches.every( batch => batch.count === 0 ), 'previously visible GPU batches are explicitly cleared after leaving coverage' );
batches.dispose();
assert.throws( () => batches.update( camera ), /disposed/ );

console.log( 'ground-cover renderer-neutral batch runtime: ok' );
