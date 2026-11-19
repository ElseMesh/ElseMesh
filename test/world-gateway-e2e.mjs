import assert from 'node:assert/strict';
import { fork, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goBuildEnvironment } from './go-build-env.mjs';
import { handleRequest as handleResolverRequest } from '../cloudflare/world-resolver/src/index.js';

const projectRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const daemonDir = path.join( projectRoot, 'server', 'worldd' );
const tempDirectory = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const tempRoot = await mkdtemp( path.join( tempDirectory, 'elsemesh-world-gateway-' ) );
const processes = [];
globalThis.crypto ||= webcrypto;
let workerGateway;
const liveDirectoryURL = process.env.ELSEMESH_TEST_DIRECTORY_URL || '';
const livePublicGateway = process.env.ELSEMESH_TEST_PUBLIC_GATEWAY || '';
const liveHTTPPort = Number( process.env.ELSEMESH_TEST_HTTP_PORT || 0 );
assert.equal( Boolean( liveDirectoryURL ), Boolean( livePublicGateway ), 'live Worker checks require both a directory URL and public gateway' );
assert.equal( Boolean( liveDirectoryURL ), liveHTTPPort > 0 && liveHTTPPort <= 65535, 'live Worker checks require a valid fixed local HTTP port for the gateway tunnel' );

class MemoryKV {
	values = new Map();
	async put( key, value ) { this.values.set( key, value ); }
	async get( key ) { return this.values.get( key ) ?? null; }
	async list( { prefix } ) { return { keys: [ ...this.values.keys() ].filter( name => name.startsWith( prefix ) ).map( name => ( { name } ) ), list_complete: true }; }
}

try {
	const configuredBinary = process.env.ELSEMESH_TEST_WORLDD_BINARY;
	const binary = configuredBinary ? path.resolve( configuredBinary ) : path.join( tempRoot, 'worldd' );
	if ( configuredBinary ) {
		const version = spawnSync( binary, [ '--version' ], { encoding: 'utf8', timeout: 30000 } );
		assert.equal( version.status, 0, `configured worldd binary is not executable:\n${version.stdout}\n${version.stderr}` );
	} else {
		const build = spawnSync( 'go', [ 'build', '-o', binary, '.' ], { cwd: daemonDir, encoding: 'utf8', timeout: 180000, env: goBuildEnvironment() } );
		assert.equal( build.status, 0, `worldd build failed:\n${build.stdout}\n${build.stderr}` );
	}

	const ownerData = path.join( tempRoot, 'owner' );
	const cacheData = path.join( tempRoot, 'cache' );
	const ownerZeroTierData = path.join( tempRoot, 'owner-zerotier' );
	const cacheZeroTierData = path.join( tempRoot, 'cache-zerotier' );
	await Promise.all( [ mkdir( ownerData, { recursive: true, mode: 0o700 } ), mkdir( cacheData, { recursive: true, mode: 0o700 } ), mkdir( ownerZeroTierData, { recursive: true, mode: 0o700 } ), mkdir( cacheZeroTierData, { recursive: true, mode: 0o700 } ) ] );
	const ownerPeerID = runCli( binary, [ '--data', ownerData, '--print-node-id' ] );
	const cachePeerID = runCli( binary, [ '--data', cacheData, '--print-node-id' ] );
	const assetSource = path.join( tempRoot, 'fixture.glb' );
	const assetBytes = Buffer.from( 'ElseMesh live browser-gateway fixture\n'.repeat( 5000 ) );
	await writeFile( assetSource, assetBytes, { mode: 0o600 } );
	const assetID = runCli( binary, [ '--data', ownerData, '--import-asset', assetSource ] );
	const assetHex = assetID.slice( 'sha256:'.length );
	const worldID = liveDirectoryURL ? `elsemesh:live-gateway-${Date.now().toString( 36 )}` : 'elsemesh:live-gateway-e2e';
	const manifestInput = path.join( tempRoot, 'world-unsigned.json' );
	const manifestPath = path.join( tempRoot, 'world-signed.json' );
	const expiresAt = Math.floor( Date.now() / 1000 ) + 3600;
	await writeFile( manifestInput, JSON.stringify( {
		protocol: 'elsemesh.world/3',
		worldId: worldID,
		ownerPeerId: ownerPeerID,
		authorityPeerId: ownerPeerID,
		authorityEpoch: 1,
		discoverable: true,
		version: 1,
		title: 'Live gateway fixture',
		rules: { gravity: 1, maxVisitors: 2, spawnRadius: 8, avatarComplexity: 20000, physicsProfile: 'elsemesh-default' },
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
	const ownerHTTPPort = liveHTTPPort || await unusedPort();
	const cacheHTTPPort = await unusedPort();
	const certPath = path.join( tempRoot, 'gateway-cert.pem' );
	const keyPath = path.join( tempRoot, 'gateway-key.pem' );
	const certificate = spawnSync( 'openssl', [ 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE' ], { encoding: 'utf8', timeout: 30000 } );
	assert.equal( certificate.status, 0, `local gateway test certificate generation failed:\n${certificate.stdout}\n${certificate.stderr}` );
	workerGateway = await createSecureGatewayProxy( cacheHTTPPort, keyPath, certPath );
	const ownerArgs = [
		'--data', ownerData, '--zerotier-data', ownerZeroTierData, '--manifest', manifestPath, '--p2p-port', String( ownerP2PPort ),
		'--http', `127.0.0.1:${ownerHTTPPort}`, '--dht-mode', 'server',
	];
	if ( liveDirectoryURL ) ownerArgs.push( '--public-gateway', livePublicGateway, '--directory-url', liveDirectoryURL );
	const owner = startDaemon( binary, ownerArgs );
	await waitForHTTP( `http://127.0.0.1:${ownerHTTPPort}/healthz`, owner );
	if ( liveDirectoryURL ) {
		const nodeResponse = await fetch( `http://127.0.0.1:${ownerHTTPPort}/.well-known/elsemesh/node` );
		assert.equal( nodeResponse.status, 200, 'live owner worldd exposes its signed provider record' );
		const ownerNode = await nodeResponse.json();
		assert.equal( ownerNode.payload.nodeId, ownerPeerID );
		assert.equal( ownerNode.payload.gateway, livePublicGateway );
		assert.match( ownerNode.payload.zeroTierNodeId || '', /^[0-9a-f]{10}$/ );
		assert.equal( ownerNode.payload.zeroTierNetworkId, 'e3918db4832a3056' );
		const liveResult = await runWorkerDiscoveryClient( {
			worldID, ownerPeerID, cachePeerID: ownerPeerID, zeroTierNodeID: ownerNode.payload.zeroTierNodeId,
			zeroTierNetworkID: ownerNode.payload.zeroTierNetworkId, directory: liveDirectoryURL,
			assetID, assetSource, certPath,
		} );
		assert.ok( liveResult.ok, `deployed Worker lookup to the public worldd gateway failed: ${liveResult.error || 'unknown error'}\nworldd log:\n${owner.output}` );
		assert.equal( liveResult.nodeId, ownerPeerID, 'deployed Worker lookup selects the live worldd owner' );
		assert.equal( liveResult.gateway, livePublicGateway, 'the client uses the signed public gateway, not the Worker, for world traffic' );
		console.log( 'ok   deployed Worker HostID lookup connects directly to the temporary public worldd gateway' );
	}
	const bootstrap = `/ip4/127.0.0.1/tcp/${ownerP2PPort}/p2p/${ownerPeerID}`;
	const cache = startDaemon( binary, [
		'--data', cacheData, '--zerotier-data', cacheZeroTierData, '--manifest', manifestPath, '--p2p-port', String( cacheP2PPort ),
		'--http', `127.0.0.1:${cacheHTTPPort}`, '--public-gateway', workerGateway.url, '--dht-mode', 'server', '--bootstrap', bootstrap,
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

	let resolverServer;
	try {
		const nodeResponse = await fetch( `http://127.0.0.1:${cacheHTTPPort}/.well-known/elsemesh/node` );
		if ( nodeResponse.status !== 200 ) throw new Error( `running worldd did not provide its signed node record: ${await nodeResponse.text()}` );
		const resolverNode = await nodeResponse.json();
		assert.equal( resolverNode.protocol, 'elsemesh.node/1' );
		assert.equal( resolverNode.payload.nodeId, cachePeerID, 'the signed advertisement belongs to the running worldd provider' );
		assert.equal( resolverNode.payload.gateway, workerGateway.url, 'worldd advertises its actual HTTPS/WSS gateway' );
		const zeroTierStartup = cache.output.split( '\n' ).filter( line => /ZeroTier/i.test( line ) ).map( line => line.replace( /\b(?:\d{1,3}\.){1,3}\d{1,3}\b/g, '<IPv4>' ) ).join( '\n' );
		assert.match( resolverNode.payload.zeroTierNodeId || '', /^[0-9a-f]{10}$/, `worldd advertises its embedded libzt HostID (network=${resolverNode.payload.zeroTierNetworkId || '<none>'})\nZeroTier startup diagnostics:\n${zeroTierStartup || '<none>'}\nworldd arguments: ${cache.spawnargs.join( ' ' )}` );
		assert.equal( resolverNode.payload.zeroTierNetworkId, 'e3918db4832a3056', 'worldd joined the configured network through embedded libzt' );
		const resolverState = { PROVIDERS: new MemoryKV() };
		const resolverManifest = JSON.parse( await readFile( manifestPath, 'utf8' ) );
		const announcement = await handleResolverRequest( new Request( 'https://resolver.example/v1/announce', {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify( { node: resolverNode, manifest: resolverManifest } ),
		} ), resolverState );
		assert.equal( announcement.status, 202, `Worker contract rejected the live cache node advertisement: ${await announcement.text()}` );
		const zeroTierNodeID = resolverNode.payload.zeroTierNodeId;
		const lookup = await handleResolverRequest( new Request( `https://resolver.example/v1/zerotier/e3918db4832a3056/${zeroTierNodeID}` ), resolverState );
		const lookupResult = await lookup.json();
		assert.equal( lookup.status, 200 );
		assert.deepEqual( lookupResult.providers, [ resolverNode ], 'HostID discovery returns the signed live worldd provider record' );
		resolverServer = await createResolverServer( resolverState, keyPath, certPath );

		const result = await runWorkerDiscoveryClient( {
			worldID, ownerPeerID, cachePeerID, zeroTierNodeID,
			zeroTierNetworkID: 'e3918db4832a3056', directory: resolverServer.url,
			assetID, assetSource, certPath,
		} );
		assert.ok( result.ok, `Worker-discovered WSS connector failed: ${result.error || 'unknown error'}\nworldd cache log:\n${cache.output}` );
		assert.equal( result.nodeId, cachePeerID, 'HostID lookup connects directly to the advertised worldd peer' );
		assert.equal( result.gateway, workerGateway.url, 'worldd traffic uses its HTTPS/WSS gateway, not the resolver' );
		assert.equal( resolverServer.lookups, 1, 'the resolver handles only the HostID lookup' );
		assert.ok( workerGateway.upgrades >= 1, 'the client opens a direct WSS session to worldd after lookup' );
	} finally {
		await Promise.all( [
			resolverServer && new Promise( ( resolve, reject ) => resolverServer.server.close( ( error ) => error ? reject( error ) : resolve() ) ),
			new Promise( ( resolve, reject ) => workerGateway.server.close( ( error ) => error ? reject( error ) : resolve() ) ),
		].filter( Boolean ) );
	}

	console.log( 'ok   live WSS admission and recovery plus Worker lookup using the actual embedded-libzt HostID' );
} finally {
	for ( const child of processes.reverse() ) await stopDaemon( child );
	if ( workerGateway?.server.listening ) await new Promise( resolve => workerGateway.server.close( resolve ) );
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

async function createResolverServer( env, keyPath, certPath ) {
	let lookups = 0;
	const server = https.createServer( { key: await readFile( keyPath ), cert: await readFile( certPath ) }, async ( incoming, outgoing ) => {
		try {
			const chunks = [];
			for await ( const chunk of incoming ) chunks.push( chunk );
			const body = chunks.length ? Buffer.concat( chunks ) : undefined;
			const headers = new Headers();
			for ( const [ name, value ] of Object.entries( incoming.headers ) ) if ( value !== undefined ) headers.set( name, Array.isArray( value ) ? value.join( ', ' ) : value );
			const requestURL = new URL( incoming.url || '/', `https://${incoming.headers.host || 'resolver.local'}` );
			if ( requestURL.pathname.startsWith( '/v1/zerotier/' ) ) lookups ++;
			const response = await handleResolverRequest( new Request( requestURL, { method: incoming.method, headers, ...( body ? { body } : {} ) } ), env );
			outgoing.writeHead( response.status, Object.fromEntries( response.headers.entries() ) );
			outgoing.end( Buffer.from( await response.arrayBuffer() ) );
		} catch ( error ) {
			outgoing.writeHead( 500 );
			outgoing.end( error instanceof Error ? error.message : 'resolver test failure' );
		}
	} );
	await new Promise( ( resolve, reject ) => server.listen( 0, '127.0.0.1', resolve ).once( 'error', reject ) );
	return { server, url: `https://127.0.0.1:${server.address().port}`, get lookups() { return lookups; } };
}

async function runWorkerDiscoveryClient( options ) {
	const child = spawn( process.execPath, [ fileURLToPath( new URL( './world-gateway-worker-client.mjs', import.meta.url ) ), JSON.stringify( options ) ], {
		env: { ...process.env, ...( options.certPath ? { NODE_EXTRA_CA_CERTS: options.certPath } : {} ) },
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );
	child.output = '';
	child.stdout.setEncoding( 'utf8' ).on( 'data', value => { child.output += value; } );
	child.stderr.setEncoding( 'utf8' ).on( 'data', value => { child.output += value; } );
	const exitCode = await new Promise( ( resolve, reject ) => {
		const timer = setTimeout( () => { child.kill( 'SIGKILL' ); reject( new Error( `Worker-discovery connector timed out:\n${child.output}` ) ); }, 45000 );
		child.once( 'exit', code => { clearTimeout( timer ); resolve( code ); } );
		child.once( 'error', error => { clearTimeout( timer ); reject( error ); } );
	} );
	assert.equal( exitCode, 0, `Worker-discovery connector exited ${exitCode}:\n${child.output}` );
	return JSON.parse( child.output.trim().split( '\n' ).at( -1 ) );
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
