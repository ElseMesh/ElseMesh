import assert from 'node:assert/strict';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { updateWorldPackageLOD } from '../src/network/WorldPackage.js';

globalThis.innerHeight = 800;
const camera = new PerspectiveCamera( 60, 1, 0.1, 100 ); camera.updateMatrixWorld( true );
const header = new Uint8Array( 80 + 3 * 24 );
for ( let level = 0; level < 3; level ++ ) new DataView( header.buffer ).setBigUint64( 80 + level * 24 + 8, 64n, true );
const state = { progressiveAssets: new Map(), progressiveTextureTargets: new Map(), progressiveTextureJobs: new Map(), objectsByAsset: new Map(), progressiveController: new AbortController() };
const root = { userData: { worldPackage: state } };
for ( const [ id, distance ] of [ [ 'near', 4 ], [ 'far', 20 ], [ 'middle', 10 ] ] ) {
 const image = { imageIndices: [ 0 ], levelCount: 3 };
 state.progressiveAssets.set( id, { textures: [ image ] } );
 state.objectsByAsset.set( id, new Set( [ { transform: { position: [ 0, 0, -distance ] }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: 1 } } ] ) );
 state.progressiveTextureTargets.set( id, { sourceAssets: new Map( [ [ id, [ 0 ] ] ] ), baseWidth: 512, baseHeight: 512, levelCount: 3, headerAndIndex: header, levels: new Map( [ [ 2, {} ] ] ) } );
}
state.textureLODQueue = { limit: 1, active: 0, waiting: [], run() { this.active ++; return new Promise( () => {} ); } };
updateWorldPackageLOD( root, camera );
assert.deepEqual( [ ...state.progressiveTextureJobs.keys() ], [ 'near' ], 'only the highest-priority candidate enters the queue' );
updateWorldPackageLOD( root, camera );
assert.deepEqual( [ ...state.progressiveTextureJobs.keys() ], [ 'near' ], 'a busy queue does not accumulate stale requests' );
state.progressiveTextureJobs.delete( 'near' ); state.textureLODQueue.active = 0;
state.objectsByAsset.get( 'near' ).values().next().value.transform.position[ 2 ] = -40;
updateWorldPackageLOD( root, camera );
assert.deepEqual( [ ...state.progressiveTextureJobs.keys() ], [ 'middle' ], 'the next admission uses current visibility and priority' );
console.log( 'Texture jobs are admitted by current priority without FIFO backlog.' );
