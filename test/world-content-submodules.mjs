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
assert.match( modules, /path = worlds\/Hogwarts\n\s*url = git@github\.com:rebroad\/Hogwarts-World\.git/ );

const superproject = execFileSync( 'git', [ '-C', path.join( root, 'worlds/tidewater' ), 'rev-parse', '--show-superproject-working-tree' ], { encoding: 'utf8' } ).trim();
const status = execFileSync( 'git', [ '-C', superproject || root, 'submodule', 'status' ], { encoding: 'utf8' } );
assert.doesNotMatch( status, /^[-+U]/m, 'content submodules must be checked out at their pinned revisions' );

async function verifyWorld( directory, expectedWorldId ) {
	const worldRoot = path.join( root, directory );
	const source = JSON.parse( await readFile( path.join( worldRoot, 'world-source.json' ), 'utf8' ) );
	assert.equal( source.worldId, expectedWorldId );
	if ( directory === 'worlds/tidewater' ) assert.deepEqual( Object.keys( source.experience?.behaviors || {} ), [ 'elsemesh.fishing-game/1', 'elsemesh.shore-aware-boat/1' ], 'Tidewater declares registered behaviors with behavior-owned signed experience data' );
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

const tidewaterAssets = await verifyWorld( 'worlds/tidewater', 'elsemesh:example-island' );
const hogwartsEntry = JSON.parse( await readFile( path.join( root, 'worlds/Hogwarts/entry-point-selection.json' ), 'utf8' ) );
assert.equal( hogwartsEntry.worldId, 'elsemesh:hogwarts-legacy-local', 'Hogwarts-authored entry metadata remains in its world repository' );
assert.ok( hogwartsEntry.previewRegion.mapPath && hogwartsEntry.previewSpawn.position.length === 3, 'Hogwarts retains its authored region and preview spawn metadata' );

for ( const link of [ 'public/audio', 'public/models/debris', 'public/models/props', 'public/models/whale' ] ) {
	const resolved = await realpath( path.join( root, link ) );
	assert.ok( resolved.startsWith( path.join( await realpath( path.join( root, 'worlds/tidewater' ) ), 'source' ) + path.sep ), `${link} resolves into Tidewater source assets` );
	assert.ok( ( await stat( resolved ) ).isDirectory(), `${link} resolves to a directory` );
}

console.log( `ok world content repositories (Tidewater: ${tidewaterAssets} verified assets; Hogwarts: authored entry metadata)` );
