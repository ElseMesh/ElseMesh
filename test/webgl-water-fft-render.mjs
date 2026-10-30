import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'vite';

const engineRoot = process.cwd();
const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) );
function chromiumPath() {
	if ( process.env.ELSEMESH_TEST_CHROMIUM ) return process.env.ELSEMESH_TEST_CHROMIUM;
	for ( const name of [ 'chromium', 'chromium-browser', 'google-chrome' ] ) for ( const directory of ( process.env.PATH || '' ).split( ':' ) ) {
		const candidate = join( directory, name );
		try { accessSync( candidate, constants.X_OK ); return candidate; } catch {}
	}
	throw new Error( 'Chromium is required; set ELSEMESH_TEST_CHROMIUM to its executable path' );
}
async function stopBrowser( browser ) {
	try { process.kill( - browser.pid, 'SIGTERM' ); } catch {}
	await Promise.race( [ new Promise( resolve => browser.once( 'close', resolve ) ), sleep( 1000 ) ] );
	try { process.kill( - browser.pid, 'SIGKILL' ); } catch {}
}

const profile = mkdtempSync( join( '/var/tmp', 'elsemesh-webgl-water-fft-' ) );
const vite = await createServer( { configFile: false, root: engineRoot, optimizeDeps: { entries: [ 'test/webgl-water-fft-render.html' ] }, server: { host: '127.0.0.1', port: 0, strictPort: true }, appType: 'mpa' } );
let browser, socket;
try {
	await vite.listen();
	const address = vite.httpServer.address();
	assert( address && typeof address === 'object' && address.port > 0, 'Vite exposes an ephemeral localhost port' );
	browser = spawn( chromiumPath(), [
		'--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
		'--disable-dev-shm-usage', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
		'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
	], { detached: true, stdio: 'ignore' } );
	const activePort = join( profile, 'DevToolsActivePort' ), startDeadline = Date.now() + 10000;
	while ( ! existsSync( activePort ) && Date.now() < startDeadline ) {
		if ( browser.exitCode !== null ) throw new Error( `isolated Chromium exited early (${browser.exitCode})` );
		await sleep( 50 );
	}
	assert( existsSync( activePort ), 'isolated Chromium starts its DevTools endpoint' );
	const [ port ] = readFileSync( activePort, 'utf8' ).trim().split( /\r?\n/ );
	const targetsResponse = await fetch( `http://127.0.0.1:${port}/json/list` );
	assert.equal( targetsResponse.ok, true );
	const page = ( await targetsResponse.json() ).find( target => target.type === 'page' && target.webSocketDebuggerUrl );
	assert( page, 'isolated Chromium exposes its page target' );
	socket = new WebSocket( page.webSocketDebuggerUrl );
	await new Promise( ( resolve, reject ) => {
		socket.addEventListener( 'open', resolve, { once: true } );
		socket.addEventListener( 'error', reject, { once: true } );
	} );
	let requestID = 0;
	const pending = new Map();
	socket.addEventListener( 'message', ( { data } ) => {
		const message = JSON.parse( data ), request = pending.get( message.id );
		if ( ! request ) return;
		pending.delete( message.id );
		if ( message.error ) request.reject( new Error( message.error.message ) );
		else request.resolve( message.result );
	} );
	const command = ( method, params = {} ) => new Promise( ( resolve, reject ) => {
		const id = ++ requestID;
		pending.set( id, { resolve, reject } );
		socket.send( JSON.stringify( { id, method, params } ) );
	} );
	await command( 'Page.enable' );
	await command( 'Runtime.enable' );
	await command( 'Page.navigate', { url: `http://127.0.0.1:${address.port}/test/webgl-water-fft-render.html` } );
	const deadline = Date.now() + 60000;
	let value;
	while ( Date.now() < deadline ) {
		const response = await command( 'Runtime.evaluate', { expression: "({status: document.querySelector('#result')?.dataset.status, text: document.querySelector('#result')?.textContent})", returnByValue: true } );
		value = response.result?.value;
		if ( value?.status === 'complete' || value?.status === 'failed' ) break;
		await sleep( 50 );
	}
	assert.equal( value?.status, 'complete', `WebGL FFT water render completed: ${value?.text || 'no page result'}` );
	const metrics = JSON.parse( value.text );
	assert( metrics.changedPixels >= 100, `FFT displacement changes at least 100 pixels (${metrics.changedPixels})` );
	assert( metrics.programCount > 0, 'WebGL compiled the water shader program' );
	console.log( `WebGL visible-water FFT render passed (${metrics.changedPixels} changed pixels; ${metrics.programCount} program(s))` );
} finally {
	socket?.close();
	if ( browser ) await stopBrowser( browser );
	await vite.close();
	rmSync( profile, { recursive: true, force: true } );
}
