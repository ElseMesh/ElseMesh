import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const worldRoot = path.join( root, 'worlds' );
const debt = JSON.parse( await readFile( path.join( root, 'docs/renderer-boundary-debt.json' ), 'utf8' ) );
const rendererImport = /(?:from\s*|import\s*)['"][^'"]*(?:src\/engine\/(?:gpu|scene|index)|WebGPU|WebGL|three)[^'"]*['"]/i;
const adapterRegistration = /registerWorldComponentBackend(?:Batch)?Adapter\s*\(/;
const excludedDirectories = new Set( [ 'assets', 'docs', 'node_modules', 'test', 'tests', 'tools' ] );
const found = [];

async function walk( directory ) {

	for ( const entry of await readdir( directory, { withFileTypes: true } ) ) {
		if ( entry.isDirectory() ) {
			if ( excludedDirectories.has( entry.name ) ) continue;
			await walk( path.join( directory, entry.name ) );
			continue;
		}

		if ( ! /\.(?:js|mjs|ts|jsx)$/.test( entry.name ) ) continue;
		const absolute = path.join( directory, entry.name );
		const relative = path.relative( root, absolute ).split( path.sep ).join( '/' );
		const source = await readFile( absolute, 'utf8' );
		if ( relative.includes( '/renderers/' ) || rendererImport.test( source ) || adapterRegistration.test( source ) ) found.push( relative );
	}

}

await walk( worldRoot );
found.sort();
const expected = [ ...debt.files ].sort();
assert.deepEqual( found, expected, [
	'World renderer-boundary debt changed.',
	'New renderer-dependent world modules need to be removed or explicitly reviewed before the inventory is updated.',
	'Remove migrated files from docs/renderer-boundary-debt.json only after the complete neutral contract and both engine backends are in place.',
].join( '\n' ) );

console.log( `ok renderer-boundary debt inventory (${found.length} existing Tidewater modules; no new violations)` );
