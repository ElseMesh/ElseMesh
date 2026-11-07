import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createServer } from 'vite';

const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) );
function chromiumPath() {
	if ( process.env.ELSEMESH_TEST_CHROMIUM ) return process.env.ELSEMESH_TEST_CHROMIUM;
	for ( const name of [ 'chromium', 'chromium-browser', 'google-chrome' ] ) for ( const directory of ( process.env.PATH || '' ).split( ':' ) ) {
		const path = join( directory, name );
		try { accessSync( path, constants.X_OK ); return path; } catch {}
	}
	throw new Error( 'Chromium is required; set ELSEMESH_TEST_CHROMIUM to its executable path' );
}
async function stopBrowser( browser ) {
	try { process.kill( - browser.pid, 'SIGTERM' ); } catch {}
	await Promise.race( [ new Promise( resolve => browser.once( 'close', resolve ) ), sleep( 1000 ) ] );
	try { process.kill( - browser.pid, 'SIGKILL' ); } catch {}
}

const root = process.cwd(), profile = mkdtempSync( '/var/tmp/elsemesh-webgl-wake-integration-' );
const vite = await createServer( { root, server: { host: '127.0.0.1', port: 0, strictPort: true }, appType: 'mpa' } );
let browser, socket;
const errors = [], resources = [];
try {
	await vite.listen();
	const address = vite.httpServer.address();
	assert( address && typeof address === 'object' && address.port > 0, 'Vite selected an available port' );
	browser = spawn( chromiumPath(), [ '--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${ profile }`, 'about:blank' ], { detached: true, stdio: 'ignore' } );
	const active = join( profile, 'DevToolsActivePort' ), startup = Date.now() + 10000;
	while ( ! existsSync( active ) && Date.now() < startup ) {
		if ( browser.exitCode !== null ) throw new Error( `isolated Chromium exited (${ browser.exitCode })` );
		await sleep( 50 );
	}
	assert( existsSync( active ), 'isolated Chromium exposes a private DevTools port' );
	const [ port ] = readFileSync( active, 'utf8' ).trim().split( /\r?\n/ );
	const targets = await ( await fetch( `http://127.0.0.1:${ port }/json/list` ) ).json();
	const page = targets.find( target => target.type === 'page' && target.webSocketDebuggerUrl );
	assert( page, 'isolated Chromium page target is available' );
	socket = new WebSocket( page.webSocketDebuggerUrl );
	await new Promise( ( resolve, reject ) => {
		socket.addEventListener( 'open', resolve, { once: true } );
		socket.addEventListener( 'error', reject, { once: true } );
	} );
	let id = 0;
	const pending = new Map();
	socket.addEventListener( 'message', ( { data } ) => {
		const message = JSON.parse( data );
		if ( message.method === 'Runtime.exceptionThrown' ) errors.push( message.params.exceptionDetails.text || message.params.exceptionDetails.exception?.description || 'page exception' );
		if ( message.method === 'Network.responseReceived' && message.params.response.status >= 400 ) resources.push( { status: message.params.response.status, url: message.params.response.url } );
		if ( message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && ! message.params.entry.text.includes( 'Failed to load resource' ) ) errors.push( message.params.entry.text );
		const current = pending.get( message.id );
		if ( ! current ) return;
		pending.delete( message.id );
		message.error ? current.reject( new Error( message.error.message ) ) : current.resolve( message.result );
	} );
	const command = ( method, params = {} ) => new Promise( ( resolve, reject ) => {
		const request = ++ id;
		pending.set( request, { resolve, reject } );
		socket.send( JSON.stringify( { id: request, method, params } ) );
	} );
	await command( 'Page.enable' );
	await command( 'Runtime.enable' );
	await command( 'Log.enable' );
	await command( 'Network.enable' );
	await command( 'Page.navigate', { url: `http://127.0.0.1:${ address.port }/?renderer=webgl&noAudio` } );
	const deadline = Date.now() + 120000;
	let state;
	while ( Date.now() < deadline ) {
		const response = await command( 'Runtime.evaluate', {
			expression: `(() => { const app=window.__app, f=app?.webglFallback, w=f?.wake, water=f?.waterScene?.children?.find(o=>o.isWater), q=f?.waterQuery; return {ready:!!f&&!!w&&!!water&&!!q, backend:app?.backend, steps:w?.stepCount||0, waterSharesWake:!!w&&water?.material?.uniforms?.uWakeDisplay?.value===w.targets.display.texture, querySharesWake:!!w&&q?.material?.uniforms?.uWakeDisplay?.value===w.targets.display.texture, contextError:f?.renderer?.getContext?.().getError?.(), pageError:document.querySelector('[role=alert]')?.innerText||''}; })()`,
			returnByValue: true,
		} );
		state = response.result?.value;
		if ( state?.ready ) break;
		await sleep( 500 );
	}
	assert( state?.ready, `ElseMesh WebGL page did not initialize its boat/water wake: ${ JSON.stringify( { state, errors, resources } ) }` );
	assert.equal( state.backend, 'webgl', 'the page selected the WebGL renderer' );
	assert.equal( state.waterSharesWake, true, 'rendered water samples the WakeSim textures' );
	assert.equal( state.querySharesWake, true, 'WebGLWaterQuery samples the same WakeSim textures' );
	const run = await command( 'Runtime.evaluate', {
		expression: `(() => { const f=window.__app.webglFallback; f.boat.controller.velocity.set(7,0,0); return true; })()`,
		returnByValue: true,
	} );
	assert.equal( run.result?.value, true );
	await sleep( 1800 );
	const after = await command( 'Runtime.evaluate', {
		expression: `(() => { const f=window.__app.webglFallback, w=f.wake; return {steps:w.stepCount, amount:w.uniforms.uAmount.value, contextError:f.renderer.getContext().getError()}; })()`,
		returnByValue: true,
	} );
	state = after.result?.value;
	assert( state.steps >= 2 && state.amount > 0, `the integrated wake solver advanced while the boat moved: ${ JSON.stringify( state ) }` );
	assert.equal( state.contextError, 0, 'the integrated WebGL frame left no GL error' );
	assert.deepEqual( errors, [], `the integrated WebGL page produced no console or runtime errors: ${ errors.join( '\n' ) }` );
	const capture = await command( 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false } );
	writeFileSync( '/var/tmp/elsemesh-webgl-wake-integration.png', Buffer.from( capture.data, 'base64' ) );
	console.log( `Integrated WebGL wake page passed: ${ JSON.stringify( state ) }; screenshot /var/tmp/elsemesh-webgl-wake-integration.png` );
} finally {
	socket?.close();
	if ( browser ) await stopBrowser( browser );
	await vite.close();
	rmSync( profile, { recursive: true, force: true } );
}
