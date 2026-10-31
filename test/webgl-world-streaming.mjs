import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';

function object( id, assetId, position, lods = [] ) {
	return {
		id, kind: 'asset-instance', assetId, lods, regionCell: true,
		transform: { position, yaw: 0 }, scale: [ 1, 1, 1 ],
		streamingBounds: { center: [ 0, 0, 0 ], radius: 1 },
	};
}

function model() {
	const scene = new THREE.Scene();
	scene.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshStandardMaterial() ) );
	return { scene };
}

const sharedAsset = 'sha256:shared';
const farAsset = 'sha256:far';
const farLOD = 'sha256:far-lod';
const near = object( 'near', sharedAsset, [ 0, 0, -10 ] );
const far = object( 'far', farAsset, [ 100, 0, 0 ], [ { assetId: farLOD } ] );
const farShared = object( 'far-shared', sharedAsset, [ 110, 0, 0 ] );
const scene = new THREE.Scene();
const roots = new Map();
for ( const item of [ near, far, farShared ] ) {
	const root = new THREE.Group();
	root.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshStandardMaterial() ) );
	scene.add( root );
	roots.set( item.id, root );
}
const farModel = model(), sharedModel = model();
let disposedFarGeometry = false, disposedSharedGeometry = false;
farModel.scene.children[ 0 ].geometry.addEventListener( 'dispose', () => { disposedFarGeometry = true; } );
sharedModel.scene.children[ 0 ].geometry.addEventListener( 'dispose', () => { disposedSharedGeometry = true; } );
const releasedAssets = [];
let unexpectedPreload = false;
const fallback = Object.create( WebGLFallback.prototype );
Object.assign( fallback, {
	THREE,
	camera: new THREE.PerspectiveCamera( 55, 1, 0.1, 500 ),
	scene,
	connector: {
		localOnly: true, worldId: 'test-world', cellSizeMeters: 8, collisionLoadLatencyMs: 2000,
		manifest: { assets: [], objects: [ near, far, farShared ] },
		collisionObjectIDsAlongPath: () => [],
		preload: async () => { unexpectedPreload = true; return new Map(); },
		releaseAsset: id => releasedAssets.push( id ),
	},
	player: { position: new THREE.Vector3(), yaw: 0, velocity: new THREE.Vector3(), worldMovement: { walkSpeed: 3, sprintSpeed: 6 } },
	input: { moveAxes: () => ( { x: 0, y: 0 } ), down: () => false },
	localLoadedObjectIDs: new Set( [ 'near', 'far', 'far-shared' ] ),
	hostedObjectRoots: roots,
	hostedModelCache: new Map( [ [ sharedAsset, sharedModel ], [ farAsset, farModel ] ] ),
	hostedSharedMaterials: new Set(),
	worldLODs: new Map(),
	hostedWorldStreamingAt: -Infinity,
} );
fallback.camera.lookAt( 0, 0, -1 );
fallback.camera.updateProjectionMatrix();
fallback.camera.updateMatrixWorld( true );

fallback._updateHostedWorldStreaming();

assert.equal( fallback.localLoadedObjectIDs.has( 'far' ), false, 'distant region object leaves the resident set' );
assert.equal( fallback.localLoadedObjectIDs.has( 'far-shared' ), false, 'distant shared instance leaves the resident set' );
assert.equal( scene.children.includes( roots.get( 'far' ) ), false, 'distant visual root is removed from the scene' );
assert.equal( scene.children.includes( roots.get( 'near' ) ), true, 'nearby visual root remains loaded' );
assert.equal( fallback.hostedModelCache.has( farAsset ), false, 'unreferenced parsed model leaves the GPU-side model cache' );
assert.equal( fallback.hostedModelCache.has( sharedAsset ), true, 'model used by a nearby object remains cached' );
assert.equal( disposedFarGeometry, true, 'unreferenced model geometry is disposed' );
assert.equal( disposedSharedGeometry, false, 'shared model geometry remains live' );
assert.deepEqual( releasedAssets.sort(), [ farAsset, farLOD ].sort(), 'only unreferenced browser asset bytes are released' );
assert.equal( unexpectedPreload, false, 'the retained camera view does not trigger redundant asset work' );
console.log( 'ok WebGL hosted regions evict distant assets without breaking shared instances' );
