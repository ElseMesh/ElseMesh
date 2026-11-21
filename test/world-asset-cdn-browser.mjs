import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:https';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function chromiumPath() {
	if ( process.env.ELSEMESH_TEST_CHROMIUM ) return process.env.ELSEMESH_TEST_CHROMIUM;
	for ( const executable of [ 'chromium', 'chromium-browser', 'google-chrome' ] ) for ( const directory of ( process.env.PATH || '' ).split( ':' ) ) {
		const candidate = join( directory, executable );
		try { accessSync( candidate, constants.X_OK ); return candidate; } catch {}
	}
	throw new Error( 'Chromium is required; set ELSEMESH_TEST_CHROMIUM to its executable path' );
}

const wait = milliseconds => new Promise( resolveWait => setTimeout( resolveWait, milliseconds ) );
const temporaryRoot = process.env.PREFIX ? join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const profile = mkdtempSync( join( temporaryRoot, 'elsemesh-world-asset-cdn-browser-' ) );
const certificate = join( profile, 'localhost.crt' ), key = join( profile, 'localhost.key' );
const generated = spawnSync( 'openssl', [ 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1' ], { encoding: 'utf8' } );
if ( generated.status !== 0 ) throw new Error( `Could not generate isolated browser test certificate: ${generated.stderr}` );

const helperPath = resolve( fileURLToPath( new URL( '../src/network/WorldAssetCDN.js', import.meta.url ) ) );
const assetBytes = Buffer.from( 'one shared CDN asset fetched by two worlds' );
const digest = createHash( 'sha256' ).update( assetBytes ).digest( 'hex' );
const requests = new Map();
const assetRequests = [];
const html = '<!doctype html><meta charset="utf-8"><title>ElseMesh shared CDN cache check</title><p>Isolated cache check</p>';
const server = createServer( { key: readFileSync( key ), cert: readFileSync( certificate ) }, ( request, response ) => {
	const pathname = new URL( request.url, 'https://127.0.0.1' ).pathname;
	if ( pathname === '/' ) {
		response.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } );
		response.end( html );
	} else if ( pathname === '/WorldAssetCDN.js' ) {
		response.writeHead( 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } );
		response.end( readFileSync( helperPath ) );
	} else if ( pathname === `/sha256/${digest}` ) {
		requests.set( pathname, ( requests.get( pathname ) || 0 ) + 1 );
		assetRequests.push( { method: request.method, cacheControl: request.headers[ 'cache-control' ] || '', pragma: request.headers.pragma || '', ifNoneMatch: request.headers[ 'if-none-match' ] || '' } );
		response.writeHead( 200, {
			'Content-Type': 'application/octet-stream',
			'Content-Length': assetBytes.byteLength,
			'Cache-Control': 'public, max-age=31536000, immutable',
			'Access-Control-Allow-Origin': '*',
			'ETag': `"${digest}"`,
		} );
		response.end( assetBytes );
	} else {
		response.writeHead( 404, { 'Cache-Control': 'no-store' } );
		response.end();
	}
} );

let browser = null, socket = null;
async function stopBrowser() {
	if ( browser && browser.exitCode === null && browser.signalCode === null ) {
		try { process.kill( -browser.pid, 'SIGTERM' ); } catch {}
		await Promise.race( [ new Promise( resolveClose => browser.once( 'close', resolveClose ) ), wait( 1500 ) ] );
		if ( browser.exitCode === null && browser.signalCode === null ) try { process.kill( -browser.pid, 'SIGKILL' ); } catch {}
	}
	socket?.close();
	socket = null;
}

try {
	await new Promise( ( resolveListen, reject ) => {
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', resolveListen );
	} );
	const port = server.address().port;
	browser = spawn( chromiumPath(), [
		'--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions',
		'--disable-background-networking', '--disable-sync', '--no-proxy-server', '--ignore-certificate-errors',
		'--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1',
		'--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
	], { detached: true, stdio: 'ignore' } );
	const activePort = join( profile, 'DevToolsActivePort' ), launchDeadline = Date.now() + 10000;
	while ( ! existsSync( activePort ) && Date.now() < launchDeadline ) {
		if ( browser.exitCode !== null ) throw new Error( `Isolated Chromium exited before DevTools started (${browser.exitCode})` );
		await wait( 50 );
	}
	assert.ok( existsSync( activePort ), 'isolated Chromium starts with its dedicated profile' );
	const [ devtoolsPort ] = readFileSync( activePort, 'utf8' ).trim().split( /\r?\n/ );
	const targetsResponse = await fetch( `http://127.0.0.1:${devtoolsPort}/json/list` );
	assert.equal( targetsResponse.ok, true );
	const page = ( await targetsResponse.json() ).find( target => target.type === 'page' && target.webSocketDebuggerUrl );
	assert.ok( page, 'isolated Chromium exposes its page target' );
	socket = new WebSocket( page.webSocketDebuggerUrl );
	await new Promise( ( resolveOpen, rejectOpen ) => {
		socket.addEventListener( 'open', resolveOpen, { once: true } );
		socket.addEventListener( 'error', rejectOpen, { once: true } );
	} );
	let nextID = 0;
	const pending = new Map();
	socket.addEventListener( 'message', ( { data } ) => {
		const message = JSON.parse( data );
		if ( message.id === undefined ) return;
		const task = pending.get( message.id );
		if ( ! task ) return;
		pending.delete( message.id );
		if ( message.error ) task.reject( new Error( message.error.message ) );
		else task.resolve( message.result );
	} );
	const command = ( method, params = {} ) => new Promise( ( resolveCommand, rejectCommand ) => {
		const id = ++ nextID;
		pending.set( id, { resolve: resolveCommand, reject: rejectCommand } );
		socket.send( JSON.stringify( { id, method, params } ) );
	} );
	await command( 'Page.enable' );
	await command( 'Runtime.enable' );
	await command( 'Page.navigate', { url: `https://127.0.0.1:${port}/` } );
	const evaluate = expression => command( 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true } );
	const loadedDeadline = Date.now() + 10000;
	while ( Date.now() < loadedDeadline ) {
		const state = await evaluate( 'document.readyState' );
		if ( state.result?.value === 'complete' ) break;
		await wait( 50 );
	}
	const expression = `(async () => {
		const { fetchWorldAssetFromCDN, worldAssetCDNURL } = await import('/WorldAssetCDN.js');
		const asset = { id: 'sha256:${digest}', bytes: ${assetBytes.byteLength}, kind: 'glb', priority: 'visible' };
		const sharedBase = location.origin;
		const worldA = { worldId: 'elsemesh:cache-world-a', asset: { ...asset, cdnURL: worldAssetCDNURL(sharedBase, asset.id) } };
		const worldB = { worldId: 'elsemesh:cache-world-b', asset: { ...asset, cdnURL: worldAssetCDNURL(sharedBase, asset.id) } };
		const first = await fetchWorldAssetFromCDN(worldA.asset);
		const second = await fetchWorldAssetFromCDN(worldB.asset);
		return { sameURL: worldA.asset.cdnURL === worldB.asset.cdnURL, firstBytes: first.length, secondBytes: second.length, equal: first.every((value, index) => value === second[index]) };
	})()`;
	const result = await evaluate( expression );
	assert.equal( result.exceptionDetails, undefined, `browser CDN verification failed: ${JSON.stringify( result.exceptionDetails )}` );
	assert.deepEqual( result.result?.value, { sameURL: true, firstBytes: assetBytes.byteLength, secondBytes: assetBytes.byteLength, equal: true }, 'both worlds load the same verified asset URL' );
	assert.equal( requests.get( `/sha256/${digest}` ), 1, `the browser HTTP cache transfers the shared immutable URL once across world loads; requests=${JSON.stringify( assetRequests )}` );
	console.log( 'headless Chromium reused one immutable CDN response across two world asset loads' );
} finally {
	await stopBrowser();
	await new Promise( resolveClose => server.close( resolveClose ) );
	rmSync( profile, { recursive: true, force: true } );
}
