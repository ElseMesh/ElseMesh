import assert from 'node:assert/strict';
import { createOctahedralCanopyDrawBuffers, planOctahedralCanopyInstances, writeOctahedralCanopyDrawPlan } from '../src/engine/render/OctahedralCanopyRuntime.js';

const tree = {
	id: 'trees', modelIds: [ 'oak' ], atlasVariantRange: { start: 0, end: 3 },
	variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 },
	windHeightDataIndex: 2,
	bounds: { center: [ 0, 0, 0 ], radius: 5, horizontalRadius: 2, halfHeight: 5 },
	lod: { nearDistance: 65, maxDistance: 2800, farFade: { startDistance: 2600, endDistance: 2800 } },
};
const shrub = {
	id: 'shrubs', modelIds: [ 'sea-grape' ], atlasVariantRange: { start: 3, end: 5 },
	variantSelection: { source: 'instance-material-data', index: 7, method: 'fractional-bin/1', multiplier: 7.77 },
	windHeightDataIndex: 2,
	bounds: { center: [ 0, 0, 0 ], radius: 5, horizontalRadius: 2, halfHeight: 5 },
	lod: { nearDistance: 45, maxDistance: 180, farFade: null },
};
const descriptor = {
	variantGroups: [ tree, shrub ],
	projection: { type: 'hemi-octahedral/1', framesPerSide: 6 },
	frameBlendDistance: 100,
	lodBandFraction: 0.12,
	thinning: { startDistance: 140, endDistance: 320, removeFraction: 0.5, seedMultiplier: 91.7, scaleCompensation: 'inverse-square-root-retained-density/1' },
};
const instance = ( model, x, seed, rotation = [ 0, 0, 0, 1 ], scale = [ 1, 1, 1 ] ) => ( {
	model, position: [ x, 0, 0 ], rotation, scale, materialData: [ 0, 0, 12.5, 0, 0, 0, 0, seed ],
} );
const set = { instances: [
	instance( 'oak', 65, 0.01, [ 0, Math.SQRT1_2, 0, Math.SQRT1_2 ] ),
	instance( 'sea-grape', 45, 0.7331 ),
	instance( 'oak', 20, 0.01 ),
	instance( 'oak', 2700, 0.01 ),
	instance( 'oak', 2800, 0.01 ),
	instance( 'sea-grape', 180, 0.01 ),
	instance( 'oak', 320, 0.001 ),
	instance( 'oak', 320, 0.01, [ 0, 0, 0, 1 ], [ 1, 1, 2 ] ),
	instance( 'unrelated', 20, 0.01 ),
] };

const plan = planOctahedralCanopyInstances( descriptor, set, [ 0, 0, 0 ] );
assert.equal( plan.length, 5, 'out-of-range and deterministically thinned instances are omitted' );
assert.deepEqual( plan.map( item => item.instanceIndex ), [ 0, 1, 2, 3, 7 ], 'the planner keeps visible canopy records in authored order' );
const treeHandoff = plan[ 0 ];
assert.equal( treeHandoff.groupId, 'trees' );
assert.equal( treeHandoff.variantIndex, 0 );
assert.ok( Math.abs( treeHandoff.nearWeight - 0.5 ) < 1e-12 && Math.abs( treeHandoff.farWeight - 0.5 ) < 1e-12, 'tree near/far weights split at the authored handoff center' );
assert.ok( Math.abs( treeHandoff.yaw - Math.PI / 2 ) < 1e-12, 'the signed quaternion resolves to the same canopy yaw' );
assert.ok( treeHandoff.localViewDirection.every( ( value, axis ) => Math.abs( value - [ 0, 0, - 1 ][ axis ] ) < 1e-12 ), 'frame lookup uses the camera direction in instance-local, unstretched space' );
assert.deepEqual( treeHandoff.frameIndices, [ 0, 1, 6 ], 'the shared plan selects the same three frames around the upper-hemisphere view direction' );
assert.ok( treeHandoff.frameWeights.every( ( value, index ) => Math.abs( value - [ 0.9019607843137255, 0.049019607843137254, 0.049019607843137254 ][ index ] ) < 1e-12 ), 'frame weights include the source shader’s upper-hemisphere y clamp' );
assert.equal( treeHandoff.dominantFrameIndex, 0 );
assert.equal( treeHandoff.blendFrames, true, 'the source blends three frames only inside its authored distance' );
assert.deepEqual( treeHandoff.billboard.center, [ 65, 0, 0 ], 'the shared far-card transform uses authored group bounds and placement' );
assert.equal( treeHandoff.billboard.halfWidth, 2, 'the far-card width uses the authored horizontal canopy bound' );
assert.equal( treeHandoff.billboard.halfHeight, 5, 'the far-card height uses the authored vertical canopy bound' );
assert.deepEqual( Array.from( treeHandoff.billboard.matrix ).slice( 12, 15 ), [ 65, 0, 0 ], 'the backend-neutral billboard matrix carries the world-space center' );
assert.equal( plan[ 1 ].variantIndex, 4, 'shrub variants use their own contiguous atlas range' );
assert.equal( plan[ 1 ].dominantFrameIndex, 30, 'shrub sampling uses the same projection grid and local view transform' );
assert.equal( plan[ 2 ].farWeight, 0, 'near-only instances do not schedule far-card geometry' );
assert.equal( plan[ 2 ].billboard, null, 'near-only instances skip far-card transform allocation' );
assert.equal( plan[ 3 ].farWeight, 0.5, 'tree fade is halfway through its authored 2,600–2,800 m fade' );
assert.equal( plan[ 3 ].blendFrames, false, 'far crowns use the dominant atlas frame outside the blend distance' );
assert.ok( Math.abs( plan[ 3 ].farScale - Math.SQRT2 ) < 1e-12, 'far crowns are density-compensated at the thinning endpoint' );
assert.equal( plan[ 4 ].farWeight, 1, 'the retained tree remains visible at the thinning endpoint' );
assert.ok( Math.abs( plan[ 4 ].billboard.halfWidth - 4 * Math.SQRT2 ) < 1e-12, 'far-card bounds account for the larger horizontal instance scale' );
const reserved = createOctahedralCanopyDrawBuffers( set.instances.length );
const packed = writeOctahedralCanopyDrawPlan( plan, reserved );
const f32 = values => values.map( Math.fround );
assert.equal( packed, reserved, 'backend adapters can reserve one stable interleaved buffer for all signed instances' );
assert.equal( packed.count, 4, 'only visible far cards enter the shared instanced draw' );
assert.deepEqual( Array.from( packed.matrices.slice( 0, 16 ) ), Array.from( treeHandoff.billboard.matrix ), 'the backend draw matrix is copied without renderer-specific conversion' );
assert.deepEqual( Array.from( packed.attributes.slice( 0, 4 ) ), f32( [ 0.01, 0, 5, 0 ] ), 'the shared attributes carry seed, atlas variant, bounds, and authored group index' );
assert.deepEqual( Array.from( packed.attributes.slice( 4, 8 ) ), f32( [ 1, 1, 1, Math.PI / 2 ] ), 'the shared attributes carry instance scale and yaw' );
assert.deepEqual( Array.from( packed.attributes.slice( 8, 12 ) ), [ 12.5, 0, 0, 0 ], 'the shared attributes carry authored per-instance wind height' );
assert.deepEqual( Array.from( packed.attributes.slice( 12, 16 ) ), [ 0, 1, 6, 1 ], 'the shared attributes carry the selected frames and blend flag' );
assert.deepEqual( Array.from( packed.attributes.slice( 16, 20 ) ), f32( [ ...treeHandoff.frameWeights, 0.5 ] ), 'the shared attributes carry frame and LOD weights' );
assert.ok( packed.attributes.length >= packed.count * 20, 'the five per-instance inputs share one reusable interleaved vertex buffer' );
const reusableMatrices = packed.matrices;
assert.equal( writeOctahedralCanopyDrawPlan( plan, packed ), packed, 'the caller-owned draw buffers can be reused each update' );
assert.equal( packed.matrices, reusableMatrices, 'draw planning retains sufficient matrix storage' );
assert.throws( () => planOctahedralCanopyInstances( descriptor, set, [ 0, NaN, 0 ] ), /three finite values/ );

console.log( 'shared octahedral canopy instance, LOD, fade, and thinning plan passes' );
