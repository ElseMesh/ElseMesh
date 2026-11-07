import assert from 'node:assert/strict';
import { Euler, PerspectiveCamera } from '../src/engine/index.js';
import { LocalRegionConnector } from '../src/network/LocalRegionConnector.js';
import { selectLocalRegionStreamingObjects } from '../src/network/LocalRegionStartup.js';

const requestedCells = [];
const descriptor = {
	schema: 'elsemesh.dynamic-region-provider/1', worldId: 'elsemesh:test-camera-view', sourceRevision: 'source-1',
	cacheRevision: 'source-1:converter-1', readOnly: true, regions: '/v1/regions',
	entrySelection: {
		entryPointActionLabel: 'Enter', entryPointPrompt: 'Enter the room?', choices: [ { id: 'start', label: 'Start' } ],
		previewSpawn: { position: [ 0, 8.62, 90 ], yaw: 180, pitch: - 0.1 },
		previewRegion: { cellSizeMeters: 8, maxViewDistanceMeters: 64 },
	},
};
const collisionSourceInventory = {
	staticMeshComponents: 0, otherPrimitiveComponents: 0, unclassifiedOtherPrimitiveComponents: 0,
	explicitlyNonQueryOtherPrimitiveComponents: 0, explicitlyNonBlockingForPawnOtherPrimitiveComponents: 0,
	userVerifiedNonBlockingForPawnOtherPrimitiveComponents: 0, audioOnlyPolicyExcludedOtherPrimitiveComponents: 0,
	noSkeletalCollisionGeometryComponents: 0, landscapeHeightfieldCollisionComponents: 0,
	unresolvedInstancedMeshComponents: 0, otherPrimitiveStatuses: {},
	unindexedOtherPrimitiveComponents: 0, unindexedOtherPrimitiveObjectPaths: [],
	unindexedOtherPrimitiveObjectPathsTruncated: false, unindexedSpatialBoundsComponents: 0,
	unindexedSpatialBoundsFailures: [], unindexedSpatialBoundsFailuresTruncated: false,
};

const previousFetch = globalThis.fetch;
globalThis.fetch = async input => {
	const url = new URL( input );
	if ( url.pathname.endsWith( '/descriptor' ) ) return Response.json( descriptor );
	if ( url.pathname === '/v1/regions' ) return Response.json( { regions: [ { id: 'hall', label: 'Hall', asset: '/v1/regions/hall' } ] } );
	if ( url.pathname === '/v1/regions/hall/cells' ) {
		requestedCells.push( ...url.searchParams.getAll( 'cell' ) );
		return Response.json( { sourceRevision: 'source-1', cellSizeMeters: 8, collisionSourceInventory, cells: [] } );
	}
	throw new Error( `Unexpected provider request: ${url}` );
};

try {
	const connector = new LocalRegionConnector( { localProvider: 'http://127.0.0.1:4179', localMap: 'Hall' } );
	await connector.getManifest();
	assert.equal( requestedCells.includes( '0,0,15' ), false, 'the four-cell player bubble does not fetch the far-end cell at startup' );
	const camera = new PerspectiveCamera( 60, 1.8, 0.1, 1000 );
	camera.position.set( 0, 8.62, 90 );
	camera.quaternion.setFromEuler( new Euler( - 0.1, Math.PI, 0, 'YXZ' ) );
	await connector.ensureCellsForCamera( camera );
	assert.ok( requestedCells.includes( '0,0,15' ), 'camera-frustum discovery queries the visible far-end cell beyond the player-centered bubble' );

	const visibleManifest = {
		assets: [],
		objects: [
			{ id: 'visible-wall', priority: 'visible', transform: { position: [ 0, 0, 0 ], yaw: 0 }, streamingBounds: { center: [ 0, 8, 120 ], radius: 12, maxDistanceMeters: 64 } },
			{ id: 'visible-wall-collision', priority: 'visible', transform: { position: [ 0, 0, 0 ], yaw: 0 }, collisionPayload: true, streamingBounds: { center: [ 0, 8, 120 ], radius: 12, maxDistanceMeters: 64 } },
		],
	};
	assert.deepEqual( selectLocalRegionStreamingObjects( connector, visibleManifest, camera ).map( object => object.id ), [ 'visible-wall' ], 'background visual streaming does not load view-frustum collision cells ahead of permitted movement' );
	connector.close();
} finally {
	globalThis.fetch = previousFetch;
}

console.log( 'ok local region startup discovers far cells from the camera frustum' );
