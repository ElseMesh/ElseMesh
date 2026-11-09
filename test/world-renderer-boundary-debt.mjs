import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const worldRoot = path.join( root, 'worlds' );
const debt = JSON.parse( await readFile( path.join( root, 'docs/renderer-boundary-debt.json' ), 'utf8' ) );
const importReferences = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)[\s]*['"]([^'"]+)['"]/g;
const rendererImport = /(?:from\s*|import\s*)['"][^'"]*(?:src\/engine\/(?:gpu|scene|index)|WebGPU|WebGL|three)[^'"]*['"]/i;
const adapterRegistration = /registerWorldComponentBackend(?:Batch)?Adapter\s*\(/;
const excludedDirectories = new Set( [ 'assets', 'docs', 'node_modules', 'test', 'tests', 'tools' ] );
const worldSources = [];
const dependencyCache = new Map();

async function walk( directory ) {

	for ( const entry of await readdir( directory, { withFileTypes: true } ) ) {
		if ( entry.isDirectory() ) {
			if ( excludedDirectories.has( entry.name ) ) continue;
			await walk( path.join( directory, entry.name ) );
			continue;
		}

		if ( ! /\.(?:js|mjs|ts|jsx)$/.test( entry.name ) ) continue;
		const absolute = path.join( directory, entry.name );
		worldSources.push( absolute );
	}

}

function resolveLocalImport( importer, specifier ) {
	if ( ! specifier.startsWith( '.' ) ) return null;
	const base = path.resolve( path.dirname( importer ), specifier );
	for ( const candidate of [ base, `${base}.js`, `${base}.mjs`, `${base}.ts`, path.join( base, 'index.js' ) ] ) {
		if ( ! candidate.startsWith( `${root}${path.sep}` ) || ! existsSync( candidate ) ) continue;
		return candidate;
	}
	return null;
}

async function hasRendererDependency( absolute, visiting = new Set() ) {
	if ( dependencyCache.has( absolute ) ) return dependencyCache.get( absolute );
	if ( visiting.has( absolute ) ) return false;
	visiting.add( absolute );
	const relative = path.relative( root, absolute ).split( path.sep ).join( '/' );
	const source = await readFile( absolute, 'utf8' );
	if ( relative.includes( '/renderers/' ) || rendererImport.test( source ) || adapterRegistration.test( source ) ) {
		dependencyCache.set( absolute, true );
		return true;
	}
	for ( const match of source.matchAll( importReferences ) ) {
		const dependency = resolveLocalImport( absolute, match[ 1 ] );
		if ( dependency && await hasRendererDependency( dependency, visiting ) ) {
			dependencyCache.set( absolute, true );
			return true;
		}
	}
	dependencyCache.set( absolute, false );
	return false;
}

await walk( worldRoot );
const found = [];
for ( const absolute of worldSources ) if ( await hasRendererDependency( absolute ) ) found.push( path.relative( root, absolute ).split( path.sep ).join( '/' ) );
found.sort();
const expected = [ ...debt.files ].sort();
assert.deepEqual( found, expected, [
	'World renderer-boundary debt changed.',
	'New world modules that directly or transitively depend on rendering need to be removed or explicitly reviewed before the inventory is updated.',
	'Remove migrated files from docs/renderer-boundary-debt.json only after the complete neutral contract and both engine backends are in place.',
].join( '\n' ) );

console.log( `ok renderer-boundary debt inventory (${found.length} existing Tidewater modules; no new violations)` );
