import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { WebGLFallback } from '../src/fallback/WebGLFallback.js';
import { registerWorldComponentBackendAdapter, registerWorldComponentBackendBatchAdapter } from '../src/network/WorldComponentBackendRegistry.js';

globalThis.crypto ||= webcrypto;
const originalFetch = globalThis.fetch;
const requested = [];
const content = new Map();
const makeAsset = ( name ) => {
	const bytes = new TextEncoder().encode( name );
	const id = `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
	content.set( `/assets/${name}`, bytes );
	return { assetId: id, kind: 'fixture/1' };
};
const singleAsset = makeAsset( 'single' ), batchAsset = makeAsset( 'batch' );
globalThis.fetch = async url => {
	requested.push( url );
	const bytes = content.get( url );
	return bytes ? new Response( bytes ) : new Response( null, { status: 404 } );
};

const singleType = 'elsemesh.fixture-builtin-single/1';
const batchType = 'elsemesh.fixture-builtin-batch/1';
let singleContext, batchContext;
registerWorldComponentBackendAdapter( 'webgl', singleType, context => {
	singleContext = context;
	return { installed: true, runtime: { single: true } };
} );
registerWorldComponentBackendBatchAdapter( 'webgl', batchType, ( context, components ) => {
	batchContext = { context, components };
	return { componentIDs: components.map( component => component.id ), runtime: { batch: true } };
} );

const fallback = Object.assign( Object.create( WebGLFallback.prototype ), {
	defaultWorldSource: {
		rules: {},
		components: [
			{ id: 'single', type: singleType, assets: [ singleAsset ] },
			{ id: 'batch-a', type: batchType, assets: [ batchAsset ] },
			{ id: 'batch-b', type: batchType, assets: [ batchAsset ] },
			{ id: 'unregistered', type: 'elsemesh.fixture-no-adapter/1', assets: [] },
		],
	},
	defaultWorldAssets: { assetURLs: { [ singleAsset.assetId ]: '/assets/single', [ batchAsset.assetId ]: '/assets/batch' } },
	worldLink: null,
	terrain: { size: 512 },
	builtinComponentRuntimes: new Map(),
} );

try {
	await fallback._loadBuiltinComponents();
	assert.equal( singleContext.isCurrent(), true, 'single adapters receive a live built-in world guard' );
	assert.equal( singleContext.connector.manifest.assets.length, 2, 'the built-in connector exposes referenced content as the generic asset inventory' );
	assert.deepEqual( [ ...batchContext.components.map( component => component.id ) ], [ 'batch-a', 'batch-b' ], 'components with one batch adapter are installed together' );
	assert.equal( fallback.builtinComponentRuntimes.get( 'single' ).single, true, 'single-adapter runtimes are registered for per-frame updates' );
	assert.equal( fallback.builtinComponentRuntimes.get( 'batch-a' ).batch, true, 'batch-adapter runtimes are registered under their component IDs' );
	assert.deepEqual( requested.sort(), [ '/assets/batch', '/assets/single' ], 'only declared assets are fetched and each shared batch asset is loaded once' );
	console.log( 'built-in WebGL single and batch component loading passed' );
} finally {
	globalThis.fetch = originalFetch;
}
