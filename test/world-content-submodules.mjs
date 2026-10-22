import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { renderWorldAssetIndex } from '../tools/world-asset-index.mjs';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const modules = await readFile( path.join( root, '.gitmodules' ), 'utf8' );
assert.match( modules, /path = worlds\/tidewater\n\s*url = https:\/\/github\.com\/ElseMesh\/tidewater\.git/ );
assert.doesNotMatch( modules, /burning-horizons|loz-underneath/i, 'Burning Horizons remains outside ElseMesh submodules' );

const status = execFileSync( 'git', [ 'submodule', 'status' ], { cwd: root, encoding: 'utf8' } );
assert.doesNotMatch( status, /^[-+U]/m, 'content submodules must be checked out at their pinned revisions' );

async function verifyWorld( directory, expectedWorldId ) {
	const worldRoot = path.join( root, directory );
	const source = JSON.parse( await readFile( path.join( worldRoot, 'world-source.json' ), 'utf8' ) );
	assert.equal( source.worldId, expectedWorldId );
	const ids = new Set();
	const collect = value => {
		if ( typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test( value ) ) ids.add( value.slice( 7 ) );
		else if ( Array.isArray( value ) ) value.forEach( collect );
		else if ( value && typeof value === 'object' ) Object.values( value ).forEach( collect );
	};
	collect( source );
	assert.ok( ids.size > 0, `${directory} declares package assets` );
	for ( const id of ids ) {
		const bytes = await readFile( path.join( worldRoot, 'assets', id ) );
		assert.equal( createHash( 'sha256' ).update( bytes ).digest( 'hex' ), id, `${directory} asset ${id} matches its content address` );
	}
	const index = await readFile( path.join( worldRoot, 'ASSET-INDEX.md' ), 'utf8' );
	assert.equal( index, await renderWorldAssetIndex( worldRoot ), `${directory} asset index is current` );
	assert.match( index, /Procedural island terrain|Island terrain/i, `${directory} asset index includes human-readable uses` );
	return ids.size;
}

const tidewaterAssets = await verifyWorld( 'worlds/tidewater', 'tw-world:example-island' );

for ( const link of [ 'public/audio', 'public/models/debris', 'public/models/props', 'public/models/whale' ] ) {
	const resolved = await realpath( path.join( root, link ) );
	assert.ok( resolved.startsWith( path.join( await realpath( path.join( root, 'worlds/tidewater' ) ), 'source' ) + path.sep ), `${link} resolves into Tidewater source assets` );
	assert.ok( ( await stat( resolved ) ).isDirectory(), `${link} resolves to a directory` );
}

console.log( `ok Tidewater content submodule (${tidewaterAssets} verified assets); Burning Horizons is external` );
