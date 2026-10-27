import assert from 'node:assert/strict';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';

const startupCells = [ [ -1, 0, 4 ], [ 0, 0, 4 ], [ 1, 0, 4 ], [ -1, 0, 5 ], [ 0, 0, 5 ], [ 1, 0, 5 ], [ -1, 0, 6 ], [ 0, 0, 6 ], [ 1, 0, 6 ] ];
const descriptor = {
	schema: 'elsemesh.dynamic-region-provider/1', readOnly: true, sourceRevision: 'test-revision', worldId: 'tw-world:test', regions: '/v1/regions',
	entrySelection: {
		schema: 'elsemesh.hogwarts-entry-selection/1', entryPointActionLabel: 'Choose your house', entryPointPrompt: 'Which house?',
		choices: [ { id: 'gryffindor', label: 'Gryffindor' } ],
		experience: {
			genre: 'The Great Hall', tagline: 'Choose your house.', loadingNote: 'Preparing the Hall.', tips: [ 'Nearby rooms load as you explore.' ],
			stages: { world: 'Loading the starting area…' }, theme: { logo: { src: '/v1/presentation/logo.svg', alt: 'Castle mark' }, colors: { accent: '#c6a664' } },
		},
		previewSpawn: { position: [ 0, 8.62, 90 ], yaw: 0 },
		previewRegion: { cell: [ 0, 0, 5 ], cellSizeMeters: 16, startupCells },
	},
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
	const path = new URL( url ).pathname;
	const payload = path.endsWith( '/descriptor' ) ? descriptor : path === '/v1/regions' ? { regions: [ { id: 'hall', label: 'Great Hall', asset: '/v1/regions/hall' } ] } : { sourceRevision: 'test-revision', cellSizeMeters: 16, cells: [ { x: 0, y: 0, z: 5 } ] };
	return new Response( JSON.stringify( payload ), { status: 200, headers: { 'Content-Type': 'application/json' } } );
};

try {
	const connector = new LocalRegionConnector( { localProvider: 'http://127.0.0.1:4179', localMap: 'hall' } );
	const manifest = await connector.getManifest();
	assert.equal( connector.initialRegionCellObjectIDs.size, startupCells.length, 'every world-authored startup cell is marked for preload' );
	assert.equal( manifest.experience.genre, 'The Great Hall', 'the local world controls its loading copy' );
	assert.equal( manifest.experience.theme.logo.src, 'http://127.0.0.1:4179/v1/presentation/logo.svg', 'world logo paths resolve against the local content provider' );
	assert.equal( manifest.objects.filter( object => object.priority === 'visible' && object.regionCell ).length, startupCells.length, 'startup cells receive the required-load priority' );
	assert.equal( manifest.objects.filter( object => object.regionCell ).length, startupCells.length, 'unindexed startup cells are still requested as empty-or-present cells' );
	connector.close();
} finally {
	globalThis.fetch = originalFetch;
}

console.log( 'ok world-authored startup cells are required before local-world entry' );
