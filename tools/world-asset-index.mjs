#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );

const componentNames = new Map( [
	[ 'elsemesh.village-materials/2', 'Village PBR material package' ],
	[ 'elsemesh.static-vegetation/1', 'Vegetation placement data' ],
	[ 'elsemesh.static-fish-props/1', 'Fish-prop placement data' ],
	[ 'elsemesh.terrain-surface/1', 'Terrain visual-surface data' ],
	[ 'elsemesh.static-reef/1', 'Reef placement tile' ],
	[ 'elsemesh.humpback-whale/1', 'Humpback-whale asset' ],
	[ 'elsemesh.ambient-audio/1', 'Ambient audio loop' ],
] );

const fieldNames = new Map( [
	[ 'assetId', 'mesh' ],
	[ 'dataAssetId', 'component data' ],
	[ 'placementAssetId', 'placement data' ],
	[ 'grassMaskAssetId', 'grass density mask' ],
	[ 'modelAssetId', 'model metadata' ],
	[ 'geometryAssetId', 'model geometry' ],
	[ 'albedoAssetId', 'albedo texture' ],
	[ 'heightAssetId', 'height texture' ],
] );

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
	const componentType = refs.find( ref => ref.componentType )?.componentType;
	return componentType ? `Binary (${componentType})` : 'Binary data';
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

	function collect( value, pathParts = [], owner = null, componentType = null ) {
		if ( typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test( value ) ) {
			const id = value.slice( 'sha256:'.length );
			const refs = references.get( id ) || [];
			const field = pathParts.at( -1 ) || 'asset';
			const role = field === 'assetId' && pathParts.includes( 'extensions' ) ? 'world behavior module'
				: field === 'assetId' && pathParts.includes( 'lods' ) ? 'LOD mesh'
				: field === 'assetId' && componentType === 'elsemesh.ambient-audio/1' ? 'audio bed'
					: fieldNames.get( field ) || ( field === 'assetId' ? 'mesh' : field.replace( /Id$/, '' ) );
			refs.push( { owner: owner || 'World asset', role, componentType } );
			references.set( id, refs );
			return;
		}
		if ( Array.isArray( value ) ) {
			value.forEach( ( item, index ) => collect( item, [ ...pathParts, `[${index}]` ], owner, componentType ) );
			return;
		}
		if ( ! value || typeof value !== 'object' ) return;

		let nextOwner = owner;
		let nextType = componentType;
		if ( typeof value.label === 'string' ) nextOwner = value.label;
		if ( typeof value.type === 'string' && value.type.startsWith( 'elsemesh.' ) ) {
			nextType = value.type;
			const friendly = componentNames.get( value.type ) || value.type;
			const componentId = typeof value.id === 'string' ? value.id.replace( /^elsemesh-component:/, '' ) : '';
			nextOwner = value.type === 'elsemesh.static-reef/1' ? `${friendly} ${componentId.replace( /^reef-tile-/, '' )}` : friendly;
		}
		for ( const [ key, child ] of Object.entries( value ) ) collect( child, [ ...pathParts, key ], nextOwner, nextType );
	}

	collect( source );
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
	const descriptions = [ ...new Set( refs.map( ref => `${ref.owner} — ${ref.role}` ) ) ];
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
	lines.push( '', 'Regenerate with the ElseMesh exporter for this world. The exporter verifies every hash and fails if package files do not match the manifest.', '' );
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
	const worldRoot = path.resolve( repo, args.find( arg => arg !== '--check' ) || 'worlds/tidewater' );
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
