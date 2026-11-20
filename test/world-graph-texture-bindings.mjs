import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { staticModelTexturePNG } from './helpers/static-model-glb.mjs';
import { loadWorldGraphTextureBindings, validateWorldGraphTextureBindings, WORLD_GRAPH_TEXTURE_DATA_FORMAT } from '../src/network/WorldGraphTextureBindings.js';

const hash = bytes => `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
const imageAssetID = hash( staticModelTexturePNG );
const component = {
	id: 'elsemesh-component:graph-texture-fixture',
	type: 'elsemesh.static-model-instance-set/1',
	assets: [ { assetId: imageAssetID, kind: 'image/png' } ],
	data: { graphTextureBindings: [ { slot: 'leafMask', assetId: imageAssetID, dataFormat: WORLD_GRAPH_TEXTURE_DATA_FORMAT } ] },
};
const connector = {
	manifest: { assets: [ { id: imageAssetID, kind: 'image/png' } ] },
	assets: new Map( [ [ imageAssetID, staticModelTexturePNG ] ] ),
};

assert.deepEqual( validateWorldGraphTextureBindings( connector, component ), [ { slot: 'leafMask', assetId: imageAssetID, sampler: 'linearClamp' } ] );
const loaded = await loadWorldGraphTextureBindings( connector, component );
assert.deepEqual( [ loaded.get( 'leafMask' ).width, loaded.get( 'leafMask' ).height, loaded.get( 'leafMask' ).data.length, loaded.get( 'leafMask' ).sampler ], [ 1, 1, 4, 'linearClamp' ] );
assert.throws( () => validateWorldGraphTextureBindings( { ...connector, manifest: { assets: [ { id: imageAssetID, kind: 'glb' } ] } }, component ), /declared as image\/png/ );
assert.throws( () => validateWorldGraphTextureBindings( connector, { ...component, data: { graphTextureBindings: [ { ...component.data.graphTextureBindings[ 0 ], slot: 'unknown' } ] } } ), /fields, slot/ );
assert.throws( () => validateWorldGraphTextureBindings( connector, { ...component, data: { graphTextureBindings: [ { ...component.data.graphTextureBindings[ 0 ], slot: 'baseColor' } ] } } ), /fields, slot/ );
assert.throws( () => validateWorldGraphTextureBindings( connector, { ...component, data: { graphTextureBindings: [ ...component.data.graphTextureBindings, component.data.graphTextureBindings[ 0 ] ] } } ), /fields, slot/ );
assert.throws( () => validateWorldGraphTextureBindings( connector, { ...component, assets: [] } ), /declared as image\/png/ );

console.log( 'Signed world material graph texture bindings: declaration, PNG decode, and sampler policy passed' );
