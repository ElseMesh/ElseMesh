import assert from 'node:assert/strict';
import { GroundCoverFieldDrawPlanner } from '../src/engine/render/GroundCoverFieldDrawPlanner.js';

const modelAssetIds = [ `sha256:${'a'.repeat( 64 )}`, `sha256:${'b'.repeat( 64 )}` ];
const record = ( x, shadowMaxDistance = 25 ) => ( {
	speciesId: 'grass', modelAssetIds, lodMetric: 'scaled-distance', lodThresholds: [ 10 ], lodFadeFraction: 0.2,
	drawMaxDistance: 100, drawFadeStartDistance: 8, windInfluence: 1, castsShadow: true, shadowMaxDistance,
	bounds: { center: [ 0, 0.5, 0 ], radius: 0.8 }, position: [ x, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ],
} );
const camera = {
	position: [ 0, 0, 0 ],
	verticalFovRadians: Math.PI / 2,
	frustumPlanes: [ [ - 1, 0, 0, 15 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ], [ 0, 0, 0, 1 ] ],
};
const planner = new GroundCoverFieldDrawPlanner();
const result = planner.update( [ record( 5 ), record( 11 ), record( 20 ) ], camera );
const groups = result.visibleGroups.get( 'grass' );
assert.equal( groups[ 0 ].indices.length, 1, 'farther visible instances use the coarse model LOD' );
assert.equal( groups[ 1 ].indices.length, 2, 'near and transitioning instances use the fine model LOD' );
assert.deepEqual( groups[ 0 ].indices, [ 1 ], 'the transition adds the same instance to its outgoing model LOD' );
assert.deepEqual( groups[ 1 ].indices, [ 0, 1 ], 'visible records are indexed consistently across backend batches' );
assert.deepEqual( result.shadowGroups.get( 'grass' )[ 0 ].indices, [ 0, 1, 2 ], 'shadow selection remains independent of view frustum culling' );
assert.ok( groups[ 0 ].drawFade[ 0 ] < 1, 'draw distance fade is included in shared records' );

const biased = planner.update( [ record( 5 ) ], { ...camera, frustumPlanes: camera.frustumPlanes.map( plane => [ ...plane ] ) }, 2 );
assert.equal( biased.visibleGroups.get( 'grass' )[ 0 ].indices.length, 1, 'render-load bias shifts demand toward coarser authored LODs' );

console.log( 'ground-cover shared LOD, fade, culling, and shadow planning: ok' );
