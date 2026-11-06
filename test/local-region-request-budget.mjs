import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';

globalThis.crypto ||= webcrypto;
const connector = new LocalRegionConnector( { localProvider: 'http://127.0.0.1:1234', localMap: 'test' } );
connector.manifest = {};
const names = [ 'visual1', 'visual2', 'visual3', 'texture', 'collision' ];
for ( const name of names ) {
	const query = name === 'collision' ? 'payload=collision' : name === 'texture' ? 'payload=visual&texture=source%3Aabc' : 'payload=visual';
	connector.regionAssets.set( name, `/v1/regions/test?cell=0,0,0,16&${query}&name=${name}` );
}
const started = [], pending = [];
const body = new Uint8Array( [ 1, 2, 3 ] );
const etag = `"sha256-${createHash( 'sha256' ).update( body ).digest( 'hex' )}"`;
const waitForStarted = async count => {
	const deadline = Date.now() + 3000;
	while ( started.length < count && Date.now() < deadline ) await new Promise( resolve => setTimeout( resolve, 5 ) );
};
const originalFetch = globalThis.fetch;
let nextLease = 0;
globalThis.fetch = async ( input, options = {} ) => {
	const url = new URL( input );
	if ( url.pathname.endsWith( '/leases' ) ) return Response.json( { leaseId: ( ++nextLease ).toString( 16 ).padStart( 32, '0' ), expiresInSeconds: 30 } );
	if ( url.pathname.startsWith( '/v1/leases/' ) ) return new Response( null, { status: 204 } );
	const name = url.searchParams.get( 'name' );
	started.push( name );
	return new Promise( resolve => pending.push( () => resolve( new Response( body, { headers: { 'Content-Length': '3', ETag: etag } } ) ) ) );
};
try {
	const requests = names.map( name => connector.getAsset( name ) );
	await new Promise( resolve => setImmediate( resolve ) );
	assert.deepEqual( started, [ 'visual1', 'visual2' ] );
	pending.shift()();
	await waitForStarted( 3 );
	assert.deepEqual( started, [ 'visual1', 'visual2', 'collision' ] );
	pending.shift()();
	await waitForStarted( 4 );
	assert.deepEqual( started, [ 'visual1', 'visual2', 'collision', 'visual3' ] );
	pending.shift()();
	await waitForStarted( 5 );
	assert.deepEqual( started, [ 'visual1', 'visual2', 'collision', 'visual3', 'texture' ] );
	for ( const release of pending ) release();
	await Promise.all( requests );
	console.log( 'PASS: connector bounds concurrent leased assets and prioritizes collision' );
} finally {
	globalThis.fetch = originalFetch;
}
