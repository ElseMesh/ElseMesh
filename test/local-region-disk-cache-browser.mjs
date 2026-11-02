import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if ( process.platform !== 'linux' ) {
	console.log( 'skip local region disk cache browser test: Linux Chromium is required' );
	process.exit( 0 );
}

const chromium = process.env.CHROMIUM_PATH || 'chromium';
const version = spawnSync( chromium, [ '--version' ], { encoding: 'utf8' } );
if ( version.error || version.status !== 0 ) {
	console.log( 'skip local region disk cache browser test: Chromium is unavailable' );
	process.exit( 0 );
}

const modulePath = resolve( fileURLToPath( new URL( '../src/network/LocalRegionDiskCache.js', import.meta.url ) ) );
const html = '<!doctype html><meta charset="utf-8"><title>OPFS test</title><p>OPFS persistence test</p>';
const requests = [];
const server = createServer( ( request, response ) => {
	const pathname = new URL( request.url, 'http://127.0.0.1' ).pathname;
	requests.push( pathname );
	if ( pathname === '/' ) {
		response.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } );
		response.end( html );
	} else if ( pathname === '/LocalRegionDiskCache.js' ) {
		response.writeHead( 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } );
		response.end( readFileSync( modulePath ) );
	} else {
		response.writeHead( 404 );
		response.end();
	}
} );

const profile = mkdtempSync( join( '/var/tmp', 'elsemesh-hogwarts-opfs-' ) );
const profilePrefix = resolve( '/var/tmp' ) + '/elsemesh-hogwarts-opfs-';
const browsers = new Set();

function wait( milliseconds ) { return new Promise( resolveWait => setTimeout( resolveWait, milliseconds ) ); }

async function startBrowser( url ) {
	const activePortPath = join( profile, 'DevToolsActivePort' );
	try { unlinkSync( activePortPath ); } catch ( error ) { if ( error.code !== 'ENOENT' ) throw error; }
	const child = spawn( chromium, [
		'--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
		'--disable-component-update', '--disable-sync', '--disable-dev-shm-usage', '--no-proxy-server', '--no-first-run',
		'--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
	], { detached: true, stdio: [ 'ignore', 'ignore', 'pipe' ] } );
	let stderr = '';
	child.stderr.setEncoding( 'utf8' );
	child.stderr.on( 'data', chunk => { stderr += chunk; } );
	const exited = new Promise( resolveExit => child.once( 'close', ( code, signal ) => resolveExit( { code, signal } ) ) );
	const session = { child, exited, socket: null, stderr: () => stderr };
	browsers.add( session );
	let port;
	let browserSocketPath;
	for ( let attempt = 0; attempt < 150; attempt ++ ) {
		if ( child.exitCode !== null ) throw new Error( `Chromium exited before DevTools started: ${stderr}` );
		if ( existsSync( activePortPath ) ) {
			const [ portText, websocketPath ] = readFileSync( activePortPath, 'utf8' ).split( '\n' );
			port = Number( portText );
			browserSocketPath = websocketPath;
			if ( Number.isInteger( port ) && port > 0 ) break;
		}
		await wait( 100 );
	}
	if ( ! port ) throw new Error( `Chromium did not publish its DevTools endpoint: ${stderr}` );
	let createTarget;
	for ( let attempt = 0; attempt < 50; attempt ++ ) {
		try {
			createTarget = await fetch( `http://127.0.0.1:${port}/json/new?${encodeURIComponent( url )}`, { method: 'PUT' } );
			break;
		} catch ( error ) {
			if ( attempt === 49 ) throw new Error( `Chromium DevTools endpoint did not accept connections on ${port} (pid ${child.pid}): ${error}; cause=${error.cause}; ${stderr}` );
			await wait( 100 );
		}
	}
	if ( ! createTarget.ok ) throw new Error( `Could not create a Chromium page target: HTTP ${createTarget.status}` );
	const target = await createTarget.json();
	if ( ! target ) throw new Error( `Chromium did not expose a page target: ${stderr}` );
	const socket = new WebSocket( target.webSocketDebuggerUrl );
	await new Promise( ( resolveOpen, rejectOpen ) => {
		socket.addEventListener( 'open', resolveOpen, { once: true } );
		socket.addEventListener( 'error', rejectOpen, { once: true } );
	} );
	session.socket = socket;
	const browserSocket = new WebSocket( `ws://127.0.0.1:${port}${browserSocketPath}` );
	await new Promise( ( resolveOpen, rejectOpen ) => {
		browserSocket.addEventListener( 'open', resolveOpen, { once: true } );
		browserSocket.addEventListener( 'error', rejectOpen, { once: true } );
	} );
	session.browserSocket = browserSocket;
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener( 'message', event => {
		const message = JSON.parse( event.data );
		if ( ! message.id ) return;
		const task = pending.get( message.id );
		if ( ! task ) return;
		pending.delete( message.id );
		if ( message.error ) task.reject( new Error( message.error.message ) );
		else task.resolve( message.result );
	} );
	session.send = ( method, params = {} ) => new Promise( ( resolveCommand, rejectCommand ) => {
		const id = ++ nextId;
		pending.set( id, { resolve: resolveCommand, reject: rejectCommand } );
		socket.send( JSON.stringify( { id, method, params } ) );
	} );
	session.evaluate = expression => session.send( 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true } );
	return session;
}

async function stopBrowser( session ) {
	if ( ! session ) return;
	if ( session.child.exitCode === null && session.browserSocket?.readyState === WebSocket.OPEN ) {
		session.browserSocket.send( JSON.stringify( { id: 900001, method: 'Browser.close' } ) );
	}
	const result = await Promise.race( [ session.exited, wait( 5000 ).then( () => null ) ] );
	if ( ! result && session.child.exitCode === null ) {
		try { process.kill( - session.child.pid, 'SIGTERM' ); } catch { session.child.kill( 'SIGTERM' ); }
		await Promise.race( [ session.exited, wait( 2000 ) ] );
	}
	session.socket?.close();
	session.browserSocket?.close();
	browsers.delete( session );
}

async function checkCache( base, mode ) {
	const browser = await startBrowser( base );
	try {
		let pageState;
		for ( let attempt = 0; attempt < 100; attempt ++ ) {
			pageState = await browser.evaluate( '({ href: location.href, origin: location.origin, readyState: document.readyState })' );
			if ( pageState.result?.value?.href === base && pageState.result.value.readyState === 'complete' ) break;
			await wait( 50 );
		}
		assert.deepEqual( pageState.result?.value, { href: base, origin: new URL( base ).origin, readyState: 'complete' }, `loopback page did not finish loading: ${JSON.stringify( pageState )}; requests=${requests.join( ',' )}` );
		const result = await browser.evaluate( `(async () => {
			const { LocalRegionDiskCache } = await import(${JSON.stringify( `${base}LocalRegionDiskCache.js` )});
			const cache = await LocalRegionDiskCache.open({ worldId: 'elsemesh:opfs-browser-test', sourceRevision: 'browser-restart-1' });
			if (!cache) throw new Error('OPFS unavailable');
			const bytes = new TextEncoder().encode('Hogwarts local-region persistence check');
			const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
			if (${JSON.stringify( mode )} === 'write') {
				const hashed = await cache.put('cell-3,4,5:visual', bytes, digest);
				const sourceDerived = await cache.put('source:fixture-texture', bytes, null);
				return { ok: hashed && sourceDerived, mode: 'write' };
			}
			const actual = await cache.get('cell-3,4,5:visual');
			const sourceTexture = await cache.get('source:fixture-texture');
			return { ok: !!actual && actual.length === bytes.length && actual.every((value, index) => value === bytes[index]) && !!sourceTexture && sourceTexture.length === bytes.length && sourceTexture.every((value, index) => value === bytes[index]), mode: 'read' };
		})()` );
	assert.equal( result.exceptionDetails, undefined, `browser ${mode} evaluation failed: ${JSON.stringify( result.exceptionDetails )}; requests=${requests.join( ',' )}` );
	assert.deepEqual( result.result.value, { ok: true, mode }, `browser ${mode} check failed; requests=${requests.join( ',' )}` );
	} finally {
		await stopBrowser( browser );
	}
}

try {
	await new Promise( ( resolveListen, reject ) => {
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', resolveListen );
	} );
	const base = `http://127.0.0.1:${server.address().port}/`;
	await checkCache( base, 'write' );
	await checkCache( base, 'read' );
	console.log( 'local region disk cache browser persistence test passed' );
} finally {
	for ( const browser of [ ...browsers ] ) await stopBrowser( browser );
	await new Promise( resolveClose => server.close( resolveClose ) );
	if ( profile.startsWith( profilePrefix ) ) rmSync( profile, { recursive: true, force: true } );
}
