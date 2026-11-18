import assert from 'node:assert/strict';
import { GroundCoverFieldDrawPlanner } from '../src/engine/render/GroundCoverFieldDrawPlanner.js';
import { StaticModelInstanceSetPlanner } from '../src/engine/render/StaticModelInstanceSetPlanner.js';

const modelAssetIds = [ `sha256:${'a'.repeat( 64 )}`, `sha256:${'b'.repeat( 64 )}` ];
const record = ( x, shadowMaxDistance = 25 ) => ( {
	speciesId: 'grass', modelAssetIds, lodMetric: 'scaled-distance', lodThresholds: [ 10 ], lodFadeFraction: 0.2,
	drawMaxDistance: 100, drawFadeStartDistance: 8, castsShadow: true, shadowLodBias: 0, shadowMaxDistance,
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
assert.equal( groups[ 1 ].indices.length, 0, 'neutral-load headroom keeps visible ground cover on LOD0 before the authored threshold requires a coarser level' );
assert.equal( groups[ 0 ].indices.length, 2, 'near and transitioning instances use the highest-detail LOD0 model' );
assert.deepEqual( groups[ 1 ].indices, [], 'the detail headroom avoids a premature transition to the outgoing coarser LOD' );
assert.deepEqual( groups[ 0 ].indices, [ 0, 1 ], 'visible records are indexed consistently across backend batches' );
assert.deepEqual( result.shadowGroups.get( 'grass' )[ 0 ].indices, [ 0, 1 ], 'near and transitioning shadow candidates use LOD0 independently of view frustum culling' );
assert.deepEqual( result.shadowGroups.get( 'grass' )[ 1 ].indices, [ 1, 2 ], 'farther shadow candidates use the next coarser level with a shared transition' );
assert.ok( groups[ 0 ].drawFade[ 1 ] < 1, 'draw distance fade is included in shared LOD0 records' );

const worldDistanceGroundCover = {
	...record( 0 ), lodMetric: 'world-distance', lodThresholds: [ 120 ], drawMaxDistance: 1000, drawFadeStartDistance: 1000,
	bounds: { center: [ 0, - 50, 0 ], radius: 1 }, position: [ 0, 0, 0 ], scale: [ 4, 4, 4 ],
};
const worldDistanceGroundCoverResult = planner.update( [ worldDistanceGroundCover ], { ...camera, position: [ 0, 100, 0 ], frustumPlanes: camera.frustumPlanes.map( plane => [ plane[ 0 ], plane[ 1 ], plane[ 2 ], 1000 ] ) } );
assert.deepEqual( worldDistanceGroundCoverResult.visibleGroups.get( 'grass' )[ 0 ].indices, [ 0 ], 'ground cover uses LOD0 as the highest-detail model and shares placement-origin distance semantics with static models' );

const biased = planner.update( [ record( 5 ) ], { ...camera, frustumPlanes: camera.frustumPlanes.map( plane => [ ...plane ] ) }, 2 );
assert.equal( biased.visibleGroups.get( 'grass' )[ 1 ].indices.length, 1, 'render-load bias shifts demand toward coarser authored LODs' );

const parityRecords = [ record( 5 ), record( 11 ), record( 20 ) ];
const staticDocument = {
	format: 'elsemesh.static-model-instance-set/1',
	models: [ {
		id: 'grass', bounds: parityRecords[ 0 ].bounds, geometryMirrorX: false,
		lods: modelAssetIds.map( assetId => ( { assetId } ) ), lodThresholds: [ 10 ], lodMetric: 'scaled-distance', lodFadeFraction: 0.2,
		shadowLodBias: 0, shadowMaxDistance: 25, drawMaxDistance: 100, drawFadeStartDistance: 8,
	} ],
	instances: parityRecords.map( value => ( { model: value.speciesId, position: value.position, rotation: value.rotation, scale: value.scale } ) ),
};
for ( const renderLoadBias of [ 0, 2 ] ) {
	const dynamic = planner.update( parityRecords, camera, renderLoadBias );
	const staticPlanner = new StaticModelInstanceSetPlanner( staticDocument );
	staticPlanner.update( camera, { renderLoadBias } );
	const dynamicGroups = dynamic.visibleGroups.get( 'grass' );
	for ( let lodIndex = 0; lodIndex < modelAssetIds.length; lodIndex ++ ) {
		const fixedGroup = staticPlanner.groups.find( group => group.modelId === 'grass' && group.lodIndex === lodIndex );
		const dynamicGroup = dynamicGroups[ lodIndex ];
		assert.deepEqual( dynamicGroup.indices, [ ...fixedGroup.indices.slice( 0, fixedGroup.count ) ], `dynamic and static LOD ${lodIndex} select the same instances at render-load bias ${renderLoadBias}` );
		assert.deepEqual( dynamicGroup.incoming, [ ...fixedGroup.incoming.slice( 0, fixedGroup.count ) ], `dynamic and static LOD ${lodIndex} agree on transition direction at render-load bias ${renderLoadBias}` );
		for ( let index = 0; index < fixedGroup.count; index ++ ) {
			for ( const key of [ 'fade', 'drawFade' ] ) assert.ok( Math.abs( dynamicGroup[ key ][ index ] - fixedGroup[ key ][ index ] ) < 1e-6, `dynamic and static LOD ${lodIndex} agree on ${key}` );
			assert.equal( dynamicGroup.drawFadeEnabled[ index ], fixedGroup.drawFadeEnabled[ index ], `dynamic and static LOD ${lodIndex} agree on draw-fade activation` );
		}
	}
	for ( let lodIndex = 0; lodIndex < modelAssetIds.length; lodIndex ++ ) {
		const fixedShadow = staticPlanner.shadowGroups.find( group => group.modelId === 'grass' && group.lodIndex === lodIndex );
		const dynamicShadow = dynamic.shadowGroups.get( 'grass' )[ lodIndex ];
		assert.deepEqual( dynamicShadow.indices, [ ...fixedShadow.indices.slice( 0, fixedShadow.count ) ], `dynamic and static shadow LOD ${lodIndex} selection agrees at render-load bias ${renderLoadBias}` );
		assert.deepEqual( dynamicShadow.incoming, [ ...fixedShadow.incoming.slice( 0, fixedShadow.count ) ], `dynamic and static shadow LOD ${lodIndex} transition direction agrees at render-load bias ${renderLoadBias}` );
	}
}

console.log( 'ground-cover and static-model planner conformance, LOD, fade, culling, and shadows: ok' );
