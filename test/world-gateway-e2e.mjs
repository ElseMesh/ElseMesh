import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goBuildEnvironment } from './go-build-env.mjs';

const projectRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const daemonDir = path.join( projectRoot, 'server', 'worldd' );
const tempDirectory = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const tempRoot = await mkdtemp( path.join( tempDirectory, 'elsemesh-world-gateway-' ) );
const processes = [];

try {
	const binary = path.join( tempRoot, 'worldd' );
	const build = spawnSync( 'go', [ 'build', '-o', binary, '.' ], { cwd: daemonDir, encoding: 'utf8', timeout: 180000, env: goBuildEnvironment( { GOCACHE: process.env.GOCACHE || path.join( tempDirectory, 'elsemesh-go-build-cache' ), GOMODCACHE: process.env.GOMODCACHE || path.join( tempDirectory, 'elsemesh-go-module-cache' ) } ) } );
	assert.equal( build.status, 0, `worldd build failed:\n${build.stdout}\n${build.stderr}` );

	const ownerData = path.join( tempRoot, 'owner' );
	const cacheData = path.join( tempRoot, 'cache' );
	await Promise.all( [ mkdir( ownerData, { recursive: true, mode: 0o700 } ), mkdir( cacheData, { recursive: true, mode: 0o700 } ) ] );
	const ownerPeerID = runCli( binary, [ '--data', ownerData, '--print-node-id' ] );
	const cachePeerID = runCli( binary, [ '--data', cacheData, '--print-node-id' ] );
	const assetSource = path.join( tempRoot, 'fixture.glb' );
	const assetBytes = Buffer.from( 'ElseMesh live browser-gateway fixture\n'.repeat( 5000 ) );
	await writeFile( assetSource, assetBytes, { mode: 0o600 } );
	const assetID = runCli( binary, [ '--data', ownerData, '--import-asset', assetSource ] );
	const assetHex = assetID.slice( 'sha256:'.length );
	const worldID = 'tw-world:live-gateway-e2e';
	const manifestInput = path.join( tempRoot, 'world-unsigned.json' );
	const manifestPath = path.join( tempRoot, 'world-signed.json' );
	const expiresAt = Math.floor( Date.now() / 1000 ) + 3600;
	await writeFile( manifestInput, JSON.stringify( {
		protocol: 'tidewater.world/2',
		worldId: worldID,
		ownerPeerId: ownerPeerID,
		authorityPeerId: ownerPeerID,
		authorityEpoch: 1,
		discoverable: true,
		version: 1,
		title: 'Live gateway fixture',
		rules: { gravity: 1, maxVisitors: 2, spawnRadius: 8, avatarComplexity: 20000, physicsProfile: 'tidewater-default' },
		assets: [ { id: assetID, bytes: assetBytes.byteLength, kind: 'glb', priority: 'visible' } ],
		objects: [],
		components: [],
		portals: [],
		hosts: [ { peerId: cachePeerID, scopes: [ 'content-cache' ], expiresAt, epoch: 1 } ],
		updatedAt: Math.floor( Date.now() / 1000 ),
	} ), { mode: 0o600 } );
	runCli( binary, [ '--data', ownerData, '--sign-manifest', manifestInput, '--manifest-out', manifestPath ] );

	const ownerP2PPort = await unusedPort();
	const cacheP2PPort = await unusedPort();
	const ownerHTTPPort = await unusedPort();
	const cacheHTTPPort = await unusedPort();
	const owner = startDaemon( binary, [
		'--data', ownerData, '--manifest', manifestPath, '--p2p-port', String( ownerP2PPort ),
		'--http', `127.0.0.1:${ownerHTTPPort}`, '--dht-mode', 'server',
	] );
	await waitForHTTP( `http://127.0.0.1:${ownerHTTPPort}/healthz`, owner );
	const bootstrap = `/ip4/127.0.0.1/tcp/${ownerP2PPort}/p2p/${ownerPeerID}`;
	const cache = startDaemon( binary, [
		'--data', cacheData, '--manifest', manifestPath, '--p2p-port', String( cacheP2PPort ),
		'--http', `127.0.0.1:${cacheHTTPPort}`, '--dht-mode', 'server', '--bootstrap', bootstrap,
		'--cache-from', ownerPeerID, '--cache-sync-interval', '1s',
	] );
	await waitForHTTP( `http://127.0.0.1:${cacheHTTPPort}/healthz`, cache );
	await waitFor( async () => {
		const pathOnCache = path.join( cacheData, 'assets', assetHex );
		try {
			const cached = await readFile( pathOnCache );
			return cached.equals( assetBytes );
		} catch {
			return false;
		}
	}, 'authorized cache to sync and verify the signed asset', [ owner, cache ] );

	const certPath = path.join( tempRoot, 'gateway-cert.pem' );
	const keyPath = path.join( tempRoot, 'gateway-key.pem' );
	const certificate = spawnSync( 'openssl', [ 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE' ], { encoding: 'utf8', timeout: 30000 } );
	assert.equal( certificate.status, 0, `local gateway test certificate generation failed:\n${certificate.stdout}\n${certificate.stderr}` );
	const secureGateway = await createSecureGatewayProxy( cacheHTTPPort, keyPath, certPath );
	try {
		const result = await runConnectorClient( {
			worldID, ownerPeerID, cachePeerID, gateway: secureGateway.url, assetID,
			assetSource, certPath, owner,
		} );
		assert.ok( result.ok, `secure connector client failed: ${result.error || 'unknown error'}` );
		assert.ok( secureGateway.upgrades >= 2, `expected WSS connection and provider-recovery reconnect, saw ${secureGateway.upgrades} upgrades` );
		assert.ok( secureGateway.lookups >= 1, 'provider recovery performs HTTPS world lookup' );
	} finally {
		await new Promise( ( resolve, reject ) => secureGateway.server.close( ( error ) => error ? reject( error ) : resolve() ) );
	}

	console.log( 'ok   live WSS two-visitor spawn admission and capacity, signed manifest, authorized cache recovery, HTTPS provider lookup, and asset SHA-256 verification' );
} finally {
	for ( const child of processes.reverse() ) await stopDaemon( child );
	await rm( tempRoot, { recursive: true, force: true } );
}

async function runConnectorClient( { worldID, ownerPeerID, cachePeerID, gateway, assetID, assetSource, certPath, owner } ) {
	const child = fork( fileURLToPath( new URL( './world-gateway-client.mjs', import.meta.url ) ), [ worldID, ownerPeerID, cachePeerID, gateway, assetID, assetSource ], {
		env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath },
		stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
	} );
	child.output = '';
	child.stdout.setEncoding( 'utf8' ).on( 'data', ( value ) => { child.output += value; } );
	child.stderr.setEncoding( 'utf8' ).on( 'data', ( value ) => { child.output += value; } );
	let ownerStopped = false;
	let result = null;
	child.on( 'message', async ( message ) => {
		if ( message?.type === 'manifest-ready' && ! ownerStopped ) {
			ownerStopped = true;
			try {
				await stopDaemon( owner );
				child.send( { type: 'owner-stopped' } );
			} catch ( error ) {
				child.kill( 'SIGKILL' );
				result = { ok: false, error: `failed to stop owner: ${error}` };
			}
		} else if ( message?.type === 'result' ) {
			result = message;
		}
	} );
	const exitCode = await new Promise( ( resolve, reject ) => {
		const timer = setTimeout( () => { child.kill( 'SIGKILL' ); reject( new Error( `WSS connector client timed out:\n${child.output}` ) ); }, 45000 );
		child.once( 'exit', ( code ) => { clearTimeout( timer ); resolve( code ); } );
		child.once( 'error', ( error ) => { clearTimeout( timer ); reject( error ); } );
	} );
	assert.equal( exitCode, 0, `WSS connector client exited ${exitCode}:\n${child.output}\n${JSON.stringify( result )}` );
	assert.ok( result, `WSS connector client returned no result:\n${child.output}` );
	return result;
}

async function createSecureGatewayProxy( upstreamPort, keyPath, certPath ) {
	let upgrades = 0;
	let lookups = 0;
	const server = https.createServer( { key: await readFile( keyPath ), cert: await readFile( certPath ) }, ( request, response ) => {
		if ( request.url?.startsWith( '/api/lookup' ) ) lookups ++;
		const upstream = http.request( { hostname: '127.0.0.1', port: upstreamPort, method: request.method, path: request.url, headers: request.headers }, ( upstreamResponse ) => {
			response.writeHead( upstreamResponse.statusCode || 502, upstreamResponse.headers );
			upstreamResponse.pipe( response );
		} );
		upstream.on( 'error', () => { if ( ! response.headersSent ) response.writeHead( 502 ); response.end(); } );
		request.pipe( upstream );
	} );
	server.on( 'upgrade', ( request, clientSocket, head ) => {
		upgrades ++;
		const upstream = http.request( { hostname: '127.0.0.1', port: upstreamPort, method: request.method, path: request.url, headers: request.headers } );
		upstream.on( 'upgrade', ( upstreamResponse, upstreamSocket, responseHead ) => {
			clientSocket.write( `HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n` );
			for ( let index = 0; index < upstreamResponse.rawHeaders.length; index += 2 ) clientSocket.write( `${upstreamResponse.rawHeaders[ index ]}: ${upstreamResponse.rawHeaders[ index + 1 ]}\r\n` );
			clientSocket.write( '\r\n' );
			if ( head.length ) upstreamSocket.write( head );
			if ( responseHead.length ) clientSocket.write( responseHead );
			upstreamSocket.pipe( clientSocket );
			clientSocket.pipe( upstreamSocket );
			clientSocket.on( 'error', () => upstreamSocket.destroy() );
			upstreamSocket.on( 'error', () => clientSocket.destroy() );
		} );
		upstream.on( 'response', ( response ) => {
			clientSocket.write( `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` );
			for ( let index = 0; index < response.rawHeaders.length; index += 2 ) clientSocket.write( `${response.rawHeaders[ index ]}: ${response.rawHeaders[ index + 1 ]}\r\n` );
			clientSocket.write( '\r\n' );
			response.pipe( clientSocket );
		} );
		upstream.on( 'error', () => clientSocket.destroy() );
		upstream.end();
	} );
	await new Promise( ( resolve, reject ) => server.listen( 0, '127.0.0.1', resolve ).once( 'error', reject ) );
	const { port } = server.address();
	return { server, url: `https://127.0.0.1:${port}`, get upgrades() { return upgrades; }, get lookups() { return lookups; } };
}

function runCli( binary, args ) {
	const result = spawnSync( binary, args, { encoding: 'utf8', timeout: 30000 } );
	assert.equal( result.status, 0, `${path.basename( binary )} ${args.join( ' ' )} failed:\n${result.stdout}\n${result.stderr}` );
	return result.stdout.trim();
}

function startDaemon( binary, args ) {
	const child = spawn( binary, args, { cwd: daemonDir, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
	child.output = '';
	child.stdout.setEncoding( 'utf8' ).on( 'data', ( value ) => { child.output += value; } );
	child.stderr.setEncoding( 'utf8' ).on( 'data', ( value ) => { child.output += value; } );
	processes.push( child );
	return child;
}

async function waitForHTTP( url, child ) {
	await waitFor( async () => {
		try { return ( await fetch( url, { signal: AbortSignal.timeout( 1000 ) } ) ).ok; }
		catch { return false; }
	}, `${url} readiness`, [ child ] );
}

async function waitFor( condition, label, children = [] ) {
	const deadline = Date.now() + 30000;
	while ( Date.now() < deadline ) {
		for ( const child of children ) assert.equal( child.exitCode, null, `worldd exited while waiting for ${label}:\n${child.output}` );
		if ( await condition() ) return;
		await new Promise( ( resolve ) => setTimeout( resolve, 150 ) );
	}
	assert.fail( `timed out waiting for ${label}${children.length ? `:\n${children.map( ( child ) => child.output ).join( '\n' )}` : ''}` );
}

async function unusedPort() {
	const server = net.createServer();
	await new Promise( ( resolve, reject ) => server.listen( 0, '127.0.0.1', resolve ).once( 'error', reject ) );
	const { port } = server.address();
	await new Promise( ( resolve, reject ) => server.close( ( error ) => error ? reject( error ) : resolve() ) );
	return port;
}

async function stopDaemon( child ) {
	if ( ! child || child.exitCode !== null ) return;
	await new Promise( ( resolve ) => {
		const timer = setTimeout( resolve, 5000 );
		child.once( 'exit', () => { clearTimeout( timer ); resolve(); } );
		child.kill( 'SIGTERM' );
	} );
	if ( child.exitCode === null ) {
		child.kill( 'SIGKILL' );
		await new Promise( ( resolve ) => child.once( 'exit', resolve ) );
	}
}
