import assert from 'node:assert/strict';
import { Colliders } from '../src/world/Colliders.js';
import { Vector3 } from '../src/engine/math/Vector3.js';
import { Group } from '../src/engine/scene/Group.js';
import { loadWorldPackage, registerWorldPackageCollisions, unregisterWorldPackageCollisions } from '../src/network/WorldPackage.js';
import { validateWorldSource } from '../src/network/WorldSource.js';
import { validateWorldObjects } from '../src/network/WorldConnector.js';

const collision = { shape: 'box', enabled: true, center: [ 1, 1, 1 ], halfExtents: [ 1, 2, 3 ], walkable: true, solid: true };
const object = {
	id: 'tw-object:platform', kind: 'asset-instance', label: 'Platform', assetId: `sha256:${'a'.repeat( 64 )}`,
	transform: { position: [ 10, 20, 30 ], yaw: Math.PI / 2 }, scale: [ 2, 3, 4 ], collision,
};
const source = {
	protocol: 'tidewater.world-source/2', worldId: 'tw-world:test', title: 'Collision', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '',
	rules: { gravity: 1, maxVisitors: 128, spawnRadius: 8, avatarComplexity: 1000, physicsProfile: 'tidewater-default' }, objects: [ object ], portals: [], updatedAt: '2026-10-01T00:00:00Z',
};
assert.doesNotThrow( () => validateWorldSource( source ), 'enabled box collision with bounded dimensions is valid' );
assert.throws( () => validateWorldSource( { ...source, objects: [ { ...object, collision: { ...collision, halfExtents: [ 1, 0, 3 ] } } ] } ), /bounded box, compound, or heightfield data/, 'zero collision extents are rejected' );

const root = { children: [ { userData: { worldObjectId: object.id } } ], userData: { worldPackage: {
	connector: { manifest: { objects: [ object ] } }, loadedObjects: new Set( [ object.id ] ),
} } };
const colliders = new Colliders();
registerWorldPackageCollisions( root, colliders );
assert.equal( colliders.boxes.length, 1, 'active package registers its authored collider' );
const box = colliders.boxes[ 0 ];
assert.ok( Math.abs( box.center.x - 14 ) < 1e-9 && Math.abs( box.center.y - 23 ) < 1e-9 && Math.abs( box.center.z - 28 ) < 1e-9, 'local collider center follows instance scale, yaw, and translation' );
assert.deepEqual( [ box.half.x, box.half.y, box.half.z ], [ 2, 6, 12 ], 'half extents follow instance scale' );
assert.equal( box.walkable, true );
assert.equal( box.solid, true );
registerWorldPackageCollisions( root, colliders );
assert.equal( colliders.boxes.length, 1, 'streaming registration is idempotent' );
unregisterWorldPackageCollisions( root, colliders );
assert.equal( colliders.boxes.length, 0, 'world handoff removes old-world colliders' );

const compoundObject = {
	...object,
	id: 'tw-object:compound-platform',
	collision: { shape: 'compound', enabled: true, boxes: [
		{ center: [ 1, 1, 1 ], halfExtents: [ 1, 2, 3 ], yaw: 0.25, walkable: true, solid: true },
		{ center: [ - 1, 0, 0 ], halfExtents: [ 0.5, 1, 0.5 ], yaw: 0, walkable: false, solid: true },
	] },
};
assert.doesNotThrow( () => validateWorldSource( { ...source, objects: [ compoundObject ] } ), 'bounded compound collision is valid' );
assert.doesNotThrow( () => validateWorldObjects( [ compoundObject ] ), 'browser accepts the validated compound collision used by exported world packages' );
assert.throws( () => validateWorldSource( { ...source, objects: [ { ...compoundObject, collision: { ...compoundObject.collision, boxes: [] } } ] } ), /bounded box, compound, or heightfield data/, 'empty compound collision is rejected' );
assert.throws( () => validateWorldObjects( [ { ...compoundObject, collision: { ...compoundObject.collision, boxes: [] } } ] ), /invalid collision bounds/, 'browser rejects empty compound collision data' );
const compoundRoot = { children: [ { userData: { worldObjectId: compoundObject.id } } ], userData: { worldPackage: {
	connector: { manifest: { objects: [ compoundObject ] } }, loadedObjects: new Set( [ compoundObject.id ] ),
} } };
const compoundColliders = new Colliders();
registerWorldPackageCollisions( compoundRoot, compoundColliders );
assert.equal( compoundColliders.boxes.length, 2, 'compound package registers each box' );
assert.ok( Math.abs( compoundColliders.boxes[ 0 ].center.x - 14 ) < 1e-9 && Math.abs( compoundColliders.boxes[ 0 ].center.z - 28 ) < 1e-9, 'compound box centers follow object scale, yaw, and translation' );
assert.ok( Math.abs( compoundColliders.boxes[ 0 ].rotY - ( Math.PI / 2 + 0.25 ) ) < 1e-9, 'compound box yaw composes with object yaw' );
assert.equal( compoundColliders.boxes[ 0 ].walkable, true );
assert.equal( compoundColliders.boxes[ 1 ].walkable, false );
unregisterWorldPackageCollisions( compoundRoot, compoundColliders );
assert.equal( compoundColliders.boxes.length, 0, 'compound colliders are all removed during world handoff' );

const heights = new Float32Array( [
	0, 0, 0, 1, 1, 0, 2, 2, 0,
	0, 0, 1, 1, 2, 1, 2, 4, 1,
	0, 0, 2, 1, 3, 2, 2, 6, 2,
] );
const field = colliders.addHeightfield( heights, 3, 3, { position: new Vector3( 10, 2, 20 ), scale: new Vector3( 2, 3, 2 ), yaw: Math.PI / 2 } );
assert.ok( Math.abs( colliders.groundHeightAt( 12, 18, 100 ) - 8 ) < 1e-6, 'heightfield applies scale, yaw, translation, and vertex height' );
assert.ok( Math.abs( colliders.groundHeightAt( 11, 19, 100 ) - 4.25 ) < 1e-6, 'heightfield interpolates between samples' );
assert.equal( colliders.removeHeightfield( field ), true );
assert.equal( colliders.groundHeightAt( 12, 18, 100 ), - Infinity, 'removed heightfields no longer provide ground' );

function bodySetupGLB( extras ) {
	const document = { asset: { version: '2.0' }, nodes: [ { extras } ], scenes: [ { nodes: [ 0 ] } ], scene: 0 };
	const encoded = new TextEncoder().encode( JSON.stringify( document ) );
	const paddedLength = Math.ceil( encoded.length / 4 ) * 4;
	const buffer = new ArrayBuffer( 20 + paddedLength );
	const view = new DataView( buffer );
	view.setUint32( 0, 0x46546c67, true ); view.setUint32( 4, 2, true ); view.setUint32( 8, buffer.byteLength, true );
	view.setUint32( 12, paddedLength, true ); view.setUint32( 16, 0x4e4f534a, true );
	new Uint8Array( buffer, 20, paddedLength ).fill( 32 );
	new Uint8Array( buffer, 20, encoded.length ).set( encoded );
	return buffer;
}
const bodySetupMetadata = {
	source: 'Unreal UBodySetup.AggGeom', coordinateSystem: 'elsemesh-y-up-meters/1',
	boxes: [ { center: [ 0, 0, 0 ], halfExtents: [ 3, 0.1, 3 ], rotation: [ 0, 0, 0, 1 ] } ],
	spheres: [ { center: [ 5, 1, 0 ], radius: 0.5 } ],
	capsules: [ { center: [ - 5, 1, 0 ], radius: 0.25, length: 1, rotation: [ 0, 0, 0, 1 ] } ],
	taperedCapsules: [],
	convexes: [ { vertices: [ [ 6, 0, 0 ], [ 7, 0, 0 ], [ 6, 1, 0 ], [ 6, 0, 1 ] ], indices: [ 0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3 ] } ],
};
const bridgedObject = { id: 'tw-object:bridged', kind: 'asset-instance', assetId: `sha256:${'b'.repeat( 64 )}`, transform: { position: [ 10, 2, 30 ], yaw: 0 }, collision: { enabled: false, shape: 'none' } };
const bridgedConnector = { worldId: 'tw-world:bridge-collision', manifest: { objects: [ bridgedObject ], portals: [] } };
const bridgedRoot = await loadWorldPackage( bridgedConnector, { assets: new Map( [ [ bridgedObject.assetId, bodySetupGLB( { elsemeshCollision: bodySetupMetadata } ) ] ] ) } );
bridgedRoot.children[ 0 ].children[ 0 ].position.y = 1;
const bridgedColliders = new Colliders();
registerWorldPackageCollisions( bridgedRoot, bridgedColliders );
assert.equal( bridgedColliders.boxes.length, 2, 'bridge registers BodySetup floor boxes and convex bounds from GLB node extras' );
assert.equal( bridgedColliders.cylinders.length, 2, 'bridge maps BodySetup spheres and capsules into the current vertical-cylinder collider' );
assert.ok( Math.abs( bridgedColliders.groundHeightAt( 10, 30, 10 ) - 3.1 ) < 1e-6, 'bridge floor collider is transformed with the GLB node and object placement' );
assert.equal( bridgedColliders.boxes[ 0 ].walkable, true, 'horizontal BodySetup box is walkable' );
registerWorldPackageCollisions( bridgedRoot, bridgedColliders );
assert.equal( bridgedColliders.boxes.length, 2, 'streaming registration does not duplicate embedded BodySetup colliders' );
unregisterWorldPackageCollisions( bridgedRoot, bridgedColliders );
assert.equal( bridgedColliders.boxes.length, 0, 'world handoff removes embedded box and convex-bound colliders' );
assert.equal( bridgedColliders.cylinders.length, 0, 'world handoff removes embedded sphere and capsule colliders' );
const invalidCollisionRoot = new Group();
const invalidCollisionInstance = new Group();
invalidCollisionInstance.userData.worldObjectId = 'tw-object:invalid-body-setup';
const invalidCollisionNode = new Group();
invalidCollisionNode.userData.elsemeshCollision = {
	source: 'Unreal UBodySetup.AggGeom', coordinateSystem: 'elsemesh-y-up-meters/1',
	boxes: [ { center: [ 0, 0, 0 ], halfExtents: [ 1, 0.1, 1 ], rotation: [ 0, 0, 0, 1 ] } ],
	spheres: [ { center: [ 0, 0, 0 ], radius: - 1 } ], capsules: [], taperedCapsules: [], convexes: [],
};
invalidCollisionInstance.add( invalidCollisionNode );
invalidCollisionRoot.add( invalidCollisionInstance );
invalidCollisionRoot.userData.worldPackage = {
	connector: { manifest: { objects: [ { id: invalidCollisionInstance.userData.worldObjectId, collision: { enabled: false } } ] } },
	loadedObjects: new Set( [ invalidCollisionInstance.userData.worldObjectId ] ),
};
assert.throws( () => registerWorldPackageCollisions( invalidCollisionRoot, bridgedColliders ), /invalid embedded collision sphere/, 'malformed BodySetup records fail closed' );
assert.equal( bridgedColliders.boxes.length + bridgedColliders.cylinders.length, 0, 'a rejected BodySetup does not leave partially registered colliders' );
console.log( 'ok   authored world collisions validate, transform, register, and clean up' );
