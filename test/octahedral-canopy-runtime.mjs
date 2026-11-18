import assert from 'node:assert/strict';
import { planOctahedralCanopyInstances } from '../src/engine/render/OctahedralCanopyRuntime.js';

const tree = {
	id: 'trees', modelIds: [ 'oak' ], atlasVariantRange: { start: 0, end: 3 },
	variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 },
	lod: { nearDistance: 65, maxDistance: 2800, farFade: { startDistance: 2600, endDistance: 2800 } },
};
const shrub = {
	id: 'shrubs', modelIds: [ 'sea-grape' ], atlasVariantRange: { start: 3, end: 5 },
	variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 },
	lod: { nearDistance: 45, maxDistance: 180, farFade: null },
};
const descriptor = {
	variantGroups: [ tree, shrub ],
	lodBandFraction: 0.12,
	thinning: { startDistance: 140, endDistance: 320, removeFraction: 0.5, seedMultiplier: 91.7, scaleCompensation: 'inverse-square-root-retained-density/1' },
};
const instance = ( model, x, seed, rotation = [ 0, 0, 0, 1 ] ) => ( {
	model, position: [ x, 0, 0 ], rotation, scale: [ 1, 1, 1 ], materialData: [ 0, 0, 0, 0, 0, 0, 0, seed ],
} );
const set = { instances: [
	instance( 'oak', 65, 0.01, [ 0, Math.SQRT1_2, 0, Math.SQRT1_2 ] ),
	instance( 'sea-grape', 45, 0.7331 ),
	instance( 'oak', 2700, 0.01 ),
	instance( 'oak', 2800, 0.01 ),
	instance( 'sea-grape', 180, 0.01 ),
	instance( 'oak', 320, 0.001 ),
	instance( 'oak', 320, 0.01 ),
	instance( 'unrelated', 20, 0.01 ),
] };

const plan = planOctahedralCanopyInstances( descriptor, set, [ 0, 0, 0 ] );
assert.equal( plan.length, 4, 'out-of-range and deterministically thinned instances are omitted' );
assert.deepEqual( plan.map( item => item.instanceIndex ), [ 0, 1, 2, 6 ], 'the planner keeps visible canopy records in authored order' );
const treeHandoff = plan[ 0 ];
assert.equal( treeHandoff.groupId, 'trees' );
assert.equal( treeHandoff.variantIndex, 0 );
assert.ok( Math.abs( treeHandoff.nearWeight - 0.5 ) < 1e-12 && Math.abs( treeHandoff.farWeight - 0.5 ) < 1e-12, 'tree near/far weights split at the authored handoff center' );
assert.ok( Math.abs( treeHandoff.yaw - Math.PI / 2 ) < 1e-12, 'the signed quaternion resolves to the same canopy yaw' );
assert.equal( plan[ 1 ].variantIndex, 4, 'shrub variants use their own contiguous atlas range' );
assert.equal( plan[ 2 ].farWeight, 0.5, 'tree fade is halfway through its authored 2,600–2,800 m fade' );
assert.ok( Math.abs( plan[ 2 ].farScale - Math.SQRT2 ) < 1e-12, 'far crowns are density-compensated at the thinning endpoint' );
assert.equal( plan[ 3 ].farWeight, 1, 'the retained tree remains visible at the thinning endpoint' );
assert.throws( () => planOctahedralCanopyInstances( descriptor, set, [ 0, NaN, 0 ] ), /three finite values/ );

console.log( 'shared octahedral canopy instance, LOD, fade, and thinning plan passes' );
