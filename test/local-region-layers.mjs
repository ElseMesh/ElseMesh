import assert from 'node:assert/strict';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';

const descriptor = {
	schema: 'elsemesh.dynamic-region-provider/1', readOnly: true, sourceRevision: 'test-revision', worldId: 'tw-world:test', regions: '/v1/regions',
	entrySelection: {
		schema: 'elsemesh.hogwarts-entry-selection/1', entryPointActionLabel: 'Choose your house', entryPointPrompt: 'Which house?',
		choices: [ { id: 'gryffindor', label: 'Gryffindor' } ], previewSpawn: { position: [ 0, 8, 0 ], yaw: 0 },
		previewRegion: { cell: [ 0, 0, 0 ], cellSizeMeters: 8, startupCells: [ [ 0, 0, 0 ], [ 1, 0, 0 ] ], layers: [ 'Tech', 'Lighting', 'Collision' ] },
	},
};
const regions = [
	{ id: 'main', label: 'GreatHall_Int', asset: '/v1/regions/main' },
	{ id: 'tech', label: 'Tech', asset: '/v1/regions/tech' },
	{ id: 'lighting', label: 'Lighting', asset: '/v1/regions/lighting' },
	{ id: 'collision', label: 'Collision', asset: '/v1/regions/collision' },
];
const cellsByRegion = {
	main: [ { x: 0, y: 0, z: 0 } ],
	tech: [ { x: 0, y: 0, z: 0 } ],
	lighting: [ { x: 1, y: 0, z: 0 } ],
	collision: [],
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
	const request = new URL( url );
	if ( request.pathname.endsWith( '/descriptor' ) ) return new Response( JSON.stringify( descriptor ) );
	if ( request.pathname === '/v1/regions' ) return new Response( JSON.stringify( { regions } ) );
	const regionId = request.pathname.split( '/' )[ 3 ];
	return new Response( JSON.stringify( { sourceRevision: 'test-revision', cellSizeMeters: 8, cells: cellsByRegion[ regionId ] || [] } ) );
};

try {
	const connector = new LocalRegionConnector( { localProvider: 'http://127.0.0.1:4179', localMap: 'GreatHall_Int' } );
	const manifest = await connector.getManifest();
	const cellObjects = manifest.objects.filter( object => object.regionCell );
	assert.deepEqual( cellObjects.map( object => object.label ), [
		'GreatHall_Int cell 0,0,0', 'GreatHall_Int cell 1,0,0', 'Tech cell 0,0,0', 'Lighting cell 1,0,0',
	], 'the manifest combines only occupied cells from each authored layer' );
	assert.equal( connector.initialRegionCellObjectIDs.size, 4, 'primary startup cells and occupied layer startup cells are required before entry' );
	assert.equal( cellObjects.filter( object => object.priority === 'visible' ).length, 4, 'each occupied startup layer receives visible priority' );
	assert.equal( manifest.assets.length, 4, 'each composed region cell has its own streamed asset' );
	connector.close();
} finally {
	globalThis.fetch = originalFetch;
}

console.log( 'ok local region connector composes world-authored region layers' );
