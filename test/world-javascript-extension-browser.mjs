import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

function chromiumPath() {
	if ( process.env.ELSEMESH_TEST_CHROMIUM ) return process.env.ELSEMESH_TEST_CHROMIUM;
	for ( const executable of [ 'chromium', 'chromium-browser', 'google-chrome' ] ) {
		for ( const directory of ( process.env.PATH || '' ).split( ':' ) ) {
			const candidate = join( directory, executable );
			try { accessSync( candidate, constants.X_OK ); return candidate; } catch {}
		}
	}
	throw new Error( 'Chromium is required; set ELSEMESH_TEST_CHROMIUM to its executable path' );
}

const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) );

async function launchIsolatedChromium( executable, profile ) {
	const child = spawn( executable, [
		'--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-extensions',
		'--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1',
		'--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
	], { detached: true, stdio: 'ignore' } );
	try {
		const activePort = join( profile, 'DevToolsActivePort' );
		const deadline = Date.now() + 10000;
		while ( ! existsSync( activePort ) && Date.now() < deadline ) {
			if ( child.exitCode !== null ) throw new Error( `Chromium exited before DevTools started (status ${child.exitCode})` );
			await sleep( 50 );
		}
		if ( ! existsSync( activePort ) ) throw new Error( 'Chromium DevTools endpoint did not start' );
		const [ portLine ] = readFileSync( activePort, 'utf8' ).trim().split( /\r?\n/ );
		const response = await fetch( `http://127.0.0.1:${portLine}/json/list` );
		assert.equal( response.ok, true, 'isolated Chromium DevTools lists its page target' );
		const page = ( await response.json() ).find( target => target.type === 'page' && target.webSocketDebuggerUrl );
		assert( page, 'isolated Chromium exposes a page WebSocket' );
		return { child, page };
	} catch ( error ) {
		await stopBrowser( child );
		throw error;
	}
}

async function inspectPage( page, url ) {
	const socket = new WebSocket( page.webSocketDebuggerUrl );
	await new Promise( ( resolve, reject ) => {
		socket.addEventListener( 'open', resolve, { once: true } );
		socket.addEventListener( 'error', reject, { once: true } );
	} );
	let nextID = 0;
	const pending = new Map();
	socket.addEventListener( 'message', ( { data } ) => {
		const message = JSON.parse( data );
		if ( message.id === undefined ) return;
		const request = pending.get( message.id );
		if ( ! request ) return;
		pending.delete( message.id );
		if ( message.error ) request.reject( new Error( message.error.message ) );
		else request.resolve( message.result );
	} );
	const command = ( method, params = {} ) => new Promise( ( resolve, reject ) => {
		const id = ++ nextID;
		pending.set( id, { resolve, reject } );
		socket.send( JSON.stringify( { id, method, params } ) );
	} );
	try {
		await command( 'Page.enable' );
		await command( 'Runtime.enable' );
		await command( 'Page.navigate', { url } );
		const deadline = Date.now() + 10000;
		while ( Date.now() < deadline ) {
			const state = await command( 'Runtime.evaluate', {
				expression: "({status: document.querySelector('#result')?.dataset.status, text: document.querySelector('#result')?.textContent})",
				returnByValue: true,
			} );
			const value = state.result?.value;
			if ( value?.status === 'passed' || value?.status === 'failed' ) return value;
			await sleep( 50 );
		}
		throw new Error( 'browser Worker integration did not complete within 10 seconds' );
	} finally {
		socket.close();
	}
}

async function stopBrowser( child ) {
	try { process.kill( - child.pid, 'SIGTERM' ); } catch {}
	await Promise.race( [ new Promise( resolve => child.once( 'close', resolve ) ), sleep( 1500 ) ] );
	try { process.kill( - child.pid, 'SIGKILL' ); } catch {}
}

const profile = mkdtempSync( join( '/var/tmp', 'elsemesh-world-extension-chromium-' ) );
const vite = await createServer( {
	configFile: false,
	root: process.cwd(),
	server: { host: '127.0.0.1', port: 0, strictPort: true },
	appType: 'mpa',
} );
let browserProcess = null;

try {
	await vite.listen();
	const address = vite.httpServer.address();
	assert( address && typeof address === 'object' && address.port > 0, 'Vite exposes an ephemeral localhost port' );
	const url = `http://127.0.0.1:${address.port}/test/world-javascript-extension-browser.html`;
	const browser = await launchIsolatedChromium( chromiumPath(), profile );
	browserProcess = browser.child;
	const result = await inspectPage( browser.page, url );
	assert.equal( result.status, 'passed', `actual browser Worker passes: ${result.text}` );
	assert.match( result.text, /"calls":1.*"isWorker":true/, 'the extension executes in a Worker global scope and retains module state' );
	assert.match( result.text, /"calls":2.*"isWorker":true/, 'the same dedicated Worker handles sequential calls' );
	console.log( 'World JavaScript extension: actual isolated Chromium module Worker execution and stateful calls passed' );
} finally {
	if ( browserProcess ) await stopBrowser( browserProcess );
	await vite.close();
	rmSync( profile, { recursive: true, force: true } );
}
