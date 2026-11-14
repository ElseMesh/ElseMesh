import assert from 'node:assert/strict';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { registerStaticModelTextureDemand, staticModelTextureViewDemand } from '../src/network/WorldPackage.js';

const root = { userData: { worldPackage: {} } };
const camera = new PerspectiveCamera( 60, 1, 0.1, 100 );
camera.updateMatrixWorld( true );
const runtime = {
 document: { models: [ { bounds: { center: [ 0, 0, 0 ], radius: 1 }, lods: [ { assetId: 'coarse' }, { assetId: 'fine' } ] } ], instances: [ { position: [ 0, 0, -5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] }, { position: [ 100, 0, -5 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ] },
	planner: { _groupsByModel: [ [ { count: 1, indices: [ 0 ] }, { count: 1, indices: [ 1 ] } ] ] }, disposed: false, viewRevision: 0,
};
const unregister = registerStaticModelTextureDemand( root, runtime );
const demands = root.userData.worldPackage.staticModelTextureDemand;
const coarseDemand = [ ...demands.get( 'coarse' ) ][ 0 ];
const visibleFraction = staticModelTextureViewDemand( coarseDemand, camera ).fraction;
assert.ok( visibleFraction > 0 );
assert.equal( staticModelTextureViewDemand( [ ...demands.get( 'fine' ) ][ 0 ], camera ).fraction, null );
runtime.planner._groupsByModel[ 0 ][ 0 ].count = 0;
assert.equal( staticModelTextureViewDemand( coarseDemand, camera ).fraction, visibleFraction, 'a stable view reuses its projected texture visibility' );
runtime.viewRevision ++;
assert.equal( staticModelTextureViewDemand( coarseDemand, camera ).fraction, null, 'a changed planner view invalidates the cached texture visibility' );
unregister();
assert.equal( demands.size, 0 );
console.log( 'Static model texture demand follows active visible instances and unregisters.' );
