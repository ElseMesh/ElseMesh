import assert from 'node:assert/strict';
import { WorldConnector } from '../src/network/WorldConnector.js';

const options = JSON.parse( process.argv[ 2 ] );
const connector = new WorldConnector( {
	worldId: options.worldID,
	zeroTierNodeId: options.zeroTierNodeID,
	zeroTierNetworkId: options.zeroTierNetworkID,
	directory: options.directory,
	chunkBytes: 64 * 1024,
} );

try {
	const manifest = await connector.getManifest();
	assert.equal( manifest.worldId, options.worldID, 'the Worker-discovered provider serves the requested world' );
	assert.equal( manifest.ownerPeerId, options.ownerPeerID, 'worldd returns and the browser verifies the owner-signed manifest' );
	assert.equal( connector.nodeId, options.cachePeerID, 'the client selected the signed Worker-advertised node' );
	process.stdout.write( `${JSON.stringify( { ok: true, nodeId: connector.nodeId, gateway: connector.gateway } )}\n` );
} catch ( error ) {
	process.stdout.write( `${JSON.stringify( { ok: false, error: error.stack || String( error ) } )}\n` );
	process.exitCode = 1;
} finally {
	connector.close();
}
