#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

function formatBytes( bytes ) {
	return bytes >= 1024 * 1024 ? `${( bytes / ( 1024 * 1024 ) ).toFixed( 2 )} MiB` : `${( bytes / 1024 ).toFixed( 1 )} KiB`;
}

function detectFormat( bytes, refs ) {
	if ( refs.some( ref => ref.role === 'world behavior module' ) ) return 'JavaScript module';
	if ( bytes.subarray( 0, 4 ).toString( 'ascii' ) === 'glTF' ) return 'glTF binary (GLB)';
	if ( bytes.subarray( 0, 4 ).toString( 'ascii' ) === 'OggS' ) return 'Ogg audio';
	if ( bytes.subarray( 0, 8 ).equals( Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ) ) ) return 'PNG image';
	if ( bytes[ 0 ] === 0xff && bytes[ 1 ] === 0xd8 ) return 'JPEG image';
	const text = bytes.toString( 'utf8' );
	try {
		JSON.parse( text );
		return 'JSON';
	} catch {}
	const kind = refs.find( ref => ref.kind )?.kind;
	return kind ? `Binary (${kind})` : 'Binary data';
}

async function listFiles( directory ) {
	const files = [];
	async function visit( current ) {
		for ( const entry of await readdir( current, { withFileTypes: true } ) ) {
			const fullPath = path.join( current, entry.name );
			if ( entry.isDirectory() ) await visit( fullPath );
			else if ( entry.isFile() ) files.push( fullPath );
		}
	}
	await visit( directory );
	return files;
}

export async function renderWorldAssetIndex( worldRoot ) {
	worldRoot = path.resolve( worldRoot );
	const sourcePath = path.join( worldRoot, 'world-source.json' );
	const assetsPath = path.join( worldRoot, 'assets' );
	const source = JSON.parse( await readFile( sourcePath, 'utf8' ) );
	const references = new Map();

	function addReference( assetId, owner, kind ) {
		if ( typeof assetId !== 'string' || ! /^sha256:[0-9a-f]{64}$/.test( assetId ) ) throw new Error( `Invalid content-addressed reference on ${owner}` );
		const id = assetId.slice( 'sha256:'.length );
		const refs = references.get( id ) || [];
		refs.push( { owner, kind: kind || 'asset' } );
		references.set( id, refs );
	}
	for ( const object of source.objects || [] ) {
		const owner = object.label || `Object ${object.id}`;
		if ( object.assetId ) addReference( object.assetId, owner, 'glb' );
		for ( const level of object.lods || [] ) addReference( level.assetId, `${owner} distance mesh`, 'glb' );
	}
	for ( const component of source.components || [] ) {
		const owner = `Component ${component.id}`;
		for ( const asset of component.assets || [] ) addReference( asset.assetId, owner, asset.kind );
	}
	for ( const extension of source.experience?.extensions || [] ) addReference( extension.assetId, `Behavior ${extension.behaviorId}`, 'javascript/1' );
	const sourceByHash = new Map();
	const sourceDirectory = path.join( worldRoot, 'source' );
	try {
		for ( const sourceFile of await listFiles( sourceDirectory ) ) {
			const bytes = await readFile( sourceFile );
			const id = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
			const sourceFiles = sourceByHash.get( id ) || [];
			sourceFiles.push( path.relative( worldRoot, sourceFile ).split( path.sep ).join( '/' ) );
			sourceByHash.set( id, sourceFiles );
		}
	} catch ( error ) {
		if ( error.code !== 'ENOENT' ) throw error;
	}
	const entries = new Map();
	for ( const id of references.keys() ) {
		const filePath = path.join( assetsPath, id );
		const bytes = await readFile( filePath );
		const digest = createHash( 'sha256' ).update( bytes ).digest( 'hex' );
		if ( digest !== id ) throw new Error( `Asset hash mismatch: ${path.relative( worldRoot, filePath )}` );
		const refs = references.get( id );
		const descriptions = [ ...new Set( refs.map( ref => `${ref.owner} — ${ref.kind}` ) ) ];
		for ( const sourceFile of sourceByHash.get( id ) || [] ) descriptions.push( `Editable source: ${sourceFile}` );
		descriptions.sort();
		entries.set( id, { id, bytes: bytes.length, format: detectFormat( bytes, refs ), descriptions } );
	}

	const assetFiles = ( await readdir( assetsPath, { withFileTypes: true } ) )
		.filter( entry => entry.isFile() && /^[0-9a-f]{64}$/.test( entry.name ) )
		.map( entry => entry.name );
	for ( const name of assetFiles ) if ( ! entries.has( name ) ) throw new Error( `Unreferenced content asset: assets/${name}` );
	if ( assetFiles.length !== entries.size ) throw new Error( 'The package contains missing or duplicate asset records' );

	const rows = [ ...entries.values() ].sort( ( a, b ) => a.descriptions[ 0 ].localeCompare( b.descriptions[ 0 ] ) || a.id.localeCompare( b.id ) );
	const lines = [
		`# ${source.title} asset index`,
		'',
		`Generated from [world-source.json](world-source.json) (${rows.length} verified content-addressed assets).`,
		'Each filename is the SHA-256 of the exact packaged bytes. Keep these names immutable; use the descriptions and use sites below to identify the assets.',
		'',
		'| Description / use | Format | Size | SHA-256 asset |',
		'| --- | --- | ---: | --- |',
	];
	for ( const row of rows ) {
		const description = row.descriptions.join( '<br>' ).replaceAll( '|', '\\|' );
		lines.push( `| ${description} | ${row.format} | ${formatBytes( row.bytes )} | [\`${row.id}\`](assets/${row.id}) |` );
	}
	lines.push( '', 'Regenerate this index with the owning world repository exporter. Every referenced package file is checked against its SHA-256.', '' );
	return lines.join( '\n' );
}

export async function writeWorldAssetIndex( worldRoot ) {
	const target = path.join( path.resolve( worldRoot ), 'ASSET-INDEX.md' );
	const content = await renderWorldAssetIndex( worldRoot );
	await writeFile( target, content );
	return { target, entries: ( content.match( /^\| .*\| .*\| .*\| \[`/gm ) || [] ).length };
}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {
	const args = process.argv.slice( 2 );
	const check = args.includes( '--check' );
	const worldRootArg = args.find( arg => arg !== '--check' );
	if ( ! worldRootArg ) throw new Error( 'Usage: node tools/world-asset-index.mjs [--check] <world-root>' );
	const worldRoot = path.resolve( repo, worldRootArg );
	const expected = await renderWorldAssetIndex( worldRoot );
	const target = path.join( worldRoot, 'ASSET-INDEX.md' );
	if ( check ) {
		const current = await readFile( target, 'utf8' );
		if ( current !== expected ) throw new Error( `${target} is out of date; rerun the world exporter` );
		console.log( `ok ${path.relative( repo, target )} is current` );
	} else {
		await writeFile( target, expected );
		console.log( `Wrote ${path.relative( repo, target )} (${( expected.match( /^\| .*\| .*\| .*\| \[`/gm ) || [] ).length} assets)` );
	}
}
