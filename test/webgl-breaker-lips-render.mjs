import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const wait = ms => new Promise( resolve => setTimeout( resolve, ms ) );
function findChromium() {
	if ( process.env.ELSEMESH_TEST_CHROMIUM ) return process.env.ELSEMESH_TEST_CHROMIUM;
	for ( const name of [ 'chromium', 'chromium-browser', 'google-chrome' ] ) for ( const dir of ( process.env.PATH || '' ).split( ':' ) ) {
		const candidate = join( dir, name );
		try { accessSync( candidate, constants.X_OK ); return candidate; } catch {}
	}
	throw new Error( 'Chromium is required; set ELSEMESH_TEST_CHROMIUM to its executable path' );
}
async function stop( child ) {
	try { process.kill( -child.pid, 'SIGTERM' ); } catch {}
	await Promise.race( [ new Promise( resolve => child.once( 'close', resolve ) ), wait( 1000 ) ] );
	try { process.kill( -child.pid, 'SIGKILL' ); } catch {}
}

const profile = mkdtempSync( join( '/var/tmp', 'elsemesh-webgl-breaker-lips-' ) );
const vite = await createServer( { configFile: false, root, server: { host: '127.0.0.1', port: 0, strictPort: true }, appType: 'mpa' } );
let browser, socket;
try {
	await vite.listen();
	const address = vite.httpServer.address();
	browser = spawn( findChromium(), [ '--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank' ], { detached: true, stdio: 'ignore' } );
	const activePort = join( profile, 'DevToolsActivePort' );
	let port = '';
	for ( let i = 0; i < 200 && ! /^[1-9]\d*$/.test( port ); i ++ ) {
		if ( browser.exitCode !== null ) throw new Error( `Chromium exited (${browser.exitCode})` );
		if ( existsSync( activePort ) ) port = readFileSync( activePort, 'utf8' ).trim().split( /\r?\n/ )[ 0 ] || '';
		if ( ! /^[1-9]\d*$/.test( port ) ) await wait( 50 );
	}
	assert.match( port, /^[1-9]\d*$/, 'isolated Chromium publishes a complete DevTools port' );
	const targets = await ( await fetch( `http://127.0.0.1:${port}/json/list` ) ).json();
	const page = targets.find( target => target.type === 'page' );
	assert( page?.webSocketDebuggerUrl, 'isolated Chromium exposes a page target' );
	socket = new WebSocket( page.webSocketDebuggerUrl );
	await new Promise( ( resolve, reject ) => { socket.addEventListener( 'open', resolve, { once: true } ); socket.addEventListener( 'error', reject, { once: true } ); } );
	let id = 0; const pending = new Map();
	socket.addEventListener( 'message', ( { data } ) => { const message = JSON.parse( data ), p = pending.get( message.id ); if ( p ) { pending.delete( message.id ); message.error ? p.reject( new Error( message.error.message ) ) : p.resolve( message.result ); } } );
	const command = ( method, params = {} ) => new Promise( ( resolve, reject ) => { const requestID = ++id; pending.set( requestID, { resolve, reject } ); socket.send( JSON.stringify( { id: requestID, method, params } ) ); } );
	await command( 'Page.enable' );
	await command( 'Page.navigate', { url: `http://127.0.0.1:${address.port}/test/webgl-breaker-lips-render.html` } );
	let result;
	for ( let i = 0; i < 1200; i ++ ) {
		const response = await command( 'Runtime.evaluate', { expression: "({status: document.querySelector('#result')?.dataset.status, text: document.querySelector('#result')?.textContent})", returnByValue: true } );
		result = response.result?.value;
		if ( result?.status === 'complete' || result?.status === 'failed' ) break;
		await wait( 50 );
	}
	assert.equal( result?.status, 'complete', `WebGL breaker render completed: ${result?.text || 'no page result'}` );
	console.log( `WebGL breaker render passed (${result.text})` );
} finally {
	socket?.close(); if ( browser ) await stop( browser ); await vite.close(); rmSync( profile, { recursive: true, force: true } );
}
