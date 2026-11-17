import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { join } from 'node:path';

const engineRoot = process.cwd();
const sleep = ms => new Promise( resolveSleep => setTimeout( resolveSleep, ms ) );
function chromiumPath() {
	for ( const candidate of [ process.env.ELSEMESH_TEST_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome' ].filter( Boolean ) ) {
		try { accessSync( candidate, constants.X_OK ); return candidate; } catch {}
	}
	throw new Error( 'Chromium is required; set ELSEMESH_TEST_CHROMIUM to its executable path' );
}
async function stopBrowser( browser ) {
	try { process.kill( - browser.pid, 'SIGTERM' ); } catch {}
	await Promise.race( [ new Promise( resolveClose => browser.once( 'close', resolveClose ) ), sleep( 1000 ) ] );
	try { process.kill( - browser.pid, 'SIGKILL' ); } catch {}
}

const profile = mkdtempSync( join( '/var/tmp', 'elsemesh-ground-cover-webgl-' ) );
const vite = await createServer( { configFile: false, root: engineRoot, optimizeDeps: { entries: [ 'test/ground-cover-field-webgl-render.html' ] }, server: { host: '127.0.0.1', port: 0, strictPort: true }, appType: 'mpa' } );
let browser, socket;
try {
	await vite.listen();
	const address = vite.httpServer.address();
	assert( address && typeof address === 'object' && address.port > 0, 'Vite exposes an ephemeral localhost port' );
	browser = spawn( chromiumPath(), [
		'--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
		'--disable-dev-shm-usage', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
		'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${ profile }`, 'about:blank',
	], { detached: true, stdio: 'ignore' } );
	const activePort = join( profile, 'DevToolsActivePort' ), startDeadline = Date.now() + 10000;
	while ( ! existsSync( activePort ) && Date.now() < startDeadline ) {
		if ( browser.exitCode !== null ) throw new Error( `isolated Chromium exited early (${ browser.exitCode })` );
		await sleep( 50 );
	}
	assert( existsSync( activePort ), 'isolated Chromium starts its DevTools endpoint' );
	const [ port ] = readFileSync( activePort, 'utf8' ).trim().split( /\r?\n/ );
	const targetsResponse = await fetch( `http://127.0.0.1:${ port }/json/list` );
	assert.equal( targetsResponse.ok, true );
	const page = ( await targetsResponse.json() ).find( target => target.type === 'page' && target.webSocketDebuggerUrl );
	assert( page, 'isolated Chromium exposes its page target' );
	socket = new WebSocket( page.webSocketDebuggerUrl );
	await new Promise( ( resolveOpen, reject ) => {
		socket.addEventListener( 'open', resolveOpen, { once: true } );
		socket.addEventListener( 'error', reject, { once: true } );
	} );
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener( 'message', ( { data } ) => {
		const message = JSON.parse( data ), request = pending.get( message.id );
		if ( ! request ) return;
		pending.delete( message.id );
		if ( message.error ) request.reject( new Error( message.error.message ) );
		else request.resolve( message.result );
	} );
	const command = ( method, params = {} ) => new Promise( ( resolveCommand, reject ) => {
		const id = ++ nextId;
		pending.set( id, { resolve: resolveCommand, reject } );
		socket.send( JSON.stringify( { id, method, params } ) );
	} );
	await command( 'Page.enable' );
	await command( 'Runtime.enable' );
	await command( 'Page.navigate', { url: `http://127.0.0.1:${ address.port }/test/ground-cover-field-webgl-render.html` } );
	const deadline = Date.now() + 60000;
	let result;
	while ( Date.now() < deadline ) {
		const response = await command( 'Runtime.evaluate', { expression: "({status: document.querySelector('#result')?.dataset.status, text: document.querySelector('#result')?.textContent})", returnByValue: true } );
		result = response.result?.value;
		if ( result?.status === 'complete' || result?.status === 'failed' ) break;
		await sleep( 50 );
	}
	assert.equal( result?.status, 'complete', `ground-cover WebGL render completed: ${ result?.text || 'no page result' }` );
	const metrics = JSON.parse( result.text );
	assert( metrics.instances > 0 && metrics.shadowInstances > 0 && metrics.shadowInstances <= metrics.instances, 'the shared fixture produces bounded visible and shadow instance counts' );
	assert( metrics.foregroundPixels > 30 && metrics.programCount > 0, 'the shared fixture renders through a compiled WebGL program' );
	assert.equal( metrics.glError, 0, 'WebGL reports no graphics error' );
	console.log( `ground-cover WebGL shared fixture rendered (${ metrics.instances } visible, ${ metrics.shadowInstances } shadow instances; ${ metrics.foregroundPixels } foreground pixels; ${ metrics.programCount } program(s); no GL errors)` );
} finally {
	socket?.close();
	if ( browser ) await stopBrowser( browser );
	await vite.close();
	rmSync( profile, { recursive: true, force: true } );
}
