import assert from 'node:assert/strict';
import { localRegionStaticModelSets } from '../src/network/LocalRegionStaticModels.js';

const profiles = [
	{ index: 0, usable: true, screenSize: 0.1794 },
	{ index: 1, usable: true, screenSize: 0.05985 },
	{ index: 2, usable: true, screenSize: 0.02498 },
];
const source = ( instanceIndex, x ) => ( {
	componentPath: '/Game/GreatHall/SM_Table.Component0',
	staticMeshPath: '/Game/GreatHall/SM_Table',
	isSplineMesh: false,
	instanceIndex,
	instanceTransformCount: 2,
	transform: { position: [ x, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] },
	boundsMeters: { min: [ x - 1, - 1, - 1 ], max: [ x + 1, 1, 1 ] },
} );
const cell = {
	visualInstances: [ source( 0, 0 ), source( 1, 4 ) ],
	meshLods: [ { staticMeshPath: '/Game/GreatHall/SM_Table', lods: profiles } ],
};
const options = { regionID: 'a'.repeat( 64 ), cellSizeMeters: 16, coordinates: [ 1, 2, 3 ], priority: 'visible', maxDistanceMeters: 120 };
const sets = localRegionStaticModelSets( cell, options );
assert.equal( sets.length, 1 );
assert.equal( sets[ 0 ].component.type, 'elsemesh.static-model-instance-set/1' );
assert.equal( sets[ 0 ].document.instances.length, 2 );
assert.deepEqual( sets[ 0 ].document.models[ 0 ].lodThresholds, [ 0.05985, 0.1794 ], 'Unreal authored ScreenSize thresholds are ordered coarse-to-fine' );
assert.match( sets[ 0 ].document.models[ 0 ].lods[ 0 ].assetId, /:2$/, 'the coarsest usable Unreal LOD loads first' );
assert.equal( sets[ 0 ].component.assets.length, 4, 'the component declares its descriptor and each independent mesh LOD' );
assert.ok( sets[ 0 ].document.models[ 0 ].bounds.radius >= Math.sqrt( 3 ), 'model bounds conservatively enclose the world-space source bounds' );
assert.equal( sets[ 0 ].component.streamingBounds.center.join( ',' ), '24,40,56' );
assert.equal( localRegionStaticModelSets( { ...cell, visualInstances: [ { ...source( 0, 0 ), isSplineMesh: true } ] }, options ), null, 'spline-deformed meshes stay on the whole-cell GLB path' );
assert.equal( localRegionStaticModelSets( { ...cell, meshLods: [] }, options ), null, 'incomplete mesh profiles keep the whole-cell fallback' );
const invalidProfiles = [ { ...profiles[ 0 ], screenSize: 0.05 }, { ...profiles[ 1 ], screenSize: 0.1 }, { ...profiles[ 2 ], screenSize: 0.02 } ];
assert.equal( localRegionStaticModelSets( { ...cell, meshLods: [ { staticMeshPath: '/Game/GreatHall/SM_Table', lods: invalidProfiles } ] }, options ), null, 'non-monotonic authored thresholds do not produce a guessed LOD policy' );

console.info( 'local-region static model instance-set synthesis checks passed' );
