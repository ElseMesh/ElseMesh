import assert from 'node:assert/strict';
import { webglSandShoreBounds, webglShoreFieldTexture, webglShorePatchSegments } from '../src/fallback/WebGLShoreField.js';

class DataTexture {
	constructor( data, width, height, format, type ) { Object.assign( this, { image: { data, width, height }, format, type } ); }
}
const THREE = {
	DataTexture, RGBAFormat: 'rgba', UnsignedByteType: 'u8', ClampToEdgeWrapping: 'clamp', LinearFilter: 'linear',
	Vector2: class { constructor( x, y ) { this.x = x; this.y = y; } },
};

const shore = webglShoreFieldTexture( THREE, {
	res: 2, origin: -10, size: 20,
	// arrival, direction-x * exposure, direction-z * exposure, swash arrival
	data: new Float32Array( [ 12, 0.6, 0.8, 20, 14, -0.5, 0, 24, 10000, 0, 0, 10000, 10000, 0, 0, 10000 ] ),
} );
assert.ok( shore );
assert.deepEqual( [ shore.timeRange.x, shore.timeRange.y ], [ 12, 14 ] );
assert.deepEqual( [ shore.swashTimeRange.x, shore.swashTimeRange.y ], [ 20, 24 ] );
assert.deepEqual( [ ...shore.texture.image.data.slice( 0, 4 ) ], [ 204, 229, 255, 0 ] );
assert.equal( shore.texture.image.data[ 7 ], 255 );
assert.equal( shore.swashTexture.image.data[ 4 ], 255 );

const heights = new Float32Array( 16 ).fill( -3 );
heights[ 5 ] = 1;
const splat = new Uint8Array( 16 * 4 );
splat[ 5 * 4 ] = 255;
const bounds = webglSandShoreBounds( { res: 4, size: 40, origin: -20, heights, splat }, 0, { cellPadding: 0 } );
assert.deepEqual( bounds, { xMin: -10, xMax: 0, zMin: -10, zMax: 0 } );
assert.equal( webglSandShoreBounds( { res: 4, size: 40, origin: -20, heights, splat }, 2 ), null );
const segments = webglShorePatchSegments( { xMin: -600, xMax: 600, zMin: -500, zMax: 500 } );
assert.ok( segments.x * segments.z <= 220000 );
assert.ok( segments.x >= 128 && segments.z >= 128 );

console.log( 'ok WebGL packaged shore texture encoding and generic sand-shore bounds' );
