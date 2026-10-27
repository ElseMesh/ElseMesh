import assert from 'node:assert/strict';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';
import { worldLinkFromLocation } from '../src/network/WorldConnector.js';
import { defaultHomeWorldURL, discoverLocalWorldURL } from '../src/network/WorldLauncher.js';

function makeGlb() {
	const document = {
		asset: { version: '2.0' },
		nodes: [ { translation: [ 10, 0, 20 ], extras: { elsemeshCollision: {
			coordinateSystem: 'elsemesh-y-up-meters/1',
			boxes: [ { center: [ 0, 0, 0 ], halfExtents: [ 10, 0, 10 ], rotation: [ 0, 0, 0, 1 ] } ],
		} } } ],
	};
	const json = new TextEncoder().encode( JSON.stringify( document ) );
	const jsonLength = ( json.byteLength + 3 ) & ~3;
	const bytes = new Uint8Array( 28 + jsonLength );
	const view = new DataView( bytes.buffer );
	view.setUint32( 0, 0x46546c67, true );
	view.setUint32( 4, 2, true );
	view.setUint32( 8, bytes.byteLength, true );
	view.setUint32( 12, jsonLength, true );
	view.setUint32( 16, 0x4e4f534a, true );
	bytes.fill( 0x20, 20, 20 + jsonLength );
	bytes.set( json, 20 );
	view.setUint32( 20 + jsonLength, 0, true );
	view.setUint32( 24 + jsonLength, 0x004e4942, true );
	return bytes;
}

const bytes = makeGlb();
const hash = Buffer.from( await crypto.subtle.digest( 'SHA-256', bytes ) ).toString( 'hex' );
const originalFetch = globalThis.fetch;
let cellFetches = 0;
globalThis.fetch = async input => {
	const url = new URL( input );
	if ( url.pathname === '/v1/descriptor' ) return Response.json( {
		schema: 'elsemesh.dynamic-region-provider/1', worldId: 'tw-world:hogwarts-legacy-local',
		sourceRevision: 'test-revision', readOnly: true, regions: '/v1/regions',
		entrySelection: {
			schema: 'elsemesh.hogwarts-entry-selection/1', entryPointActionLabel: 'Choose your house',
			entryPointPrompt: 'Which Hogwarts house will you join?',
			previewSpawn: { position: [ 1, 8.62, 9 ], yaw: 0, pitch: - 0.1 },
			previewRegion: { cellSizeMeters: 16, cell: [ 0, 0, 0 ] },
			previewSupport: { status: 'provisional', position: [ 0, 6.75, 8 ], halfExtents: [ 2, 0.25, 3 ], basis: 'synthetic rendered floor bounds' },
			choices: [ { id: 'gryffindor', label: 'Gryffindor' }, { id: 'hufflepuff', label: 'Hufflepuff' } ],
		},
	} );
	if ( url.pathname === '/v1/regions' ) return Response.json( { regions: [ { id: 'great-hall', label: 'Great Hall', asset: '/v1/regions/great-hall' } ] } );
	if ( url.pathname === '/v1/regions/great-hall/cells' ) return Response.json( {
		sourceRevision: 'test-revision', cellSizeMeters: Number( url.searchParams.get( 'size' ) ), cells: [ { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 } ],
	} );
	if ( url.pathname === '/v1/regions/great-hall' && url.searchParams.get( 'cell' ) === '0,0,0,16' ) {
		cellFetches++;
		return new Response( bytes, { headers: {
			'Content-Length': String( bytes.byteLength ), ETag: `"sha256-${hash}"`,
		} } );
	}
	return new Response( 'not found', { status: 404 } );
};

try {
	const link = worldLinkFromLocation( {
		search: '?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall',
		href: 'http://127.0.0.1:5189/?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall',
	} );
	assert.deepEqual( link, { localProvider: 'http://127.0.0.1:4179', localMap: 'Great Hall' } );
	const localPage = 'http://127.0.0.1:5189/?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall';
	assert.equal( await discoverLocalWorldURL( { pageURL: localPage, fetchImpl: () => { throw new Error( 'must not query the default world for a local bridge link' ); } } ), null );
	assert.equal( defaultHomeWorldURL( { pageURL: localPage, storage: { getItem: () => '{"worldId":"tw-world:example-island"}' } } ), null );
	assert.throws( () => worldLinkFromLocation( {
		search: '?localProvider=http%3A%2F%2Fexample.com&localMap=Great%20Hall',
		href: 'http://127.0.0.1:5189/',
	} ), /loopback/ );
	assert.throws( () => worldLinkFromLocation( {
		search: '?localProvider=http%3A%2F%2F127.0.0.1%3A4179&localMap=Great%20Hall&worldId=tw-world%3Atidewater',
		href: 'http://127.0.0.1:5189/',
	} ), /cannot be combined/ );

	const connector = new LocalRegionConnector( link );
	const manifest = await connector.getManifest();
	assert.equal( manifest.title, 'Hogwarts Legacy · Great Hall' );
	assert.deepEqual( manifest.spawn.position, [ 1, 8.62, 9 ] );
	assert.equal( manifest.entryPointActionLabel, 'Choose your house' );
	assert.equal( manifest.entryPointPrompt, 'Which Hogwarts house will you join?' );
	assert.deepEqual( manifest.entryPoints.map( entry => entry.id ), [ 'gryffindor', 'hufflepuff' ] );
	assert.equal( manifest.rules.physicsProfile, 'default' );
	assert.equal( 'seaLevel' in manifest.rules, false, 'local Hogwarts preview does not activate a default waterline' );
	assert.equal( manifest.assets.length, 2, 'all occupied cells should be declared for view-driven loading' );
	assert.equal( manifest.objects.length, 3, 'both cells plus the world-authored preview collider should be present' );
	assert.equal( manifest.assets[ 0 ].id, 'local-region:great-hall:16:0,0,0' );
	assert.equal( manifest.objects[ 0 ].assetId, manifest.assets[ 0 ].id );
	assert.equal( manifest.objects[ 0 ].regionCell, true );
	assert.deepEqual( manifest.objects[ 0 ].streamingBounds.center, [ 8, 8, 8 ] );
	assert.equal( manifest.objects[ 2 ].assetId, null );
	assert.equal( manifest.objects[ 2 ].collision.enabled, true );
	const loaded = await connector.preload();
	assert.equal( loaded.get( manifest.assets[ 0 ].id ).byteLength, bytes.byteLength );
	assert.ok( loaded.get( manifest.assets[ 1 ].id ).byteLength > 20, 'empty cell responses should become a tiny empty GLB and stay loaded' );
	assert.equal( connector.assetBytes, bytes.byteLength + loaded.get( manifest.assets[ 1 ].id ).byteLength );
	assert.equal( connector.releaseAsset( manifest.assets[ 0 ].id ), true );
	assert.equal( connector.assetBytes, loaded.get( manifest.assets[ 1 ].id ).byteLength, 'unloaded cells should release cached browser bytes' );
	assert.equal( await connector.getAsset( manifest.assets[ 0 ].id ).then( value => value.byteLength ), bytes.byteLength );
	assert.equal( cellFetches, 2, 'a released cell should be fetched again on demand' );
	connector.close();
	assert.equal( connector.assets.size, 0 );
	console.log( 'local region connector tests passed' );
} finally {
	globalThis.fetch = originalFetch;
}
