import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodeWorldComponentAsset } from '../src/network/WorldComponentAssetCodecRegistry.js';
import { encodeGrassDensityAsset } from '../src/network/GrassDensityAsset.js';
import { loadGroundCoverFieldAssets } from '../src/network/GroundCoverFieldAssets.js';

const hash = bytes => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const densityBytes = encodeGrassDensityAsset( { data: new Uint8Array( 4 * 4 * 4 ), res: 4, size: 16, origin: -8 } );
const densityAssetId = hash( densityBytes ), modelAssetId = hash( new Uint8Array( [ 0x67, 0x6c, 0x62 ] ) );
const data = {
	densityAssetId, seed: 7, cellSize: 8, pointsPerCell: 4, placementAlgorithm: 'blue-noise/1', cellHeightPadding: { below: 0, above: 0 },
	distanceBands: [ { maxDistance: 20, cellCapacity: 8 } ],
	species: [ {
		id: 'meadow', densityExpression: { op: 'channel', index: 1 }, densityThreshold: 0,
		modelAssetIds: [ modelAssetId ], bounds: { center: [ 0, 0.5, 0 ], radius: 1 }, geometryMirrorX: false,
		lodMetric: 'scaled-distance', lodThresholds: [], lodFadeFraction: 0,
		drawMaxDistance: 20, drawFadeStartDistance: 18, scaleRange: [ 0.8, 1.2 ],
		castsShadow: false, shadowLodBias: 0, shadowMaxDistance: 0,
	} ],
};
const component = {
	id: 'elsemesh-component:ground-cover', type: 'elsemesh.ground-cover-field/1', data,
	assets: [ { assetId: densityAssetId, kind: 'grass-density/1' }, { assetId: modelAssetId, kind: 'glb' } ],
};
const modelBytes = new Uint8Array( [ 0x67, 0x6c, 0x62 ] );
const requests = [];
const connector = {
	manifest: { assets: [ { id: densityAssetId, kind: 'grass-density/1' }, { id: modelAssetId, kind: 'glb' } ] },
	assets: new Map( [ [ densityAssetId, densityBytes ] ] ),
	getAsset: async assetId => { requests.push( assetId ); return assetId === modelAssetId ? modelBytes : densityBytes; },
};

assert.equal( decodeWorldComponentAsset( 'grass-density/1', densityBytes ).size, 16, 'the engine asset codec recognizes signed grass-density assets' );
const loaded = await loadGroundCoverFieldAssets( connector, component, { terrain: { size: 16, origin: -8 } } );
assert.equal( loaded.density.data.byteLength, 64, 'the field loader decodes the signed density payload' );
assert.deepEqual( requests, [], 'model GLBs are not fetched while the field descriptor and density load' );
assert.equal( await loaded.loadModel( modelAssetId ), modelBytes, 'the validated signed GLB is fetched on demand' );
assert.deepEqual( requests, [ modelAssetId ] );
await assert.rejects( loadGroundCoverFieldAssets( connector, { ...component, assets: component.assets.slice( 0, 1 ) }, { terrain: { size: 16, origin: -8 } } ), /Invalid ground-cover field/, 'a field cannot omit its referenced model GLB' );
await assert.rejects( loadGroundCoverFieldAssets( connector, { ...component, assets: [ ...component.assets, { assetId: hash( new Uint8Array( [ 1 ] ) ), kind: 'glb' } ], data: { ...data, species: [ { ...data.species[ 0 ], modelAssetIds: [ hash( new Uint8Array( [ 1 ] ) ) ] } ] } }, { terrain: { size: 16, origin: -8 } } ), /not a signed component GLB/, 'every LOD model must be both manifest-signed and declared by the component' );

console.log( 'ground-cover field assets: signed density validation and lazy model loading passed' );
