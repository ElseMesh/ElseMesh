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
	materialOverrideKey: '',
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
const overlap = localRegionStaticModelSets( cell, { ...options, coordinates: [ 2, 2, 3 ] } )[ 0 ];
assert.deepEqual( overlap.document.instances.map( i => i.placementId ), sets[ 0 ].document.instances.map( i => i.placementId ), 'overlapping cells derive the same source placement identities' );
const colocated = localRegionStaticModelSets( { ...cell, visualInstances: [ source( 0, 0 ), source( 1, 0 ) ] }, options )[ 0 ];
assert.notEqual( colocated.document.instances[ 0 ].placementId, colocated.document.instances[ 1 ].placementId, 'distinct source instance indices remain distinct at identical transforms' );
const otherComponent = { ...source( 0, 0 ), componentPath: '/Game/GreatHall/Other.Component0' };
const otherSet = localRegionStaticModelSets( { ...cell, visualInstances: [ otherComponent ] }, options )[ 0 ];
assert.notEqual( sets[ 0 ].document.instances[ 0 ].placementId, otherSet.document.instances[ 0 ].placementId, 'distinct source components remain distinct at identical transforms' );
assert.deepEqual( otherSet.document.models[ 0 ].lods, sets[ 0 ].document.models[ 0 ].lods, 'same source mesh and material overrides reuse LOD asset IDs across components' );
const otherRegion = localRegionStaticModelSets( cell, { ...options, regionID: 'b'.repeat( 64 ), coordinates: [ 9, 9, 9 ] } )[ 0 ];
assert.deepEqual( otherRegion.document.models[ 0 ].lods, sets[ 0 ].document.models[ 0 ].lods, 'source mesh LOD IDs are independent of region and cell placement' );
const duplicateMeshComponents = [ source( 0, 0 ), { ...source( 0, 4 ), componentPath: '/Game/GreatHall/Other.Component0' } ];
const deduplicated = localRegionStaticModelSets( { ...cell, visualInstances: duplicateMeshComponents }, options )[ 0 ];
assert.equal( deduplicated.document.models.length, 1, 'components using the same mesh and material overrides share one per-cell LOD asset group' );
assert.equal( deduplicated.document.instances.length, 2, 'sharing mesh assets retains both authored placements' );
assert.notEqual( deduplicated.document.instances[ 0 ].placementId, deduplicated.document.instances[ 1 ].placementId, 'shared mesh assets do not merge distinct placed components' );
const materialVariant = { ...source( 0, 4 ), componentPath: '/Game/GreatHall/Other.Component0', materialOverrideKey: '0=/Game/Materials/Blue' };
const materialVariants = localRegionStaticModelSets( { ...cell, visualInstances: [ source( 0, 0 ), materialVariant ] }, options )[ 0 ];
assert.equal( materialVariants.document.models.length, 2, 'different authored material overrides retain separate mesh assets' );
assert.equal( new Set( materialVariants.document.models.flatMap( model => model.lods.map( lod => lod.assetId ) ) ).size, 6, 'different material overrides never alias the same source mesh LOD assets' );
assert.deepEqual( sets[ 0 ].document.models[ 0 ].lodThresholds, [ 0.05985, 0.1794 ], 'Unreal authored ScreenSize thresholds are ordered coarse-to-fine' );
assert.match( sets[ 0 ].document.models[ 0 ].lods[ 0 ].assetId, /:2$/, 'the coarsest usable Unreal LOD loads first' );
assert.equal( sets[ 0 ].component.assets.length, 4, 'the component declares its descriptor and each independent mesh LOD' );
assert.ok( sets[ 0 ].document.models[ 0 ].bounds.radius >= Math.sqrt( 3 ), 'model bounds conservatively enclose the world-space source bounds' );
assert.equal( sets[ 0 ].document.models[ 0 ].geometryMirrorX, false );
assert.equal( sets[ 0 ].descriptorAssetID, `local-static-model-set:${ options.regionID }:16:1:2:3:0`, 'descriptor has an unversioned source-derived identity' );
assert.equal( sets[ 0 ].component.streamingBounds.center.join( ',' ), '2,0,0', 'static-set bounds follow source visual bounds instead of the cell center' );
const mixedScale = { ...source( 2, 8 ), transform: { ...source( 2, 8 ).transform, scale: [ -1, 1, 1 ] } };
const mixedScaleSets = localRegionStaticModelSets( { ...cell, visualInstances: [ source( 0, 0 ), mixedScale ] }, options );
assert.equal( mixedScaleSets.length, 1, 'mirrored transforms remain eligible for per-mesh LOD sets' );
assert.equal( mixedScaleSets[ 0 ].document.models.length, 2, 'instances split into identity and mirrored geometry batches' );
assert.deepEqual( mixedScaleSets[ 0 ].document.models[ 0 ].lods, mixedScaleSets[ 0 ].document.models[ 1 ].lods, 'geometry mirroring does not duplicate unchanged source mesh bytes' );
const mirroredModel = mixedScaleSets[ 0 ].document.models.find( model => model.geometryMirrorX );
const mirroredInstance = mixedScaleSets[ 0 ].document.instances.find( instance => instance.model === mirroredModel.id );
assert.deepEqual( mirroredInstance.scale, [ 1, 1, 1 ], 'negative source scale is represented through geometry and rotation transforms' );
assert.deepEqual( mirroredInstance.rotation, [ 0, 0, 0, 1 ], 'an X-mirrored source scale is canceled by X-mirrored geometry' );
const doubleMirror = { ...source( 3, 12 ), transform: { ...source( 3, 12 ).transform, scale: [ -1, -1, 1 ] } };
const doubleMirrorSet = localRegionStaticModelSets( { ...cell, visualInstances: [ doubleMirror ] }, options )[ 0 ];
assert.equal( doubleMirrorSet.document.models[ 0 ].geometryMirrorX, false, 'even reflection parity is absorbed into a proper rotation' );
assert.deepEqual( doubleMirrorSet.document.instances[ 0 ].rotation, [ 0, 0, 1, 0 ] );
assert.equal( localRegionStaticModelSets( { ...cell, visualInstances: [ { ...source( 0, 0 ), isSplineMesh: true } ] }, options ), null, 'spline-deformed meshes stay on the whole-cell GLB path' );
assert.equal( localRegionStaticModelSets( { ...cell, meshLods: [] }, options ), null, 'incomplete mesh profiles keep the whole-cell fallback' );
const invalidProfiles = [ { ...profiles[ 0 ], screenSize: 0.05 }, { ...profiles[ 1 ], screenSize: 0.1 }, { ...profiles[ 2 ], screenSize: 0.02 } ];
assert.equal( localRegionStaticModelSets( { ...cell, meshLods: [ { staticMeshPath: '/Game/GreatHall/SM_Table', lods: invalidProfiles } ] }, options ), null, 'non-monotonic authored thresholds do not produce a guessed LOD policy' );

console.info( 'local-region static model instance-set synthesis checks passed' );
