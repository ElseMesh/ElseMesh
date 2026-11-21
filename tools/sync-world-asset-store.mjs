#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, stat, unlink, link } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const ASSET_NAME = /^[0-9a-f]{64}$/;

function parseOptions( argv ) {
	let store = '';
	const assetDirectories = [];
	for ( let index = 0; index < argv.length; index ++ ) {
		const option = argv[ index ];
		const value = argv[ index + 1 ];
		if ( ! value || value.startsWith( '--' ) ) throw new Error( `Missing value for ${option}` );
		if ( option === '--store' && ! store ) store = value;
		else if ( option === '--assets' ) assetDirectories.push( value );
		else throw new Error( `Unknown or duplicate option: ${option}` );
		index ++;
	}
	if ( ! store || assetDirectories.length === 0 ) throw new Error( 'Usage: sync-world-asset-store.mjs --store DIRECTORY --assets WORLD_ASSETS [--assets OTHER_WORLD_ASSETS ...]' );
	return { store: path.resolve( store ), assetDirectories: assetDirectories.map( directory => path.resolve( directory ) ) };
}

async function digestFile( filename ) {
	const hasher = createHash( 'sha256' );
	for await ( const chunk of createReadStream( filename ) ) hasher.update( chunk );
	return hasher.digest( 'hex' );
}

async function verifyAsset( filename, digest, label ) {
	const info = await lstat( filename );
	if ( ! info.isFile() || info.isSymbolicLink() ) throw new Error( `${label} must be a regular file: ${filename}` );
	if ( await digestFile( filename ) !== digest ) throw new Error( `${label} does not match its SHA-256 filename: ${filename}` );
	return info.size;
}

async function installAsset( source, destination, digest, size, store ) {
	try {
		const existingSize = await verifyAsset( destination, digest, 'Existing shared asset' );
		if ( existingSize !== size ) throw new Error( `Existing shared asset has a conflicting byte length: ${destination}` );
		return false;
	} catch ( error ) {
		if ( error.code !== 'ENOENT' ) throw error;
	}

	const temporary = path.join( store, `.${digest}.${process.pid}.${randomUUID()}.tmp` );
	try {
		await copyFile( source, temporary, constants.COPYFILE_EXCL );
		if ( await verifyAsset( temporary, digest, 'Copied shared asset' ) !== size ) throw new Error( `Asset changed while copying: ${source}` );
		try {
			await link( temporary, destination );
			return true;
		} catch ( error ) {
			if ( error.code !== 'EEXIST' ) throw error;
			const existingSize = await verifyAsset( destination, digest, 'Concurrent shared asset' );
			if ( existingSize !== size ) throw new Error( `Concurrent shared asset has a conflicting byte length: ${destination}` );
			return false;
		}
	} finally {
		try { await unlink( temporary ); } catch ( error ) { if ( error.code !== 'ENOENT' ) throw error; }
	}
}

async function main() {
	const { store, assetDirectories } = parseOptions( process.argv.slice( 2 ) );
	await mkdir( store, { recursive: true });
	const storeInfo = await stat( store );
	if ( ! storeInfo.isDirectory() ) throw new Error( `Shared asset store is not a directory: ${store}` );
	let inspected = 0, installed = 0, reused = 0, bytes = 0, uniqueBytes = 0;
	const sizes = new Map();
	for ( const directory of assetDirectories ) {
		const entries = await readdir( directory, { withFileTypes: true } );
		for ( const entry of entries ) {
			if ( ! ASSET_NAME.test( entry.name ) ) continue;
			if ( ! entry.isFile() ) throw new Error( `Hash-named world asset is not a regular file: ${path.join( directory, entry.name )}` );
			const source = path.join( directory, entry.name );
			const size = await verifyAsset( source, entry.name, 'World asset' );
			const previousSize = sizes.get( entry.name );
			if ( previousSize !== undefined && previousSize !== size ) throw new Error( `Duplicate asset ${entry.name} has conflicting byte lengths` );
			if ( previousSize === undefined ) uniqueBytes += size;
			sizes.set( entry.name, size );
			inspected ++;
			if ( await installAsset( source, path.join( store, entry.name ), entry.name, size, store ) ) installed ++;
			else reused ++;
			bytes += size;
		}
	}
	console.log( JSON.stringify( { store, assetDirectories, inspected, installed, reused, sourceBytes: bytes, uniqueBytes } ) );
}

main().catch( error => {
	console.error( error.message );
	process.exitCode = 1;
} );
