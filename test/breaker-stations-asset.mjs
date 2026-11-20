import assert from 'node:assert/strict';
import { BREAKER_STATIONS_ASSET_KIND, decodeBreakerStationsAsset, decodeBreakerStationsComponentAsset, encodeBreakerStationsAsset } from '../src/network/BreakerStationsAsset.js';

const source = { count: 3, spacing: 0.6, data: new Float32Array( [ 1, 2, 0, 1, 1.6, 2, 0, 1, 2.2, 2, 0, 1 ] ) };
const bytes = encodeBreakerStationsAsset( source );
assert.equal( new TextDecoder().decode( bytes.slice( 0, 8 ) ), 'EMBRKST1' );
const decoded = decodeBreakerStationsAsset( bytes );
assert.deepEqual( decoded, source, 'station positions, sea directions, and authored spacing survive the binary contract' );
const component = { id: 'ocean', assets: [ { assetId: 'sha256:test', kind: BREAKER_STATIONS_ASSET_KIND } ] };
assert.deepEqual( decodeBreakerStationsComponentAsset( component, new Map( [ [ 'sha256:test', bytes ] ] ) ), source );
assert.equal( decodeBreakerStationsComponentAsset( { id: 'ocean', assets: [] }, new Map() ), null, 'breaker presentation remains optional for oceans without authored stations' );
assert.throws( () => decodeBreakerStationsAsset( bytes.subarray( 1 ) ), /header/ );
assert.throws( () => encodeBreakerStationsAsset( { count: 2, spacing: 0.6, data: new Float32Array( [ 1, 2, 0, 2, 2, 3, 0, 2 ] ) } ), /unit sea direction/ );
assert.throws( () => decodeBreakerStationsComponentAsset( component, new Map() ), /missing breaker station bytes/ );

console.log( 'world-authored breaker station asset contract passed' );
