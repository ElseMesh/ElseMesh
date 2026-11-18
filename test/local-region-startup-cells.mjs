import assert from 'node:assert/strict';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';
import { validateWorldExperience } from '../src/network/WorldExperience.js';

const indexedStartupCell = [ 0, 0, 5 ];
const descriptor = {
	schema: 'elsemesh.dynamic-region-provider/1', readOnly: true, sourceRevision: 'test-revision', cacheRevision: 'test-revision:converter-1', worldId: 'elsemesh:test', regions: '/v1/regions', regionScope: { regionIds: [ 'hall' ] },
	entrySelection: {
		entryPointActionLabel: 'Choose your house', entryPointPrompt: 'Which house?',
		playerCapsule: { radiusMeters: 0.42, heightMeters: 1.76 }, movementProfiles: { avatars: { 'elsemesh.avatar.stock-male/1': { stepHeightMeters: 0.6 } } },
		choices: [ { id: 'gryffindor', label: 'Gryffindor' } ],
		experience: {
			genre: 'The Great Hall', tagline: 'Choose your house.', loadingNote: 'Preparing the Hall.', tips: [ 'Nearby rooms load as you explore.' ],
			stages: { world: 'Loading the starting area…' }, navigation: { compass: { north: 'N', east: 'E', south: 'S', west: 'W' }, map: { layers: [ { heightRange: { minY: 0, maxY: 12 }, src: '/v1/presentation/minimap.png', alt: 'Great Hall lower level map', bounds: { minX: -20, maxX: 20, minZ: 50, maxZ: 120 } }, { heightRange: { minY: 12, maxY: 24 }, src: '/v1/presentation/minimap-upper.png', alt: 'Great Hall upper level map', bounds: { minX: -20, maxX: 20, minZ: 50, maxZ: 120 } } ] } }, theme: { logo: { src: '/v1/presentation/logo.svg', alt: 'Castle mark' }, colors: { accent: '#c6a664' } },
		},
		previewSpawn: { position: [ 0, 8.62, 90 ], yaw: 0 },
		previewRegion: { cellSizeMeters: 16, maxViewDistanceMeters: 32 },
	},
};
const originalFetch = globalThis.fetch;
const cellRequests = [];
globalThis.fetch = async ( url, options = {} ) => {
	const requestURL = new URL( url );
	const path = requestURL.pathname;
	if ( path.endsWith( '/cells' ) ) cellRequests.push( { url: requestURL, authorization: new Headers( options.headers ).get( 'Authorization' ), scope: requestURL.searchParams.get( 'scope' ) } );
	const payload = path.endsWith( '/descriptor' ) ? descriptor : path === '/v1/regions' ? { regions: [ { id: 'hall', label: 'Great Hall', asset: '/v1/regions/hall' } ] } : { sourceRevision: 'test-revision', cellSizeMeters: 16, cells: [ { x: 0, y: 0, z: 5 } ] };
	if ( path !== '/v1/descriptor' && path !== '/v1/regions' ) {
		if ( new URL( url ).searchParams.get( 'sourceInventory' ) !== '0' ) payload.collisionSourceInventory = {
			staticMeshComponents: 0, otherPrimitiveComponents: 0, unclassifiedOtherPrimitiveComponents: 0, unindexedOtherPrimitiveComponents: 0,
			unindexedSpatialBoundsComponents: 0, unindexedSpatialBoundsFailures: [], unindexedSpatialBoundsFailuresTruncated: false,
			explicitlyNonQueryOtherPrimitiveComponents: 0, explicitlyNonBlockingForPawnOtherPrimitiveComponents: 0, userVerifiedNonBlockingForPawnOtherPrimitiveComponents: 0,
			audioOnlyPolicyExcludedOtherPrimitiveComponents: 0,
			worldPolicyNonBlockingVolumeComponents: 0,
			noSkeletalCollisionGeometryComponents: 0,
			landscapeHeightfieldCollisionComponents: 0, unresolvedInstancedMeshComponents: 0, otherPrimitiveStatuses: {},
		};
		payload.cells = [ { x: indexedStartupCell[ 0 ], y: indexedStartupCell[ 1 ], z: indexedStartupCell[ 2 ], collisionEvidence: {
			scope: 'all-collision-sources', staticMeshComponentCount: 0, unknownComponents: 0,
			supportedSimpleShapeComponents: 0, explicitlyNonQueryCollidableComponents: 0,
			explicitlyNonBlockingForPawnComponents: 0, staticMeshComponentsClassified: true,
			otherPrimitiveComponentCount: 0, supportedOtherPrimitiveComponents: 0, unknownOtherPrimitiveComponents: 0,
		}, unknownCollisionSources: [] } ].filter( cell => new Set( new URL( url ).searchParams.getAll( 'cell' ) ).has( `${cell.x},${cell.y},${cell.z}` ) );
	}
	return new Response( JSON.stringify( payload ), { status: 200, headers: { 'Content-Type': 'application/json' } } );
};

try {
	const connector = new LocalRegionConnector( { localProvider: 'http://127.0.0.1:4179', localMap: 'hall' } );
	const manifest = await connector.getManifest();
	assert.equal( manifest.title, 'Great Hall', 'providers without an optional title use the selected region label' );
	assert.equal( connector.initialRegionCellObjectIDs.size, 1, 'only an indexed startup collision cell is marked for preload' );
	assert.equal( manifest.objects.filter( object => object.priority === 'visible' && object.regionCell && ! object.collisionPayload ).length, 1, 'only the indexed spawn-capsule cell receives startup priority' );
	assert.equal( connector.emptyCollisionCellsAreVerified, true, 'complete per-layer inventories prove absent cells are empty' );
	assert.equal( manifest.experience.genre, 'The Great Hall', 'the local world controls its loading copy' );
	assert.equal( manifest.experience.theme.logo.src, 'http://127.0.0.1:4179/v1/presentation/logo.svg', 'world logo paths resolve against the local content provider' );
	assert.equal( manifest.experience.navigation.map.layers[ 0 ].src, 'http://127.0.0.1:4179/v1/presentation/minimap.png', 'world minimap layer paths resolve against the local content provider' );
	assert.equal( manifest.experience.navigation.map.layers[ 1 ].src, 'http://127.0.0.1:4179/v1/presentation/minimap-upper.png', 'each floor plan path resolves against the local content provider' );
	assert.equal( manifest.objects.filter( object => object.priority === 'visible' && object.regionCell && object.collisionPayload ).length, 1, 'indexed startup collision cells receive the required-load priority' );
	assert.equal( manifest.objects.filter( object => object.regionCell && object.collisionPayload ).length, 1, 'unindexed empty cells do not create synthetic collision assets' );
	assert.equal( connector.isCollisionPathReady( [ 17, 1, 81 ], [ 18, 1, 81 ], { loadedObjects: new Set() } ), true, 'a path through an absent cell is open when every layer has complete collision coverage' );
	connector.close();

	cellRequests.length = 0;
	const entry = descriptor.entrySelection;
	const validatedExperience = structuredClone( validateWorldExperience( entry.experience ) );
	const hostedConnector = new LocalRegionConnector( {
		localProvider: 'http://127.0.0.1:4179', localMap: 'hall', worldId: 'elsemesh:test', nodeId: 'owner-peer-id-12345678901234567890', gateway: 'http://127.0.0.1:4190',
		createWorldConnector: () => ( {
			getManifest: async () => ( {
				worldId: 'elsemesh:test', ownerPeerId: 'owner-peer-id-12345678901234567890',
				spawn: { position: entry.previewSpawn.position, yaw: entry.previewSpawn.yaw },
				rules: { playerCapsule: entry.playerCapsule, movementProfiles: entry.movementProfiles, spawnRadius: 0 },
				avatarOptions: [], entryPoints: entry.choices, experience: validatedExperience,
				entryPointPrompt: entry.entryPointPrompt, entryPointActionLabel: entry.entryPointActionLabel,
			} ), close() {},
		} ),
	} );
	await hostedConnector.getManifest();
	assert.equal( cellRequests.length, 0, 'hosted descriptor setup does not request cell metadata before owner admission' );
	await assert.rejects( hostedConnector.ensureCells( [ indexedStartupCell ], { purpose: 'collision' } ), /worldd admission capability/, 'hosted region cell requests fail closed until admission' );
	assert.equal( cellRequests.length, 0, 'the pre-admission guard prevents the request from reaching the provider' );
	hostedConnector.setContentCapability( 'a'.repeat( 64 ) );
	await hostedConnector.ensureCells( [ indexedStartupCell ], { purpose: 'collision' } );
	assert.equal( cellRequests.length, 1, 'cell metadata is fetched only after receiving the owner content capability' );
	assert.equal( cellRequests[ 0 ].url.origin, 'http://127.0.0.1:4190', 'authenticated collision cell requests use the worldd gateway' );
	assert.equal( cellRequests[ 0 ].authorization, `Bearer ${'a'.repeat( 64 )}`, 'cell requests carry the owner-issued capability' );
	assert.equal( cellRequests[ 0 ].scope, 'collision', 'collision cell metadata declares its bounded purpose to worldd' );
} finally {
	globalThis.fetch = originalFetch;
}

console.log( 'ok spawn-capsule startup cells are derived without world-specific offsets' );
