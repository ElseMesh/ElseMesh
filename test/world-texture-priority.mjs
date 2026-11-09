import assert from 'node:assert/strict';
import { PerspectiveCamera } from '../src/engine/scene/Camera.js';
import { invalidateWorldPackageTextureProjection, registerStaticModelTextureDemand, setWorldPackageProgressiveAsset, updateWorldPackageLOD } from '../src/network/WorldPackage.js';

globalThis.innerHeight = 800;
const camera = new PerspectiveCamera( 60, 1, 0.1, 100 ); camera.updateMatrixWorld( true );
const header = new Uint8Array( 80 + 3 * 24 );
for ( let level = 0; level < 3; level ++ ) new DataView( header.buffer ).setBigUint64( 80 + level * 24 + 8, 64n, true );
const state = { progressiveAssets: new Map(), progressiveTextureTargets: new Map(), progressiveTextureJobs: new Map(), objectsByAsset: new Map(), progressiveController: new AbortController() };
const root = { userData: { worldPackage: state } };
let objectLODUpdates = 0;
state.lodControllers = new Map( [ [ 'test', { update() { objectLODUpdates ++; } } ] ] );
const staticModelRuntime = {
	disposed: true,
	viewRevision: 0,
	document: { models: [ { lods: [ { assetId: 'near' } ] } ] },
	plannerRevisionListeners: new Set(),
	addPlannerRevisionListener( listener ) { this.plannerRevisionListeners.add( listener ); return () => this.plannerRevisionListeners.delete( listener ); },
	signalPlannerRevision() { this.viewRevision ++; for ( const listener of this.plannerRevisionListeners ) listener( this.viewRevision ); },
};
const unregisterStaticModelTextureDemand = registerStaticModelTextureDemand( root, staticModelRuntime );
for ( const [ id, distance ] of [ [ 'near', 4 ], [ 'far', 20 ], [ 'middle', 10 ] ] ) {
 const image = { imageIndices: [ 0 ], levelCount: 3 };
 setWorldPackageProgressiveAsset( root, id, { textures: [ image ] } );
 const object = { transform: { position: [ 0, 0, -distance ] }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: id === 'far' ? 6 : 1 } };
 state.objectsByAsset.set( id, new Set( [ object ] ) );
 state.progressiveTextureTargets.set( id, { sourceAssets: new Map( [ [ id, [ 0 ] ] ] ), baseWidth: 512, baseHeight: 512, levelCount: 3, headerAndIndex: header, levels: new Map( [ [ 2, {} ] ] ) } );
}
const middleTarget = state.progressiveTextureTargets.get( 'middle' );
const middleSources = middleTarget.sourceAssets;
let middleSourceReads = 0;
Object.defineProperty( middleTarget, 'sourceAssets', { get() { middleSourceReads ++; return middleSources; } } );
const pendingJobs = [];
state.textureLODQueue = { limit: 1, active: 0, waiting: [], run() { this.active ++; return new Promise( resolve => pendingJobs.push( () => { this.active --; resolve(); } ) ); } };
state.coarseCoverageReady = false;
updateWorldPackageLOD( root, camera );
assert.equal( objectLODUpdates, 0, 'mesh LOD scheduling waits for current-view coarse coverage' );
assert.equal( state.progressiveTextureJobs.size, 0, 'texture mip scheduling waits for the same coarse coverage barrier' );
state.coarseCoverageReady = true;
updateWorldPackageLOD( root, camera );
assert.equal( objectLODUpdates, 1 );
assert.deepEqual( [ ...state.progressiveTextureJobs.keys() ], [ 'near' ], 'near texture refinement wins even when the farther candidate has a much larger bound' );
assert.equal( state.textureLODScheduleDirty, false, 'the stable view is marked scheduled after planning' );
const nearObject = state.objectsByAsset.get( 'near' ).values().next().value;
const stableProjection = state.textureObjectProjectionCache.get( nearObject );
const stableAssetFraction = state.textureAssetScreenFractions.get( 'near' );
const readsAfterPlanning = middleSourceReads;
updateWorldPackageLOD( root, camera );
assert.deepEqual( [ ...state.progressiveTextureJobs.keys() ], [ 'near' ], 'a busy queue does not accumulate stale requests' );
assert.equal( middleSourceReads, readsAfterPlanning, 'an unchanged view skips the candidate scan' );
assert.strictEqual( state.textureObjectProjectionCache.get( nearObject ), stableProjection, 'a stable camera and object reuse the projected bounds' );
assert.strictEqual( state.textureAssetScreenFractions.get( 'near' ), stableAssetFraction, 'a stable camera reuses the per-asset projected fraction' );
setWorldPackageProgressiveAsset( root, 'far', { textures: [ { imageIndices: [ 0 ], levelCount: 3 } ] } );
updateWorldPackageLOD( root, camera );
assert.ok( middleSourceReads > readsAfterPlanning, 'a newly available progressive asset replans the schedule' );
pendingJobs.shift()();
await new Promise( resolve => setImmediate( resolve ) );
assert.equal( state.textureLODScheduleDirty, true, 'a completed mip job wakes the scheduler' );
assert.equal( state.progressiveTextureJobs.has( 'near' ), false );
nearObject.transform.position[ 2 ] = -40;
invalidateWorldPackageTextureProjection( root, [ 'near' ] );
assert.equal( state.textureLODScheduleDirty, true, 'object invalidation marks the texture schedule dirty' );
updateWorldPackageLOD( root, camera );
assert.deepEqual( [ ...state.progressiveTextureJobs.keys() ], [ 'middle' ], 'the next admission uses current visibility and priority' );
assert.notStrictEqual( state.textureObjectProjectionCache.get( nearObject ), stableProjection, 'moving an object refreshes its cached projected bounds' );
assert.notStrictEqual( state.textureAssetScreenFractions.get( 'near' ), stableAssetFraction, 'object invalidation refreshes the per-asset projected fraction' );
const currentAssetFraction = state.textureAssetScreenFractions.get( 'near' );
staticModelRuntime.signalPlannerRevision();
assert.equal( state.textureLODScheduleDirty, true, 'a planner-only view revision marks the texture schedule dirty' );
updateWorldPackageLOD( root, camera );
assert.notStrictEqual( state.textureAssetScreenFractions.get( 'near' ), currentAssetFraction, 'a static-model planner revision refreshes the per-asset projected fraction' );
const stableViewRevision = state.textureProjectionRevision;
camera.position.set( 0.1, 0, 0 ); camera.lookAt( 0, 0, -1 ); camera.updateMatrixWorld( true );
updateWorldPackageLOD( root, camera );
assert.ok( state.textureProjectionRevision > stableViewRevision, 'camera movement invalidates projected bounds for the world' );
const matrixStableRevision = state.textureProjectionRevision;
camera.fov = 65;
updateWorldPackageLOD( root, camera );
assert.ok( state.textureProjectionRevision > matrixStableRevision, 'effective FOV changes invalidate the schedule even before its projection matrix is updated' );
pendingJobs.shift()();
await new Promise( resolve => setImmediate( resolve ) );

const biasedTarget = state.progressiveTextureTargets.get( 'near' );
state.objectsByAsset.get( 'near' ).values().next().value.transform.position[ 2 ] = -4;
invalidateWorldPackageTextureProjection( root, [ 'near' ] );
updateWorldPackageLOD( root, camera, 0 );
const distanceLOD = biasedTarget.desiredLevel;
pendingJobs.shift()();
await new Promise( resolve => setImmediate( resolve ) );
updateWorldPackageLOD( root, camera, 2 );
assert.ok( biasedTarget.desiredLevel > distanceLOD, 'workload bias selects a coarser texture mip' );
if ( pendingJobs.length ) { pendingJobs.shift()(); await new Promise( resolve => setImmediate( resolve ) ); }
unregisterStaticModelTextureDemand();

const overlappingBoundsState = { progressiveAssets: new Map(), progressiveTextureTargets: new Map(), progressiveTextureJobs: new Map(), objectsByAsset: new Map(), progressiveController: new AbortController() };
const overlappingBoundsRoot = { userData: { worldPackage: overlappingBoundsState } };
const overlappingBoundsCamera = new PerspectiveCamera( 60, 1, 0.1, 100 ); overlappingBoundsCamera.updateMatrixWorld( true );
for ( const [ id, distance ] of [ [ 'far-bound', 18 ], [ 'near-bound', 4 ] ] ) {
	setWorldPackageProgressiveAsset( overlappingBoundsRoot, id, { textures: [ { imageIndices: [ 0 ], levelCount: 3 } ] } );
	overlappingBoundsState.objectsByAsset.set( id, new Set( [ { transform: { position: [ 0, 0, - distance ] }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: distance + 1 } } ] ) );
	overlappingBoundsState.progressiveTextureTargets.set( id, { sourceAssets: new Map( [ [ id, [ 0 ] ] ] ), baseWidth: 512, baseHeight: 512, levelCount: 3, headerAndIndex: header, levels: new Map( [ [ 2, {} ] ] ) } );
}
overlappingBoundsState.textureLODQueue = { limit: 1, active: 0, waiting: [], run() { this.active ++; return new Promise( () => {} ); } };
updateWorldPackageLOD( { userData: { worldPackage: overlappingBoundsState } }, overlappingBoundsCamera );
assert.deepEqual( [ ...overlappingBoundsState.progressiveTextureJobs.keys() ], [ 'near-bound' ], 'center distance breaks zero-surface-distance ties for texture mips before projected size' );

// A failed high-priority request must not starve other visible textures.
const retryState = { progressiveAssets: new Map(), progressiveTextureTargets: new Map(), progressiveTextureJobs: new Map(), objectsByAsset: new Map(), progressiveController: new AbortController() };
const retryRoot = { userData: { worldPackage: retryState } };
for ( const [ id, distance ] of [ [ 'near', 4 ], [ 'far', 20 ] ] ) {
 setWorldPackageProgressiveAsset( retryRoot, id, { textures: [ { imageIndices: [ 0 ], levelCount: 3 } ] } );
 retryState.objectsByAsset.set( id, new Set( [ { transform: { position: [ 0, 0, -distance ] }, scale: [ 1, 1, 1 ], streamingBounds: { center: [ 0, 0, 0 ], radius: id === 'far' ? 6 : 1 } } ] ) );
 retryState.progressiveTextureTargets.set( id, { sourceAssets: new Map( [ [ id, [ 0 ] ] ] ), baseWidth: 512, baseHeight: 512, levelCount: 3, headerAndIndex: header, levels: new Map( [ [ 2, {} ] ] ) } );
}
const retryJobs = [];
retryState.textureLODQueue = { limit: 1, active: 0, waiting: [], run() { this.active ++; return new Promise( ( resolve, reject ) => retryJobs.push( { resolve: () => { this.active --; resolve(); }, reject: error => { this.active --; reject( error ); } } ) ); } };
updateWorldPackageLOD( retryRoot, camera );
assert.deepEqual( [ ...retryState.progressiveTextureJobs.keys() ], [ 'near' ] );
const savedWarn = console.warn;
try {
 console.warn = () => {};
 retryJobs.shift().reject( new Error( 'simulated mip failure' ) );
 await new Promise( resolve => setImmediate( resolve ) );
} finally { console.warn = savedWarn; }
const retryAt = retryState.progressiveTextureTargets.get( 'near' ).retryAfter;
assert.ok( retryAt > performance.now(), 'failure sets a future retry time' );
updateWorldPackageLOD( retryRoot, camera );
assert.deepEqual( [ ...retryState.progressiveTextureJobs.keys() ], [ 'far' ], 'another visible texture loads during the retry delay' );
retryJobs.shift().resolve();
await new Promise( resolve => setImmediate( resolve ) );
retryState.progressiveTextureTargets.delete( 'far' );
updateWorldPackageLOD( retryRoot, camera, 0, retryAt - 1 );
assert.equal( retryJobs.length, 0, 'failed texture waits until its retry deadline' );
updateWorldPackageLOD( retryRoot, camera, 0, retryAt + 1 );
assert.deepEqual( [ ...retryState.progressiveTextureJobs.keys() ], [ 'near' ], 'retry deadline wakes a stationary view' );
retryJobs.shift().resolve();
await new Promise( resolve => setImmediate( resolve ) );
console.log( 'Texture mip detail follows workload bias; jobs use current priority without FIFO backlog.' );
