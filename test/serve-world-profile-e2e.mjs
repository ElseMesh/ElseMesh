import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WorldConnector } from '../src/network/WorldConnector.js';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const burningHorizonsRoot = process.env.BURNING_HORIZONS_DIR ? path.resolve( process.env.BURNING_HORIZONS_DIR ) : null;
if ( ! burningHorizonsRoot ) {
	console.log( 'skip two-world portal profile test: set BURNING_HORIZONS_DIR to a separate Burning Horizons checkout' );
	process.exit( 0 );
}
const tempBase = process.env.PREFIX?.startsWith( '/data/data/' ) ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const tempRoot = await mkdtemp( path.join( tempBase, 'elsemesh-profile-e2e-' ) );
const children = [];

async function unusedPort() {
	const server = net.createServer();
	await new Promise( ( resolve, reject ) => server.once( 'error', reject ).listen( 0, '127.0.0.1', resolve ) );
	const { port } = server.address();
	await new Promise( resolve => server.close( resolve ) );
	return port;
}

function startProfile( binary, worldsDir, profile, sourcePath, assetsPath, httpPort, p2pPort, { discoverable = false, bootstrap = [], allowedBrowserOrigins = [], dhtMode = 'auto' } = {} ) {
	const args = [ 'tools/serve-world-profile.mjs', '--worldd', binary, '--worlds-dir', worldsDir, '--profile', profile ];
	if ( sourcePath && assetsPath ) args.push( '--source', sourcePath, '--assets', assetsPath );
	if ( discoverable ) args.push( '--discoverable', 'true' );
	args.push( '--dht-mode', dhtMode );
	for ( const address of bootstrap ) args.push( '--bootstrap', address );
	for ( const origin of allowedBrowserOrigins ) args.push( '--allow-browser-origin', origin );
	args.push( '--http', `127.0.0.1:${httpPort}`, '--p2p-port', String( p2pPort ) );
	const child = spawn( process.execPath, args, { cwd: root, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
	child.commandLine = `${process.execPath} ${args.join( ' ' )}`;
	child.output = '';
	child.stdout.setEncoding( 'utf8' ).on( 'data', data => child.output += data );
	child.stderr.setEncoding( 'utf8' ).on( 'data', data => child.output += data );
	children.push( child );
	return child;
}

async function stop( child ) {
	if ( child.exitCode !== null ) return;
	await new Promise( resolve => {
		const timeout = setTimeout( () => { child.kill( 'SIGKILL' ); resolve(); }, 5000 );
		child.once( 'exit', () => { clearTimeout( timeout ); resolve(); } );
		child.kill( 'SIGTERM' );
	} );
}

async function waitForWorld( child, port, expectedWorldID ) {
	const deadline = Date.now() + 30000;
	let lastError;
	while ( Date.now() < deadline ) {
		if ( child.exitCode !== null ) throw new Error( `Profile process exited early (${child.exitCode}):\n${child.output}` );
		try {
			const response = await fetch( `http://127.0.0.1:${port}/api/world/manifest`, { signal: AbortSignal.timeout( 1500 ) } );
			if ( response.ok ) {
				const { document } = await response.json();
				const payload = typeof document.payload === 'string' ? JSON.parse( document.payload ) : document.payload;
				assert.equal( payload.worldId, expectedWorldID );
				return payload;
			}
			lastError = new Error( `manifest endpoint returned HTTP ${response.status}` );
		} catch ( error ) { lastError = error; }
		await delay( 100 );
	}
	throw new Error( `Timed out waiting for ${expectedWorldID}: ${lastError};\n${child.output}` );
}

async function waitForProvider( child, otherChild, port, otherPort, worldID, peerID ) {
	const deadline = Date.now() + 30000;
	let lastResult = 'lookup has not returned a provider';
	let healthState = 'not read';
	while ( Date.now() < deadline ) {
		if ( child.exitCode !== null ) throw new Error( `Provider node exited early (${child.exitCode}):\n${child.output}` );
		try {
			const response = await fetch( `http://127.0.0.1:${port}/api/lookup?worldId=${encodeURIComponent( worldID )}`, { signal: AbortSignal.timeout( 1500 ) } );
			if ( response.ok ) {
				const result = await response.json();
				if ( result.providers?.includes( peerID ) ) return;
				lastResult = JSON.stringify( result );
			} else lastResult = `HTTP ${response.status}`;
		} catch ( error ) { lastResult = String( error ); }
		try {
			const response = await fetch( `http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout( 1000 ) } );
			healthState = response.ok ? JSON.stringify( await response.json() ) : `HTTP ${response.status}`;
		} catch ( error ) { healthState = String( error ); }
		try {
			const response = await fetch( `http://127.0.0.1:${otherPort}/healthz`, { signal: AbortSignal.timeout( 1000 ) } );
			healthState += `; cave ${response.ok ? JSON.stringify( await response.json() ) : `HTTP ${response.status}`}`;
		} catch ( error ) { healthState += `; cave ${String( error )}`; }
		await delay( 250 );
	}
	throw new Error( `DHT did not publish ${worldID} provider ${peerID}: ${lastResult}; gateway health ${healthState}\nGateway command: ${child.commandLine}\nGateway node:\n${child.output}\nCave command: ${otherChild.commandLine}\nCave node:\n${otherChild.output}` );
}

try {
	const binary = path.join( tempRoot, 'worldd' );
	const build = spawnSync( 'go', [ 'build', '-o', binary, '.' ], { cwd: path.join( root, 'server/worldd' ), encoding: 'utf8', timeout: 180000 } );
	assert.equal( build.status, 0, `worldd build failed:\n${build.stdout}\n${build.stderr}` );
	const worldsDir = path.join( tempRoot, 'worlds' );
	const islandAssets = path.join( root, 'worlds/tidewater/assets' );
	const islandSource = JSON.parse( await readFile( path.join( root, 'worlds/tidewater/world-source.json' ), 'utf8' ) );
	const caveSourcePath = path.join( burningHorizonsRoot, 'world-source.json' );
	const caveSource = JSON.parse( await readFile( caveSourcePath, 'utf8' ) );
	const caveAssets = path.join( burningHorizonsRoot, 'assets' );
	const firstPeerID = spawnSync( binary, [ '--worlds-dir', worldsDir, '--world-profile', 'first-world', '--print-node-id' ], { encoding: 'utf8' } );
	assert.equal( firstPeerID.status, 0, `could not initialize the island profile identity:\n${firstPeerID.stderr}` );
	const secondPeerID = spawnSync( binary, [ '--worlds-dir', worldsDir, '--world-profile', 'burning-horizons', '--print-node-id' ], { encoding: 'utf8' } );
	assert.equal( secondPeerID.status, 0, `could not initialize the cave profile identity:\n${secondPeerID.stderr}` );
	const firstHTTP = await unusedPort();
	const secondHTTP = await unusedPort();
	const firstP2P = await unusedPort();
	const secondP2P = await unusedPort();
	let first = startProfile( binary, worldsDir, 'first-world', path.join( root, 'worlds/tidewater/world-source.json' ), islandAssets, firstHTTP, firstP2P, { discoverable: true, allowedBrowserOrigins: [ 'http://127.0.0.1:5189' ], dhtMode: 'server' } );
	const firstManifest = await waitForWorld( first, firstHTTP, islandSource.worldId );
	const second = startProfile( binary, worldsDir, 'burning-horizons', caveSourcePath, caveAssets, secondHTTP, secondP2P, {
		discoverable: true,
		dhtMode: 'server',
		allowedBrowserOrigins: [ 'http://127.0.0.1:5189' ],
		bootstrap: [ `/ip4/127.0.0.1/tcp/${firstP2P}/p2p/${firstPeerID.stdout.trim()}` ],
	} );
	const secondManifest = await waitForWorld( second, secondHTTP, caveSource.worldId );
	assert.notEqual( firstManifest.ownerPeerId, secondManifest.ownerPeerId, 'profiles use independent persistent owner identities' );
	assert.equal( firstManifest.discoverable, true );
	assert.equal( secondManifest.discoverable, true );
	assert.equal( secondPeerID.stdout.trim(), secondManifest.ownerPeerId, 'the pre-created cave identity is the owner identity used by the hosted profile' );
	assert.equal( firstManifest.portals[ 0 ].destinationWorldId, secondManifest.worldId, 'the island profile carries a signed portal to the LOZ-derived cave world' );
	assert.equal( firstManifest.portals[ 0 ].destinationPeerId, undefined, 'the portal resolves the cave provider by stable world ID without pinning its node' );
	assert.equal( secondManifest.portals[ 0 ].destinationWorldId, firstManifest.worldId, 'the cave profile carries the reciprocal signed portal to the example island' );
	assert.equal( secondManifest.portals[ 0 ].destinationPeerId, undefined, 'the cave resolves the island provider by stable world ID without pinning its node' );
	await waitForProvider( first, second, firstHTTP, secondHTTP, caveSource.worldId, secondManifest.ownerPeerId );
	const islandConnector = new WorldConnector( { worldId: firstManifest.worldId, nodeId: firstManifest.ownerPeerId, gateway: `http://127.0.0.1:${firstHTTP}` } );
	try {
		const island = await islandConnector.getManifest();
		const prepared = await islandConnector.preparePortal( island.portals[ 0 ] );
		try {
			assert.equal( prepared.manifest.worldId, caveSource.worldId, 'live portal preparation discovers and verifies the separate cave world' );
			assert.equal( prepared.connector.nodeId, secondManifest.ownerPeerId, 'DHT provider discovery selected the cave profile owner' );
			assert.ok( prepared.previewAssetIDs.has( caveSource.objects[ 0 ].assetId ), 'the cave GLB is downloaded in the portal-preview stage before crossing' );
			assert.ok( prepared.assets.has( caveSource.objects[ 0 ].assetId ), 'the destination scene asset is ready before crossing' );
		} finally { prepared.connector.close(); }
	} finally { islandConnector.close(); }
	await stop( first );
	first = startProfile( binary, worldsDir, 'first-world', null, null, firstHTTP, firstP2P, { discoverable: true, dhtMode: 'server' } );
	const restartedManifest = await waitForWorld( first, firstHTTP, islandSource.worldId );
	assert.equal( restartedManifest.ownerPeerId, firstManifest.ownerPeerId, 'restarting a profile keeps its owner identity and manifest' );
	const profiles = spawnSync( binary, [ '--worlds-dir', worldsDir, '--list-world-profiles' ], { encoding: 'utf8' } );
	assert.equal( profiles.status, 0, profiles.stderr );
	assert.deepEqual( profiles.stdout.trim().split( '\n' ).sort(), [ 'first-world', 'burning-horizons' ] );
	console.log( 'example island and LOZ cave packages were served as separate worlds; the live browser connector discovered, verified and prefetched the cave through the island portal' );
} finally {
	await Promise.all( children.map( stop ) );
	await rm( tempRoot, { recursive: true, force: true } );
}
