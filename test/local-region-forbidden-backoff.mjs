import assert from 'node:assert/strict';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';

const assetID = 'blocked-visual-lod';
const assetURL = 'http://127.0.0.1:4179/v1/regions/hall?cell=0%2C0%2C0%2C8&payload=visual&mesh=%2FGame%2FWall&lod=0';
const retryKey = `${assetID}\n${assetURL}`;
const connector = new LocalRegionConnector( { localProvider: 'http://127.0.0.1:4179', localMap: 'Hall' } );
connector.manifest = { assets: [ { id: assetID, kind: 'glb' } ], objects: [], components: [] };
connector.regionAssets.set( assetID, assetURL );

const previousFetch = globalThis.fetch;
let leaseRequests = 0;
globalThis.fetch = async ( input, options = {} ) => {
	if ( options.method === 'POST' && new URL( input ).pathname.endsWith( '/leases' ) ) leaseRequests ++;
	return new Response( 'outside admitted view', { status: 403 } );
};

try {
	await assert.rejects( connector.preload( { assetIDs: [ assetID ] } ), /lease request failed \(403\)/ );
	assert.equal( leaseRequests, 1, 'the initial denied visual lease is requested once' );
	const firstRetry = connector.forbiddenAssetRetry.get( retryKey );
	assert.ok( firstRetry.retryAt > performance.now() );
	assert.equal( firstRetry.delayMs, 1000, 'the first denial receives a one-second retry delay' );

	const deferred = await connector.preload( { assetIDs: [ assetID ] } );
	assert.equal( deferred.size, 0, 'a denied visual asset is not installed during its retry delay' );
	assert.equal( leaseRequests, 1, 'a denied visual lease is not retried on every streaming tick' );

	connector.forbiddenAssetRetry.set( retryKey, { retryAt: 0, delayMs: firstRetry.delayMs } );
	await assert.rejects( connector.preload( { assetIDs: [ assetID ] } ), /lease request failed \(403\)/ );
	assert.equal( leaseRequests, 2, 'the asset becomes eligible for a later retry' );
	assert.equal( connector.forbiddenAssetRetry.get( retryKey ).delayMs, 2000, 'repeated denial exponentially increases the delay' );
	connector.regionAssets.set( assetID, assetURL.replace( '0%2C0%2C0%2C8', '1%2C0%2C0%2C8' ) );
	await assert.rejects( connector.preload( { assetIDs: [ assetID ] } ), /lease request failed \(403\)/ );
	assert.equal( leaseRequests, 3, 'an asset retried through a different visible-cell route has an independent authorization backoff' );

	connector.forbiddenAssetRetry.clear();
	for ( let index = 0; index < 4096; index ++ ) connector.forbiddenAssetRetry.set( `old-${index}`, { retryAt: performance.now() + 60000, delayMs: 1000 } );
	const oldestRetryKey = connector.forbiddenAssetRetry.keys().next().value;
	await assert.rejects( connector.preload( { assetIDs: [ assetID ] } ), /lease request failed \(403\)/ );
	assert.equal( connector.forbiddenAssetRetry.size, 4096, 'forbidden-asset retry state remains bounded' );
	assert.equal( connector.forbiddenAssetRetry.has( oldestRetryKey ), false, 'the oldest retry record is evicted when the bound is reached' );
	assert.equal( connector.forbiddenAssetRetry.has( `${assetID}\n${connector.regionAssets.get( assetID )}` ), true, 'the latest denied route receives its backoff entry' );
} finally {
	connector.forbiddenAssetRetry.clear();
	globalThis.fetch = previousFetch;
}

console.log( 'local region forbidden asset backoff checks passed' );
