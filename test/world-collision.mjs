import assert from 'node:assert/strict';
import { Colliders } from '../src/world/Colliders.js';
import { Vector3 } from '../src/engine/math/Vector3.js';
import { Group } from '../src/engine/scene/Group.js';
import { loadWorldPackage, registerWorldPackageCollisionPayload, registerWorldPackageCollisions, unregisterWorldPackageCollisions } from '../src/network/WorldPackage.js';
import { appendWorldPackageAssets } from '../src/network/WorldPackage.js';
import { validateWorldSource } from '../src/network/WorldSource.js';
import { validateWorldObjects } from '../src/network/WorldConnector.js';

const collision = { shape: 'box', enabled: true, center: [ 1, 1, 1 ], halfExtents: [ 1, 2, 3 ], walkable: true, solid: true };
const object = {
	id: 'elsemesh-object:platform', kind: 'asset-instance', label: 'Platform', assetId: `sha256:${'a'.repeat( 64 )}`,
	transform: { position: [ 10, 20, 30 ], yaw: Math.PI / 2 }, scale: [ 2, 3, 4 ], collision,
};
const source = {
	protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:test', title: 'Collision', coordinateSystem: 'right-handed-y-up-meters', styleGuide: '',
	rules: { gravity: 1, maxVisitors: 128, spawnRadius: 8, avatarComplexity: 1000, physicsProfile: 'elsemesh-default' }, objects: [ object ], portals: [], updatedAt: '2026-10-01T00:00:00Z',
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

const filteredObject = { ...object, id: 'elsemesh-object:filtered-platform' };
const filteredRoot = {
	children: [ object, filteredObject ].map( item => ( { userData: { worldObjectId: item.id } } ) ),
	userData: { worldPackage: { connector: { manifest: { objects: [ object, filteredObject ] } }, loadedObjects: new Set( [ object.id, filteredObject.id ] ) } },
};
const filteredColliders = new Colliders();
registerWorldPackageCollisions( filteredRoot, filteredColliders, new Set( [ filteredObject.id ] ) );
assert.equal( filteredColliders.boxes.length, 1, 'streaming can register collision only for the newly loaded objects' );
assert.equal( filteredColliders.boxes[ 0 ].tag, `world:${filteredObject.id}`, 'targeted collision registration excludes unrelated loaded objects' );

const compoundObject = {
	...object,
	id: 'elsemesh-object:compound-platform',
	collision: { shape: 'compound', enabled: true, boxes: [
		{ center: [ 1, 1, 1 ], halfExtents: [ 1, 2, 3 ], yaw: 0.25, walkable: true, solid: true, tag: 'elsemesh.vendor.counter' },
		{ center: [ - 1, 0, 0 ], halfExtents: [ 0.5, 1, 0.5 ], yaw: 0, walkable: false, solid: true },
	] },
};
assert.doesNotThrow( () => validateWorldSource( { ...source, objects: [ compoundObject ] } ), 'bounded compound collision is valid' );
assert.doesNotThrow( () => validateWorldObjects( [ compoundObject ] ), 'browser accepts the validated compound collision used by exported world packages' );
const invalidTagObject = { ...compoundObject, collision: { ...compoundObject.collision, boxes: [ { ...compoundObject.collision.boxes[ 0 ], tag: 'invalid tag' } ] } };
assert.throws( () => validateWorldSource( { ...source, objects: [ invalidTagObject ] } ), /bounded box, compound, or heightfield data/, 'world source rejects malformed semantic tags' );
assert.throws( () => validateWorldObjects( [ invalidTagObject ] ), /invalid collision bounds/, 'browser rejects malformed semantic tags' );
assert.throws( () => validateWorldSource( { ...source, objects: [ { ...compoundObject, collision: { ...compoundObject.collision, boxes: [] } } ] } ), /bounded box, compound, or heightfield data/, 'empty compound collision is rejected' );
assert.throws( () => validateWorldObjects( [ { ...compoundObject, collision: { ...compoundObject.collision, boxes: [] } } ] ), /invalid collision bounds/, 'browser rejects empty compound collision data' );
const compoundRoot = { children: [ { userData: { worldObjectId: compoundObject.id } } ], userData: { worldPackage: {
	connector: { manifest: { objects: [ compoundObject ] } }, loadedObjects: new Set( [ compoundObject.id ] ),
} } };
const compoundColliders = new Colliders();
registerWorldPackageCollisions( compoundRoot, compoundColliders );
assert.equal( compoundColliders.boxes.length, 2, 'compound package registers each box' );
assert.equal( compoundColliders.boxes[ 0 ].tag, 'elsemesh.vendor.counter', 'compound package preserves owner-defined semantic tags' );
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
	boxes: [ { center: [ 0, 0, 0 ], halfExtents: [ 3, 0, 3 ], rotation: [ 0, 0, 0, 1 ] } ],
	spheres: [ { center: [ 5, 1, 0 ], radius: 0.5 } ],
	capsules: [ { center: [ - 5, 1, 0 ], radius: 0.25, length: 1, rotation: [ 0, 0, 0, 1 ] } ],
	taperedCapsules: [],
	convexes: [ { vertices: [ [ 6, 0, 0 ], [ 7, 0, 0 ], [ 6, 0, 1 ], [ 7, 0, 1 ], [ 6, 1, 0 ], [ 7, 1, 0 ], [ 6, 1, 1 ], [ 7, 1, 1 ] ], indices: [ 0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5 ] } ],
};
const bridgedObject = { id: 'elsemesh-object:bridged', kind: 'asset-instance', assetId: `sha256:${'b'.repeat( 64 )}`, transform: { position: [ 10, 2, 30 ], yaw: 0 }, collision: { enabled: false, shape: 'none' } };
const bridgedConnector = { worldId: 'elsemesh:bridge-collision', manifest: { objects: [ bridgedObject ], portals: [] } };
const bridgedRoot = await loadWorldPackage( bridgedConnector, { assets: new Map( [ [ bridgedObject.assetId, bodySetupGLB( { elsemeshCollision: bodySetupMetadata } ) ] ] ) } );
bridgedRoot.children[ 0 ].children[ 0 ].position.y = 1;
const bridgedColliders = new Colliders();
registerWorldPackageCollisions( bridgedRoot, bridgedColliders );
assert.equal( bridgedColliders.boxes.length, 1, 'bridge registers the BodySetup floor box from GLB node extras' );
assert.equal( bridgedColliders.convexes.length, 1, 'bridge registers convex hull geometry from GLB node extras' );
assert.equal( bridgedColliders.cylinders.length, 2, 'bridge maps BodySetup spheres and capsules into the current vertical-cylinder collider' );
assert.ok( Math.abs( bridgedColliders.groundHeightAt( 10, 30, 10 ) - 3 ) < 1e-6, 'zero-thickness Unreal box floor collider is transformed with the GLB node and object placement' );
assert.ok( Math.abs( bridgedColliders.groundHeightAt( 16.5, 30.5, 10 ) - 4 ) < 1e-6, 'convex top facets provide walkable ground at their transformed height' );
const convexTopPosition = new Vector3( 16.5, 4, 30.5 );
assert.equal( bridgedColliders.resolveCapsule( convexTopPosition, 0.3, 1.8 ), false, 'standing on a convex top does not push the capsule sideways' );
const convexSidePosition = new Vector3( 16.4, 3.1, 30.5 );
assert.equal( bridgedColliders.resolveCapsule( convexSidePosition, 0.3, 1.8 ), true, 'convex wall intersects and resolves a vertical player capsule' );
assert.ok( convexSidePosition.x <= 15.70001 || convexSidePosition.x >= 17.29999 || convexSidePosition.z <= 29.70001 || convexSidePosition.z >= 31.29999, 'convex resolution pushes the capsule beyond a hull face' );
assert.equal( bridgedColliders.boxes[ 0 ].walkable, true, 'horizontal BodySetup box is walkable' );
registerWorldPackageCollisions( bridgedRoot, bridgedColliders );
assert.equal( bridgedColliders.boxes.length, 1, 'streaming registration does not duplicate embedded BodySetup boxes' );
assert.equal( bridgedColliders.convexes.length, 1, 'streaming registration does not duplicate embedded convex colliders' );
unregisterWorldPackageCollisions( bridgedRoot, bridgedColliders );
assert.equal( bridgedColliders.boxes.length, 0, 'world handoff removes embedded boxes' );
assert.equal( bridgedColliders.convexes.length, 0, 'world handoff removes embedded convex colliders' );
assert.equal( bridgedColliders.cylinders.length, 0, 'world handoff removes embedded sphere and capsule colliders' );

const streamedCollisionObject = {
	id: 'elsemesh-object:streamed-collision-cell',
	transform: { position: [ 10, 2, 30 ], yaw: Math.PI / 2 }, scale: [ 2, 1, 1 ],
};
const streamedColliders = new Colliders();
const tiltedCapsule = { source: 'fixture', coordinateSystem: 'elsemesh-y-up-meters/1', boxes: [], spheres: [], convexes: [], taperedCapsules: [], capsules: [ { center: [ 0, 0, 0 ], radius: 1, length: 2, rotation: [ 0, 0, Math.SQRT1_2, Math.SQRT1_2 ] } ] };
const tiltedColliders = new Colliders();
registerWorldPackageCollisionPayload( bodySetupGLB( { elsemeshCollision: tiltedCapsule } ), { id: 'tilted', transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 2, 1, 3 ] }, tiltedColliders );
assert.equal( tiltedColliders.boxes.length, 1, 'tilted capsule uses a conservative box' );
assert.ok( tiltedColliders.boxes[ 0 ].half.distanceTo( new Vector3( 4, 3, 3 ) ) < 1e-6, 'tilted capsule dimensions are scaled once in world space' );
const rotatedBox = { source: 'fixture', coordinateSystem: 'elsemesh-y-up-meters/1', boxes: [ { center: [ 5, 0, 0 ], halfExtents: [ 2, 1, 1 ], rotation: [ 0, 0, Math.SQRT1_2, Math.SQRT1_2 ] } ], spheres: [], capsules: [], taperedCapsules: [], convexes: [] };
const rotatedBoxColliders = new Colliders();
registerWorldPackageCollisionPayload( bodySetupGLB( { elsemeshCollision: rotatedBox } ), { id: 'rotated-box', transform: { position: [ 0, 0, 0 ], yaw: 0 } }, rotatedBoxColliders );
assert.ok( rotatedBoxColliders.boxes[ 0 ].center.distanceTo( new Vector3( 5, 0, 0 ) ) < 1e-6, 'shape rotation leaves the authored box center fixed' );
const streamedShapes = registerWorldPackageCollisionPayload( bodySetupGLB( { elsemeshCollision: bodySetupMetadata } ), streamedCollisionObject, streamedColliders );
assert.equal( streamedShapes.length, 4, 'streamed collision GLB registers its box, sphere, capsule, and convex hull' );
assert.equal( streamedColliders.boxes.length, 1, 'streamed collision GLB registers its BodySetup box' );
assert.equal( streamedColliders.convexes.length, 1, 'streamed collision GLB registers its convex hull' );
assert.equal( streamedColliders.cylinders.length, 2, 'streamed collision GLB registers sphere and capsule colliders' );
assert.ok( Math.abs( streamedColliders.groundHeightAt( 10, 30, 3 ) - 2 ) < 1e-6, 'streamed collision GLB applies its cell transform before movement uses the floor' );
for ( const { kind, collider } of streamedShapes ) {
	if ( kind === 'box' ) streamedColliders.removeBox( collider );
	else if ( kind === 'cylinder' ) streamedColliders.removeCylinder( collider );
	else if ( kind === 'convex' ) streamedColliders.removeConvex( collider );
}
assert.equal( streamedColliders.boxes.length + streamedColliders.cylinders.length + streamedColliders.convexes.length, 0, 'evicting a streamed collision cell removes all of its shapes' );

const previewSupport = {
	id: 'elsemesh-object:preview-support', kind: 'asset-instance', label: 'Provisional preview support', assetId: null,
	transform: { position: [ 0, 6.75, 8 ], yaw: 0 }, scale: [ 1, 1, 1 ], priority: 'visible',
	collision: { enabled: true, shape: 'box', center: [ 0, 0, 0 ], halfExtents: [ 2, 0.25, 3 ], walkable: true, solid: true },
};
const supportConnector = { manifest: { objects: [ previewSupport ], portals: [] } };
const supportRoot = await loadWorldPackage( supportConnector, { assets: new Map() } );
await appendWorldPackageAssets( supportConnector, supportRoot, new Map() );
const supportColliders = new Colliders();
registerWorldPackageCollisions( supportRoot, supportColliders );
assert.equal( supportColliders.groundHeightAt( 1, 9, 10 ), 7, 'collision-only package objects provide a floor without a visual asset' );
assert.equal( supportRoot.children[ 0 ].visible, false, 'collision-only support never renders as geometry' );
unregisterWorldPackageCollisions( supportRoot, supportColliders );

const invalidCollisionRoot = new Group();
const invalidCollisionInstance = new Group();
invalidCollisionInstance.userData.worldObjectId = 'elsemesh-object:invalid-body-setup';
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
assert.equal( bridgedColliders.boxes.length + bridgedColliders.cylinders.length + bridgedColliders.convexes.length, 0, 'a rejected BodySetup does not leave partially registered colliders' );
console.log( 'ok   authored world collisions validate, transform, register, and clean up' );
