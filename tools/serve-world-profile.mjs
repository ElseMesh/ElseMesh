#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

function temporaryRoot() {
	if ( process.env.PREFIX && process.env.PREFIX.startsWith( '/data/data/' ) ) return path.join( process.env.PREFIX, 'tmp' );
	return '/var/tmp';
}

export function parseArguments( argv ) {
	const options = {};
	const valueOptions = new Set( [ '--worldd', '--profile', '--worlds-dir', '--source', '--assets', '--http', '--p2p-port', '--public-gateway', '--directory-url', '--discoverable', '--dht-mode', '--bootstrap', '--relay', '--announce-address', '--allow-browser-origin' ] );
	for ( let i = 0; i < argv.length; i ++ ) {
		const key = argv[ i ];
		if ( ! valueOptions.has( key ) || ! argv[ i + 1 ] || argv[ i + 1 ].startsWith( '--' ) ) throw new Error( `Invalid or incomplete option: ${key}` );
		if ( [ '--bootstrap', '--relay', '--announce-address', '--allow-browser-origin' ].includes( key ) ) ( options[ key.slice( 2 ) ] ||= [] ).push( argv[ ++ i ] );
		else {
			if ( options[ key ] !== undefined ) throw new Error( `Option may only be specified once: ${key}` );
			options[ key ] = argv[ ++ i ];
		}
	}
	for ( const key of [ '--worldd', '--profile', '--worlds-dir' ] ) if ( ! options[ key ] ) throw new Error( `Missing ${key}` );
	if ( Boolean( options[ '--source' ] ) !== Boolean( options[ '--assets' ] ) ) throw new Error( '--source and --assets must be supplied together' );
	if ( ! /^[a-z0-9][a-z0-9_-]{0,63}$/.test( options[ '--profile' ] ) ) throw new Error( '--profile must be 1 to 64 lowercase letters, digits, hyphens, or underscores and start with a letter or digit' );
	if ( options[ '--http' ] && ! /^(?:localhost|127\.0\.0\.1|\[[0-9a-f:]+\]|[^\s:]+):\d{1,5}$/.test( options[ '--http' ] ) ) throw new Error( '--http must be a host:port address' );
	if ( options[ '--p2p-port' ] && ( ! /^\d+$/.test( options[ '--p2p-port' ] ) || Number( options[ '--p2p-port' ] ) < 1 || Number( options[ '--p2p-port' ] ) > 65535 ) ) throw new Error( '--p2p-port must be between 1 and 65535' );
	if ( options[ '--directory-url' ] && ! options[ '--public-gateway' ] ) throw new Error( '--directory-url requires --public-gateway' );
	if ( options[ '--discoverable' ] && ! [ 'true', 'false' ].includes( options[ '--discoverable' ] ) ) throw new Error( '--discoverable must be true or false' );
	if ( options[ '--directory-url' ] && options[ '--discoverable' ] === 'false' ) throw new Error( '--directory-url cannot be combined with --discoverable false' );
	if ( options[ '--dht-mode' ] && ! [ 'auto', 'client', 'server' ].includes( options[ '--dht-mode' ] ) ) throw new Error( '--dht-mode must be auto, client, or server' );
	return options;
}

function run( command, args, options = {} ) {
	const result = spawnSync( command, args, { encoding: 'utf8', ...options } );
	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) throw new Error( `${command} ${args.join( ' ' )} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}` );
	return result.stdout.trim();
}

function worlddArgs( options, args ) {
	return [ '--worlds-dir', path.resolve( options[ '--worlds-dir' ] ), '--world-profile', options[ '--profile' ], ...args ];
}

async function serve( options ) {
	const worldsDir = path.resolve( options[ '--worlds-dir' ] );
	const profileDir = path.join( worldsDir, options[ '--profile' ] );
	await mkdir( worldsDir, { recursive: true, mode: 0o700 } );
	const worldManifestPath = path.join( profileDir, 'world.json' );
	let manifestExists = false;
	try {
		await lstat( worldManifestPath );
		manifestExists = true;
	} catch ( error ) {
		if ( error.code !== 'ENOENT' ) throw error;
	}
	if ( ! manifestExists ) {
		if ( ! options[ '--source' ] ) throw new Error( `Profile has no signed world manifest yet: ${worldManifestPath}; provide --source and --assets to create it` );
		const tempDir = await mkdtemp( path.join( temporaryRoot(), 'elsemesh-profile-' ) );
		try {
			const worldd = path.resolve( options[ '--worldd' ] );
			const sourcePath = path.resolve( options[ '--source' ] );
			const assetsPath = path.resolve( options[ '--assets' ] );
			const peerId = run( worldd, worlddArgs( options, [ '--print-node-id' ] ) );
			const unsignedPath = path.join( tempDir, 'world.unsigned.json' );
			const signedPath = path.join( tempDir, 'world.signed.json' );
			const source = JSON.parse( await readFile( sourcePath, 'utf8' ) );
			const converterArgs = [ path.join( repositoryRoot, 'tools/world-source-to-manifest.mjs' ), '--source', sourcePath, '--owner', peerId, '--assets', assetsPath, '--out', unsignedPath ];
			const discoverable = options[ '--directory-url' ] ? 'true' : options[ '--discoverable' ];
			if ( discoverable ) converterArgs.push( '--discoverable', discoverable );
			run( process.execPath, converterArgs );
			run( worldd, worlddArgs( options, [ '--sign-manifest', unsignedPath, '--manifest-out', signedPath ] ) );
			run( worldd, worlddArgs( options, [ '--manifest', signedPath, '--import-package', assetsPath, '--world-name', source.title ] ) );
			await copyFile( signedPath, worldManifestPath, constants.COPYFILE_EXCL );
			await chmod( worldManifestPath, 0o600 );
			console.log( `Prepared ${source.title} (${source.worldId}) in profile ${options[ '--profile' ]} using owner ${peerId}` );
		} finally {
			await rm( tempDir, { recursive: true, force: true } );
		}
	}

	const args = worlddArgs( options, [] );
	if ( options[ '--http' ] ) args.push( '--http', options[ '--http' ] );
	if ( options[ '--p2p-port' ] ) args.push( '--p2p-port', options[ '--p2p-port' ] );
	if ( options[ '--dht-mode' ] ) args.push( '--dht-mode', options[ '--dht-mode' ] );
	if ( options[ '--public-gateway' ] ) args.push( '--public-gateway', options[ '--public-gateway' ] );
	if ( options[ '--directory-url' ] ) args.push( '--directory-url', options[ '--directory-url' ] );
	for ( const key of [ 'bootstrap', 'relay', 'announce-address', 'allow-browser-origin' ] ) for ( const value of options[ key ] || [] ) args.push( `--${key}`, value );
	const child = spawn( path.resolve( options[ '--worldd' ] ), args, { stdio: 'inherit' } );
	const forwardSignal = signal => child.kill( signal );
	process.on( 'SIGINT', forwardSignal );
	process.on( 'SIGTERM', forwardSignal );
	const code = await new Promise( ( resolve, reject ) => {
		child.once( 'error', reject );
		child.once( 'exit', ( status, signal ) => resolve( status ?? ( signal ? 1 : 0 ) ) );
	} );
	process.off( 'SIGINT', forwardSignal );
	process.off( 'SIGTERM', forwardSignal );
	process.exitCode = code;
}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {
	try {
		await serve( parseArguments( process.argv.slice( 2 ) ) );
	} catch ( error ) {
		console.error( error.message );
		process.exitCode = 1;
	}
}
