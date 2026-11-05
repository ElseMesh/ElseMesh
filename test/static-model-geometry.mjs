import assert from 'node:assert/strict';
import { BufferGeometry } from '../src/engine/geometry/BufferGeometry.js';
import { Float32BufferAttribute } from '../src/engine/geometry/BufferAttribute.js';
import { mirrorStaticModelGeometryX } from '../src/network/StaticModelGeometry.js';

const indexed = new BufferGeometry();
indexed.setAttribute( 'position', new Float32BufferAttribute( [ 1, 0, 0, 2, 0, 0, 1, 1, 0 ], 3 ) );
indexed.setAttribute( 'normal', new Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ], 3 ) );
indexed.setAttribute( 'tangent', new Float32BufferAttribute( [ 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1 ], 4 ) );
indexed.setIndex( [ 0, 1, 2 ] );
mirrorStaticModelGeometryX( indexed );
assert.deepEqual( [ indexed.getAttribute( 'position' ).getX( 0 ), indexed.getAttribute( 'position' ).getX( 1 ) ], [ -1, -2 ] );
assert.equal( Math.abs( indexed.getAttribute( 'normal' ).getX( 0 ) ), 0 );
assert.equal( indexed.getAttribute( 'normal' ).getZ( 0 ), 1 );
assert.deepEqual( [ indexed.getAttribute( 'tangent' ).getX( 0 ), indexed.getAttribute( 'tangent' ).getW( 0 ) ], [ -1, -1 ] );
assert.deepEqual( [ indexed.getIndex().getX( 0 ), indexed.getIndex().getX( 1 ), indexed.getIndex().getX( 2 ) ], [ 0, 2, 1 ] );
assert.ok( indexed.boundingBox.min.x <= -2 && indexed.boundingBox.max.x <= -1 );

const nonIndexed = new BufferGeometry();
nonIndexed.setAttribute( 'position', new Float32BufferAttribute( [ 0, 0, 0, 1, 0, 0, 0, 1, 0 ], 3 ) );
mirrorStaticModelGeometryX( nonIndexed );
assert.deepEqual( [ nonIndexed.getIndex().getX( 0 ), nonIndexed.getIndex().getX( 1 ), nonIndexed.getIndex().getX( 2 ) ], [ 0, 2, 1 ] );
assert.equal( nonIndexed.getAttribute( 'position' ).getX( 1 ), -1 );

console.info( 'static model geometry mirror and winding checks passed' );
