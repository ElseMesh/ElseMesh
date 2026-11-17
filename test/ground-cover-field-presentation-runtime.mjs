import assert from 'node:assert/strict';
import { GroundCoverFieldPresentationRuntime } from '../src/engine/render/GroundCoverFieldPresentationRuntime.js';
import { GroundCoverFieldRuntime } from '../src/engine/render/GroundCoverFieldRuntime.js';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';

const densityAssetId = `sha256:${'a'.repeat( 64 )}`;
const modelAssetId = `sha256:${'b'.repeat( 64 )}`;
const componentAssets = [ { assetId: densityAssetId, kind: 'grass-density/1' }, { assetId: modelAssetId, kind: 'glb' } ];
const data = {
	densityAssetId, seed: 19, cellSize: 8, pointsPerCell: 4, placementAlgorithm: 'blue-noise/1',
	distanceBands: [ { maxDistance: 24, cellCapacity: 32 } ],
	species: [ {
		id: 'meadow', densityExpression: { op: 'channel', index: 1 }, densityThreshold: 0,
		modelAssetIds: [ modelAssetId ], bounds: { center: [ 0, 0.5, 0 ], radius: 0.75 }, geometryMirrorX: false,
		lodMetric: 'scaled-distance', lodThresholds: [], lodFadeFraction: 0,
		drawMaxDistance: 24, drawFadeStartDistance: 20, scaleRange: [ 0.8, 1.2 ],
		castsShadow: true, shadowMaxDistance: 8,
	} ],
};
const terrain = { res: 32, size: 32, origin: -16, texel: 1, heights: new Float32Array( 1024 ), heightAt: () => 0 };
const densityData = new Uint8Array( 32 * 32 * 4 );
for ( let i = 1; i < densityData.length; i += 4 ) densityData[ i ] = 255;
const field = new GroundCoverFieldRuntime( { data, componentAssets, terrain, density: { res: 32, size: 32, origin: -16, data: densityData } } );
const root = {
	children: [],
	add( mesh ) { mesh.parent = this; this.children.push( mesh ); },
	remove( mesh ) { mesh.parent = null; this.children.splice( this.children.indexOf( mesh ), 1 ); },
};
const source = {};
const camera = new PerspectiveCamera( 72, 1, 0.1, 100 );
camera.position.set( 0, 2, 5 );
camera.lookAt( 0, 0, - 4 );
camera.updateMatrixWorld( true );
let modelLoads = 0, sourceDisposals = 0, drawDisposals = 0;
const runtime = new GroundCoverFieldPresentationRuntime( field, {
	root,
	loadModel: async () => { modelLoads ++; return source; },
	disposeSource: value => { assert.equal( value, source ); sourceDisposals ++; },
	createDraws: ( value, capacity, shadow ) => {
		assert.equal( value, source );
		const mesh = { count: 0, parent: null };
		return [ {
			mesh,
			matrixAttribute: { array: new Float32Array( capacity * 16 ), needsUpdate: false },
			fadeAttribute: { array: new Float32Array( capacity * 4 ), needsUpdate: false },
			dispose() { drawDisposals ++; },
			shadow,
		} ];
	},
} );

runtime.update( 1 / 60, camera );
assert.equal( runtime.isCoarseReadyForView(), false, 'view readiness waits for model resources' );
await new Promise( resolve => setTimeout( resolve, 0 ) );
runtime.update( 1 / 60, camera );
assert.equal( runtime.isCoarseReadyForView(), true, 'view readiness opens when visible and shadow batches have draws' );
assert.equal( modelLoads, 1, 'visible and shadow batches share one parsed model source' );
assert.equal( root.children.length, 2, 'visible and independent shadow batches create separate backend draws' );
assert.ok( root.children.every( mesh => mesh.count > 0 ), 'packed instance counts upload into both draw roles' );

const farCamera = new PerspectiveCamera( 72, 1, 0.1, 100 );
farCamera.position.set( 1000, 2, 1000 );
farCamera.lookAt( 1000, 0, 999 );
farCamera.updateMatrixWorld( true );
runtime.update( 1 / 60, farCamera );
assert.ok( root.children.every( mesh => mesh.count === 0 ), 'leaving the field clears both visible and shadow draws' );
runtime.dispose();
assert.equal( root.children.length, 0, 'dispose removes both backend draw roles' );
assert.equal( sourceDisposals, 1, 'the shared model source is disposed once' );
assert.equal( drawDisposals, 2, 'all visible and shadow draw resources are disposed' );

console.log( 'ground-cover presentation runtime: lazy model residency, shadow batches, uploads, and disposal passed' );
