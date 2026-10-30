import assert from 'node:assert/strict';
import {
	decodeStaticModelInstanceSet,
	STATIC_MODEL_INSTANCE_SET_FORMAT,
	validateStaticModelInstanceSet,
} from '../src/network/StaticModelInstanceSet.js';

const hi = `sha256:${'a'.repeat( 64 )}`;
const low = `sha256:${'b'.repeat( 64 )}`;
const valid = {
	format: STATIC_MODEL_INSTANCE_SET_FORMAT,
	models: [ {
		id: 'market-table-fish',
		bounds: { center: [ 0, 0.1, 0 ], radius: 0.6 },
		lods: [ { assetId: hi, enterBelowProjectedRadius: 0.018 }, { assetId: low, enterBelowProjectedRadius: 0.004 } ],
		shadowLod: 1,
		shadowMaxDistance: 22,
	} ],
	instances: [ { model: 'market-table-fish', position: [ 1, 2, 3 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
};

assert.equal( validateStaticModelInstanceSet( valid ), valid, 'accepts backend-neutral model assets and transforms' );
assert.equal( decodeStaticModelInstanceSet( new TextEncoder().encode( JSON.stringify( valid ) ), { availableAssetIDs: new Set( [ hi, low ] ) } ).instances.length, 1 );
assert.throws( () => validateStaticModelInstanceSet( valid, { availableAssetIDs: new Set( [ hi ] ) } ), /missing/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, renderer: 'webgpu' } ), /format or fields/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], rotation: [ 0, 0, 0, 0 ] } ] } ), /normalized quaternion/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, instances: [ { ...valid.instances[ 0 ], scale: [ 1, 0, 1 ] } ] } ), /transform/ );
assert.throws( () => validateStaticModelInstanceSet( { ...valid, models: [ { ...valid.models[ 0 ], lods: [ ...valid.models[ 0 ].lods ].reverse() } ] } ), /unordered LOD/ );
assert.throws( () => decodeStaticModelInstanceSet( new Uint8Array( [ 0xff ] ) ), /UTF-8 JSON/ );

console.log( 'static model instance-set contract checks passed' );
