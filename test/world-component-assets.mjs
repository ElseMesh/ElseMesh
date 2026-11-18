import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createBundledWorldAssetConnector, loadWorldComponentAssets } from '../src/network/WorldComponentAssets.js';

globalThis.crypto ||= webcrypto;
const bytes = new Uint8Array( [ 7, 19, 31, 43 ] );
const hash = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
const assetID = `sha256:${hash}`;
const components = [
	{ type: 'elsemesh.fixture/1', assets: [ { assetId: assetID, kind: 'fixture/1' } ] },
	{ type: 'elsemesh.fixture/1', assets: [ { assetId: assetID, kind: 'fixture/1' } ] },
];
let requests = 0;
const fetchAsset = async url => {
	requests ++;
	assert.equal( url, '/assets/fixture.bin' );
	return bytes;
};
const loaded = await loadWorldComponentAssets( components, { [ assetID ]: '/assets/fixture.bin' }, fetchAsset );
assert.deepEqual( [ ...loaded.keys() ], [ assetID ], 'repeated references resolve to one shared content-addressed asset' );
assert.deepEqual( loaded.get( assetID ), bytes, 'the shared loader returns the exact package bytes' );
assert.equal( requests, 1, 'the shared loader fetches each content address once' );
await assert.rejects(
	loadWorldComponentAssets( components.slice( 0, 1 ), { [ assetID ]: '/assets/wrong.bin' }, async () => new Uint8Array( [ 1 ] ) ),
	/SHA-256 check/,
	'local package bytes must match the world source content address',
);
await assert.rejects(
	loadWorldComponentAssets( components.slice( 0, 1 ), {}, fetchAsset ),
	/no local package URL/,
	'missing local package bindings fail explicitly',
);
await assert.rejects(
	loadWorldComponentAssets( [ { assets: [ { assetId: 'local:mutable', kind: 'fixture/1' } ] } ], {}, fetchAsset ),
	/not content addressed/,
	'local component assets retain the same content-addressing requirement as hosted assets',
);

const source = { components: [ { id: 'models', type: 'elsemesh.static-model-instance-set/1', assets: [ { assetId: assetID, kind: 'fixture/1' } ] } ] };
let bundledFetches = 0;
const bundled = createBundledWorldAssetConnector( source, { [ assetID ]: '/assets/fixture.bin' }, async () => { bundledFetches ++; return bytes; } );
assert.deepEqual( bundled.manifest.assets, [ { id: assetID, kind: 'fixture/1' } ], 'built-in assets expose the manifest inventory expected by generic component adapters' );
assert.equal( bundled.assets.size, 0, 'the built-in connector leaves model assets lazy' );
assert.deepEqual( await bundled.getAsset( assetID ), bytes, 'built-in model assets use the shared content-hash check' );
assert.deepEqual( await bundled.getAsset( assetID ), bytes, 'the built-in connector caches verified bytes' );
assert.equal( bundledFetches, 1, 'a built-in asset is fetched only once' );
await assert.rejects( bundled.getAsset( `sha256:${'0'.repeat( 64 )}` ), /does not declare asset/, 'built-in components cannot request undeclared assets' );
const tampered = createBundledWorldAssetConnector( source, { [ assetID ]: '/assets/fixture.bin' }, async () => new Uint8Array( [ 1 ] ) );
await assert.rejects( tampered.getAsset( assetID ), /SHA-256 check/, 'built-in model LOD bytes are checked against their content address' );

console.log( 'world component assets are shared, deduplicated, and content verified' );
