import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WorldConnector } from '../src/network/WorldConnector.js';
import { PLAYER_PRESENCE_PROTOCOL } from '../src/network/PlayerPresence.js';

const [ worldID, ownerPeerID, cachePeerID, gateway, assetID, assetPath ] = process.argv.slice( 2 );
const connector = new WorldConnector( { worldId: worldID, nodeId: ownerPeerID, gateway, chunkBytes: 64 * 1024 } );

try {
	const manifest = await connector.getManifest();
	assert.equal( manifest.ownerPeerId, ownerPeerID, 'connector verifies the owner-signed manifest through HTTPS/WSS' );
	assert.equal( connector.nodeId, ownerPeerID, 'initial manifest is served by the requested owner peer' );

	const pose = { protocol: PLAYER_PRESENCE_PROTOCOL, sequence: 1, position: [ 0, 1.38, 8 ], yaw: 0, pitch: 0, moving: false, mode: 'walk', avatarProfileId: 'elsemesh.avatar.stock-male/1', appearance: { style: 'male', shirt: '#7194aa', trousers: '#27313d', skin: '#c68c67', hair: '#33251c' } };
	const spawnCandidates = [ [ 0, 1.38, 8 ], [ 0.6, 1.38, 8 ], [ -0.6, 1.38, 8 ], [ 0, 1.38, 8.6 ], [ 0, 1.38, 7.4 ] ];
	const own = await connector.updatePresence( pose, { spawnCandidates } );
	const ownPose = own.players.find( ( player ) => player.id === own.playerId );
	assert.deepEqual( ownPose.position, [ 0, 1.38, 8 ], 'first WSS visitor keeps the preferred spawn position' );
	const observer = new WorldConnector( { worldId: worldID, nodeId: ownerPeerID, gateway } );
	try {
		await observer.getManifest();
		const shared = await observer.updatePresence( pose, { spawnCandidates } );
		assert.notEqual( shared.playerId, own.playerId, 'production connectors receive distinct session-bound player IDs' );
		assert.equal( shared.players.length, 2, 'production WSS connections share owner presence' );
		const observerPose = shared.players.find( ( player ) => player.id === shared.playerId );
		const sharedOwnPose = shared.players.find( ( player ) => player.id === own.playerId );
		assert.deepEqual( observerPose.position, [ 0.6, 1.38, 8 ], 'simultaneous WSS visitor is assigned the nearest unoccupied candidate' );
		assert.deepEqual( sharedOwnPose.position, [ 0, 1.38, 8 ], 'snapshot retains the first visitor at the preferred position' );
		const capped = new WorldConnector( { worldId: worldID, nodeId: ownerPeerID, gateway } );
		try {
			await capped.getManifest();
			await assert.rejects( () => capped.updatePresence( pose, { spawnCandidates } ), /presence_full/, 'owner gateway enforces the signed world visitor cap' );
		} finally { capped.close(); }
		await observer.leavePresence();
	} finally { observer.close(); }
	await connector.leavePresence();
	process.send( { type: 'manifest-ready' } );
	await new Promise( ( resolve, reject ) => {
		const timeout = setTimeout( () => reject( new Error( 'owner shutdown signal timed out' ) ), 15000 );
		process.once( 'message', ( message ) => {
			clearTimeout( timeout );
			if ( message?.type === 'owner-stopped' ) resolve();
			else reject( new Error( 'unexpected parent test message' ) );
		} );
	} );

	const downloaded = await connector.getAsset( assetID );
	const expected = await readFile( assetPath );
	assert.deepEqual( Buffer.from( downloaded ), expected, 'connector verifies the recovered content-addressed asset hash' );
	assert.equal( connector.nodeId, cachePeerID, 'provider recovery selects the live cache peer after owner shutdown' );
	assert.equal( connector.manifest.ownerPeerId, ownerPeerID, 'cache serves the unchanged owner-signed manifest' );
	await assert.rejects( () => connector.updatePresence( pose ), /presence_owner_required/, 'immutable cache permission does not grant live player authority' );
	process.send( { type: 'result', ok: true, recoveredFrom: connector.nodeId } );
} catch ( error ) {
	process.send( { type: 'result', ok: false, error: error.stack || String( error ) } );
	process.exitCode = 1;
} finally {
	connector.close();
}
