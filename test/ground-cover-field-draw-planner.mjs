import assert from 'node:assert/strict';
import { GroundCoverFieldDrawPlanner } from '../src/engine/render/GroundCoverFieldDrawPlanner.js';
import { StaticModelInstanceSetPlanner } from '../src/engine/render/StaticModelInstanceSetPlanner.js';

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

const parityRecords = [ record( 5 ), record( 11 ), record( 20 ) ];
const staticDocument = {
	format: 'elsemesh.static-model-instance-set/1',
	models: [ {
		id: 'grass', bounds: parityRecords[ 0 ].bounds, geometryMirrorX: false,
		lods: modelAssetIds.map( assetId => ( { assetId } ) ), lodThresholds: [ 10 ], lodMetric: 'scaled-distance', lodFadeFraction: 0.2,
		shadowLod: 0, shadowMaxDistance: 25, drawMaxDistance: 100, drawFadeStartDistance: 8,
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
	const fixedShadow = staticPlanner.shadowGroups.find( group => group.modelId === 'grass' );
	assert.deepEqual( dynamic.shadowGroups.get( 'grass' )[ 0 ].indices, [ ...fixedShadow.indices.slice( 0, fixedShadow.count ) ], `dynamic and static shadow selection agree at render-load bias ${renderLoadBias}` );
}

console.log( 'ground-cover and static-model planner conformance, LOD, fade, culling, and shadows: ok' );
