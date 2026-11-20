import assert from 'node:assert/strict';
import { OctahedralCanopyPresentationRuntime } from '../src/engine/render/OctahedralCanopyPresentationRuntime.js';

const descriptor = {
	variantGroups: [ {
		id: 'canopy', modelIds: [ 'oak' ], atlasVariantRange: { start: 0, end: 2 },
		variantSelection: { source: 'instance-material-data', index: 0, method: 'fractional-bin/1', multiplier: 7.77 },
		bounds: { center: [ 0, 1, 0 ], radius: 3, horizontalRadius: 2, halfHeight: 3 },
		lod: { nearDistance: 10, maxDistance: 100, farFade: null },
	} ],
	projection: { framesPerSide: 2 }, frameBlendDistance: 50, lodBandFraction: 0.1,
	thinning: { startDistance: 20, endDistance: 30, removeFraction: 0.5, seedMultiplier: 1, scaleCompensation: 'inverse-square-root-retained-density/1' },
};
const instanceSet = { instances: [ { model: 'oak', position: [ 15, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ], materialData: [ 0.2 ] } ] };
const updates = [], disposed = [];
const runtime = new OctahedralCanopyPresentationRuntime( descriptor, instanceSet, {
	applyDrawPlan: ( plan, buffers ) => updates.push( { plan, buffers } ),
	dispose: () => disposed.push( true ),
} );

assert.equal( runtime.update( 0, { position: { x: 0, y: 0, z: 0 } } ), true );
assert.equal( updates.length, 1 );
assert.equal( updates[ 0 ].buffers.count, 1 );
const matrices = updates[ 0 ].buffers.matrices;
assert.equal( runtime.update( 0, { position: { x: 0, y: 0, z: 0 } } ), false, 'stationary cameras do not rebuild shared instance buffers' );
assert.equal( updates.length, 1 );
assert.equal( runtime.update( 0, { position: { x: 1, y: 0, z: 0 } } ), true, 'both adapters receive an updated draw plan after camera movement' );
assert.equal( updates.length, 2 );
assert.equal( updates[ 1 ].buffers.matrices, matrices, 'camera updates reuse the same typed-array storage' );
assert.throws( () => runtime.update( 0, {} ), /finite camera position/ );
runtime.dispose();
runtime.dispose();
assert.deepEqual( disposed, [ true ], 'backend resources are disposed once' );
assert.equal( runtime.update( 0, { position: { x: 2, y: 0, z: 0 } } ), false );

console.log( 'shared octahedral canopy runtime updates and disposes backend draw plans' );
