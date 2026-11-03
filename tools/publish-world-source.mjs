#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { validateWorldSource } from '../src/network/WorldSource.js';

function parseArgs(argv) {
	const args = {};
	for ( let i = 0; i < argv.length; i ++ ) {
		const key = argv[ i ];
		if ( ! [ '--worldd', '--data', '--source', '--base-source', '--assets' ].includes( key ) || ! argv[ i + 1 ] ) throw new Error( `Invalid or incomplete option: ${key}` );
		args[ key.slice( 2 ) ] = argv[ ++ i ];
	}
	for ( const key of [ 'worldd', 'data', 'source', 'base-source', 'assets' ] ) if ( ! args[ key ] ) throw new Error( `Missing --${key}` );
	return Object.fromEntries( Object.entries( args ).map( ( [ key, value ] ) => [ key, path.resolve( value ) ] ) );
}

function run(command, args) {
	const result = spawnSync( command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 } );
	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) throw new Error( `${command} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}` );
	return result.stdout;
}

async function requirePrivateRegularFile(file) {
	const info = await lstat( file );
	if ( ! info.isFile() || ( info.mode & 0o077 ) !== 0 ) throw new Error( `${file} must be a private regular file` );
}

async function main() {
	const args = parseArgs( process.argv.slice( 2 ) );
	const activeManifest = path.join( args.data, 'world.json' );
	await requirePrivateRegularFile( path.join( args.data, 'node.key' ) );
	await requirePrivateRegularFile( activeManifest );
	const inspectJSON = run( args.worldd, [ '--data', args.data, '--manifest', activeManifest, '--inspect-manifest' ] );
	const current = JSON.parse( inspectJSON );
	const baseSourceBytes = await readFile( args[ 'base-source' ] );
	const baseSourceHash = `sha256:${createHash( 'sha256' ).update( baseSourceBytes ).digest( 'hex' )}`;
	const baseSource = validateWorldSource( JSON.parse( baseSourceBytes.toString( 'utf8' ) ) );
	if ( baseSource.worldId !== current.worldId ) throw new Error( 'Base source worldId does not match the selected owner profile' );
	if ( current.sourceHash && current.sourceHash !== baseSourceHash ) throw new Error( 'Base source is stale; it does not match the active signed manifest sourceHash' );
	if ( ! current.sourceHash ) console.error( 'The active manifest has no sourceHash; this explicit owner publication will adopt --base-source as its reviewed baseline.' );
	const source = validateWorldSource( JSON.parse( await readFile( args.source, 'utf8' ) ) );
	if ( source.worldId !== current.worldId ) throw new Error( 'Source worldId does not match the selected owner profile' );
	if ( current.version >= Number.MAX_SAFE_INTEGER ) throw new Error( 'World version cannot be incremented safely' );
	if ( ! Number.isSafeInteger( current.authorityEpoch ) || current.authorityEpoch < 1 ) throw new Error( 'Active manifest has an invalid authority epoch' );
	const temporaryRoot = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
	const temporaryDirectory = await mkdtemp( path.join( temporaryRoot, 'elsemesh-publish-' ) );
	try {
		const unsignedManifest = path.join( temporaryDirectory, 'candidate.json' );
		run( process.execPath, [
			path.resolve( import.meta.dirname, 'world-source-to-manifest.mjs' ),
			'--source', args.source,
			'--owner', current.ownerPeerId,
			'--assets', args.assets,
			'--out', unsignedManifest,
			'--version', String( current.version + 1 ),
			'--authority-epoch', String( current.authorityEpoch ),
			'--discoverable', String( current.discoverable ),
		] );
		run( args.worldd, [
			'--data', args.data,
			'--manifest', activeManifest,
			'--publish-manifest', unsignedManifest,
			'--import-package', args.assets,
			'--base-source', args[ 'base-source' ],
			'--source', args.source,
		] );
		console.log( `Published ${source.worldId} as version ${current.version + 1}. Restart the running worldd process to load it.` );
	} finally {
		await rm( temporaryDirectory, { recursive: true, force: true } );
	}
}

main().catch( ( error ) => { console.error( error.message ); process.exitCode = 1; } );
