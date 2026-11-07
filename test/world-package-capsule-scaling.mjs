import assert from 'node:assert/strict';
import { registerWorldPackageCollisionPayload } from '../src/network/WorldPackage.js';

const gltf = {
	asset: { version: '2.0' },
	scene: 0,
	scenes: [ { nodes: [ 0 ] } ],
	nodes: [ {
		extras: { elsemeshCollision: {
			source: 'capsule-scale-fixture',
			coordinateSystem: 'elsemesh-y-up-meters/1',
			boxes: [], spheres: [], taperedCapsules: [], convexes: [],
			capsules: [ { center: [ 0, 0, 0 ], radius: 0.22, length: 0.44, rotation: [ 0, 0, 0, 1 ] } ],
		} },
	} ],
};

const json = Buffer.from( JSON.stringify( gltf ) );
const paddedJSON = Buffer.alloc( Math.ceil( json.length / 4 ) * 4, 0x20 );
json.copy( paddedJSON );
const totalLength = 12 + 8 + paddedJSON.length;
const header = Buffer.alloc( 12 );
header.writeUInt32LE( 0x46546c67, 0 );
header.writeUInt32LE( 2, 4 );
header.writeUInt32LE( totalLength, 8 );
const chunkHeader = Buffer.alloc( 8 );
chunkHeader.writeUInt32LE( paddedJSON.length, 0 );
chunkHeader.writeUInt32LE( 0x4e4f534a, 4 );
const glb = Buffer.concat( [ header, chunkHeader, paddedJSON ] );

const cylinders = [];
const colliders = {
	addCylinder( x, z, radius, minY, maxY, options ) {
		const result = { x, z, radius, minY, maxY, options };
		cylinders.push( result );
		return result;
	},
	removeCylinder() {},
	addBox() { throw new Error( 'unexpected box collision' ); },
	removeBox() {},
	addConvex() { throw new Error( 'unexpected convex collision' ); },
	removeConvex() {},
};

registerWorldPackageCollisionPayload( glb, { id: 'capsule', scale: [ 2, 3, 4 ] }, colliders );
assert.equal( cylinders.length, 1 );
assert.equal( cylinders[ 0 ].radius, 0.88, 'capsule radius uses the larger scale perpendicular to its Y axis' );
assert.equal( cylinders[ 0 ].minY, -1.54, 'capsule length follows the Y-axis scale' );
assert.equal( cylinders[ 0 ].maxY, 1.54, 'capsule length follows the Y-axis scale' );

console.log( 'Embedded capsule collision uses perpendicular radius scale and axial length scale' );
