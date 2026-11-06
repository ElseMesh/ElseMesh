import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodeGroundDetailDensityAsset, GROUND_DETAIL_DENSITY_ASSET_KIND } from '../src/network/GroundDetailDensityAsset.js';
import { worldComponentDescriptor } from '../src/network/WorldComponentRegistry.js';
import { worldComponentBackendAdapter } from '../src/network/WorldComponentBackendRegistry.js';
import '../src/network/WebGPUWorldComponentAdapters.js';

const bytes = Uint8Array.from( { length: 4 * 4 * 4 }, ( _value, index ) => index % 256 );
const asset = deflateSync( bytes );
const decoded = await decodeGroundDetailDensityAsset( asset, { resolution: 4, texel: 0.5 } );
assert.equal( decoded.res, 4 );
assert.equal( decoded.texel, 0.5 );
assert.deepEqual( decoded.data, bytes );
assert.equal( GROUND_DETAIL_DENSITY_ASSET_KIND, 'ground-detail-density/1' );
assert.equal( worldComponentDescriptor( 'elsemesh.ground-detail-field/1' )?.installRank, 2 );
assert.equal( typeof worldComponentBackendAdapter( 'webgpu', 'elsemesh.ground-detail-field/1' ), 'function' );
for ( const input of [
	[ new Uint8Array( 16 ), { resolution: 2.5, texel: 1 } ],
	[ new Uint8Array( 16 ), { resolution: 2, texel: 0 } ],
	[ new Uint8Array( 16 ), { resolution: 2049, texel: 1 } ],
] ) await assert.rejects( decodeGroundDetailDensityAsset( ...input ), /Invalid ground-detail density asset/ );
await assert.rejects( decodeGroundDetailDensityAsset( new Uint8Array( 16 ), { resolution: 2, texel: 1 } ), /not a valid DEFLATE/ );
await assert.rejects( decodeGroundDetailDensityAsset( deflateSync( bytes.subarray( 1 ) ), { resolution: 4, texel: 0.5 } ), /wrong dimensions/ );
await assert.rejects( decodeGroundDetailDensityAsset( asset, { resolution: 4, texel: 0.5, terrainSize: 3 } ), /does not match terrain size/ );

console.log( 'Ground-detail density asset codec and WebGPU registration passed' );
