import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify( execFile );
const temporaryRoot = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const root = await mkdtemp( path.join( temporaryRoot, 'elsemesh-shared-assets-' ) );
try {
	const worldA = path.join( root, 'world-a' ), worldB = path.join( root, 'world-b' ), store = path.join( root, 'shared' );
	await Promise.all( [ mkdir( worldA ), mkdir( worldB ) ] );
	const sharedBytes = Buffer.from( 'one shared immutable asset' );
	const sharedDigest = createHash( 'sha256' ).update( sharedBytes ).digest( 'hex' );
	await Promise.all( [ writeFile( path.join( worldA, sharedDigest ), sharedBytes ), writeFile( path.join( worldB, sharedDigest ), sharedBytes ) ] );
	const uniqueBytes = Buffer.from( 'one world-specific asset' );
	const uniqueDigest = createHash( 'sha256' ).update( uniqueBytes ).digest( 'hex' );
	await writeFile( path.join( worldB, uniqueDigest ), uniqueBytes );
	const command = path.resolve( 'tools/sync-world-asset-store.mjs' );
	const first = JSON.parse( ( await run( process.execPath, [ command, '--store', store, '--assets', worldA, '--assets', worldB ] ) ).stdout );
	assert.deepEqual( { inspected: first.inspected, installed: first.installed, reused: first.reused }, { inspected: 3, installed: 2, reused: 1 }, 'identical world assets occupy one shared hash-named store entry' );
	assert.equal( first.uniqueBytes, sharedBytes.byteLength + uniqueBytes.byteLength, 'the report counts shared asset bytes once' );
	assert.deepEqual( await readFile( path.join( store, sharedDigest ) ), sharedBytes );
	const second = JSON.parse( ( await run( process.execPath, [ command, '--store', store, '--assets', worldA, '--assets', worldB ] ) ).stdout );
	assert.deepEqual( { installed: second.installed, reused: second.reused }, { installed: 0, reused: 3 }, 're-running the importer safely reuses the existing content-addressed store' );

	const badWorld = path.join( root, 'bad-world' );
	await mkdir( badWorld );
	await writeFile( path.join( badWorld, sharedDigest ), 'tampered bytes' );
	await assert.rejects( run( process.execPath, [ command, '--store', store, '--assets', badWorld ] ), /does not match its SHA-256 filename/, 'mismatched world content is rejected before store mutation' );
	console.log( 'shared world asset store deduplicates verified bytes and rejects hash mismatches' );
} finally {
	await rm( root, { recursive: true, force: true } );
}
