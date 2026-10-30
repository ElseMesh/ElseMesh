import assert from 'node:assert/strict';
import { worldComponentRuntimeRecord } from '../src/network/WorldSource.js';

const envelope = {
	id: 'elsemesh-component:reef-tile',
	type: 'elsemesh.static-reef/1',
	assets: [ { id: 'sha256:reef', mediaType: 'application/octet-stream' } ],
	data: { placementAssetId: 'sha256:reef', seed: 17 },
};
const runtime = worldComponentRuntimeRecord( envelope );

assert.equal( runtime.id, envelope.id );
assert.equal( runtime.type, envelope.type );
assert.equal( runtime.placementAssetId, 'sha256:reef', 'authored component data is available to renderer/runtime adapters' );
assert.equal( runtime.seed, 17 );
assert.deepEqual( runtime.data, envelope.data, 'runtime normalization preserves the signed data envelope' );
assert.equal( envelope.placementAssetId, undefined, 'normalizing a component does not mutate the signed source' );

console.log( 'world component envelope normalization passed' );
