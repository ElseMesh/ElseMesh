import assert from 'node:assert/strict';
import { decodeGrassDensityAsset, encodeGrassDensityAsset } from '../src/network/GrassDensityAsset.js';

const source = { res: 2, size: 4, origin: -2, data: new Uint8Array( [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 ] ) };
const encoded = encodeGrassDensityAsset( source );
const decoded = decodeGrassDensityAsset( encoded );
assert.equal( decoded.res, source.res );
assert.equal( decoded.size, source.size );
assert.equal( decoded.origin, source.origin );
assert.deepEqual( decoded.data, source.data );
assert.throws( () => decodeGrassDensityAsset( encoded.subarray( 0, encoded.length - 1 ) ), /header or size|dimensions/ );
const invalid = encoded.slice();
invalid[ 0 ] = 0;
assert.throws( () => decodeGrassDensityAsset( invalid ), /header or size/ );
assert.throws( () => encodeGrassDensityAsset( { ...source, res: 3 } ), /dimensions/ );
console.log( 'ok portable grass density asset codec' );
