#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorldSource } from '../src/network/WorldSource.js';
import { MAX_WORLD_PACKAGE_BYTES } from '../src/network/WorldRules.js';
import { sourceAssetIDs, MAX_BLEND_BYTES, MAX_SOURCE_BYTES } from './create-ai-edit-task.mjs';
import { renderAIEditReviewHTML } from './ai-edit-review-html.mjs';

const HASH = /^sha256:[0-9a-f]{64}$/;
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PACKAGE_BYTES = MAX_WORLD_PACKAGE_BYTES;
const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;
const MAX_PREPARED_BYTES = MAX_WORLD_PACKAGE_BYTES + MAX_BLEND_BYTES + 2 * MAX_SOURCE_BYTES + MAX_PREVIEW_BYTES;
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
	const args = {};
	for ( let i = 0; i < argv.length; i ++ ) {
		const key = argv[ i ];
		if ( ! [ '--base-source', '--base-assets', '--candidate', '--out' ].includes( key ) || ! argv[ i + 1 ] ) throw new Error( `Invalid or incomplete option: ${key}` );
		args[ key.slice( 2 ) ] = argv[ ++ i ];
	}
	for ( const key of [ 'base-source', 'base-assets', 'candidate', 'out' ] ) if ( ! args[ key ] ) throw new Error( `Missing ${key}` );
	return Object.fromEntries( Object.entries( args ).map( ( [ key, value ] ) => [ key, path.resolve( value ) ] ) );
}

function isWithin(parent, child) {
	const relative = path.relative( parent, child );
	return relative === '' || ( relative !== '..' && ! relative.startsWith( `..${path.sep}` ) && ! path.isAbsolute( relative ) );
}

async function realDirectory(input, label) {
	const info = await lstat( input );
	if ( ! info.isDirectory() || info.isSymbolicLink() ) throw new Error( `${label} must be a real directory` );
	return realpath( input );
}

async function regularFile(input, limit, label) {
	const info = await lstat( input );
	if ( ! info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit ) throw new Error( `${label} must be a single-link regular file within its size limit` );
	return info;
}

async function digest(input) {
	const hash = createHash( 'sha256' );
	for await ( const chunk of createReadStream( input ) ) hash.update( chunk );
	return `sha256:${hash.digest( 'hex' )}`;
}

function canonical(value) {
	if ( Array.isArray( value ) ) return value.map( canonical );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.keys( value ).sort().map( ( key ) => [ key, canonical( value[ key ] ) ] ) );
	return value;
}

function equalRecord(left, right) {
	return JSON.stringify( canonical( left ) ) === JSON.stringify( canonical( right ) );
}

function recordChanges(beforeRecords, afterRecords) {
	const before = new Map( beforeRecords.map( ( record ) => [ record.id, record ] ) );
	const after = new Map( afterRecords.map( ( record ) => [ record.id, record ] ) );
	return [ ...new Set( [ ...before.keys(), ...after.keys() ] ) ].sort().flatMap( ( id ) => {
		const previous = before.get( id );
		const next = after.get( id );
		if ( previous && next && equalRecord( previous, next ) ) return [];
		return [ { id, status: previous ? next ? 'changed' : 'removed' : 'added', before: previous ?? null, after: next ?? null } ];
	} );
}

async function copyPrivate(source, destination) {
	await copyFile( source, destination );
	await chmod( destination, 0o600 );
}

async function readSource(input, label) {
	const info = await regularFile( input, MAX_SOURCE_BYTES, label );
	const bytes = await readFile( input );
	const source = validateWorldSource( JSON.parse( bytes.toString( 'utf8' ) ) );
	return { bytes, source, info, hash: `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}` };
}

async function verifyPreview(candidateRoot, report) {
	const previewPath = path.join( candidateRoot, 'review-preview.png' );
	const entries = await readdir( candidateRoot );
	const hasFile = entries.includes( 'review-preview.png' );
	if ( ! hasFile ) {
		if ( report.preview !== null && report.preview !== undefined ) throw new Error( 'candidate review report names a preview file that is missing' );
		return null;
	}
	const info = await regularFile( previewPath, MAX_PREVIEW_BYTES, 'rendered review preview' );
	const bytes = await readFile( previewPath );
	if ( bytes.length < 24 || ! bytes.subarray( 0, 8 ).equals( Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ) ) || bytes.readUInt32BE( 16 ) !== 640 || bytes.readUInt32BE( 20 ) !== 420 ) throw new Error( 'rendered review preview must be a 640x420 PNG' );
	const sha256 = `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
	if ( report.preview?.file !== 'review-preview.png' || report.preview.sha256 !== sha256 || report.preview.bytes !== info.size ) throw new Error( 'rendered review preview does not match the review report' );
	return { file: 'review-preview.png', bytes: info.size, sha256 };
}

export async function prepareAIEditPublication({ baseSourcePath, baseAssetsPath, candidatePath, outputPath }) {
	const candidateRoot = await realDirectory( candidatePath, 'candidate bundle' );
	const baseAssetsRoot = await realDirectory( baseAssetsPath, 'base assets' );
	const baseSource = await readSource( baseSourcePath, 'base source' );
	const candidateSourcePath = path.join( candidateRoot, 'candidate.world-source.json' );
	const candidateSource = await readSource( candidateSourcePath, 'candidate source' );
	const reportPath = path.join( candidateRoot, 'review.json' );
	await regularFile( reportPath, MAX_SOURCE_BYTES, 'worker review report' );
	const workerReport = JSON.parse( await readFile( reportPath, 'utf8' ) );
	if ( workerReport.protocol !== 'elsemesh.ai-edit-review/1' || ! TASK_ID.test( workerReport.taskId || '' ) || workerReport.signed !== false || workerReport.published !== false ) throw new Error( 'candidate must be an unsigned, unpublished AI edit review bundle' );
	if ( workerReport.baseSourceHash !== baseSource.hash || workerReport.candidateSourceHash !== candidateSource.hash ) throw new Error( 'review report source hashes do not match the supplied base and candidate source files' );
	if ( workerReport.worldId !== baseSource.source.worldId || candidateSource.source.worldId !== baseSource.source.worldId ) throw new Error( 'base source, candidate, and review report must name the same world' );
	if ( typeof workerReport.instruction !== 'string' || ! workerReport.instruction.trim() || workerReport.instruction.length > 8000 ) throw new Error( 'review report has an invalid edit instruction' );
	const preview = await verifyPreview( candidateRoot, workerReport );

	const allowedRootFiles = new Set( [ 'candidate.world-source.json', 'candidate.blend', 'review.json', 'review.html', ...( preview ? [ preview.file ] : [] ) ] );
	const candidateEntries = await readdir( candidateRoot, { withFileTypes: true } );
	if ( candidateEntries.some( ( entry ) => entry.isSymbolicLink() || ! allowedRootFiles.has( entry.name ) && entry.name !== 'assets' ) ) throw new Error( 'candidate bundle contains undeclared files' );
	const blendPath = path.join( candidateRoot, 'candidate.blend' );
	const blendInfo = await regularFile( blendPath, MAX_BLEND_BYTES, 'candidate Blender scene' );
	if ( ! candidateEntries.some( ( entry ) => entry.name === 'review.html' && entry.isFile() ) ) throw new Error( 'candidate bundle is missing its owner review page' );

	const baseAssetIds = sourceAssetIDs( baseSource.source );
	const candidateAssetIds = sourceAssetIDs( candidateSource.source );
	const referencedIds = [ ...candidateAssetIds ].sort();
	if ( referencedIds.length > 10000 ) throw new Error( 'candidate references more assets than worldd can publish' );
	const candidateAssetRoot = path.join( candidateRoot, 'assets' );
	const hasCandidateAssets = candidateEntries.some( ( entry ) => entry.name === 'assets' );
	let candidateAssetNames = [];
	if ( hasCandidateAssets ) {
		await realDirectory( candidateAssetRoot, 'candidate assets' );
		candidateAssetNames = ( await readdir( candidateAssetRoot ) ).sort();
		if ( candidateAssetNames.some( ( name ) => ! /^[0-9a-f]{64}$/.test( name ) ) ) throw new Error( 'candidate assets must use content-addressed SHA-256 filenames' );
	}
	const generatedIds = candidateAssetNames.map( ( name ) => `sha256:${name}` );
	for ( const id of generatedIds ) if ( ! candidateAssetIds.has( id ) ) throw new Error( `candidate bundle contains an asset not referenced by its source: ${id}` );
	if ( ! Array.isArray( workerReport.generatedAssets ) || workerReport.generatedAssets.some( ( item ) => ! item || ! HASH.test( item.id || '' ) || ! Number.isSafeInteger( item.bytes ) || item.bytes < 0 ) ) throw new Error( 'candidate review report has an invalid generated-assets list' );
	const reportedGeneratedIds = workerReport.generatedAssets.map( ( item ) => item.id ).sort();
	if ( JSON.stringify( reportedGeneratedIds ) !== JSON.stringify( generatedIds ) ) throw new Error( 'candidate asset files do not match the worker review report' );

	const assetSources = new Map();
	let totalBytes = baseSource.info.size + candidateSource.info.size + blendInfo.size + ( preview?.bytes || 0 );
	let packageAssetBytes = 0;
	const generatedAssets = [];
	for ( const id of referencedIds ) {
		if ( ! HASH.test( id ) ) throw new Error( `candidate contains an invalid asset ID: ${id}` );
		const name = id.slice( 7 );
		const candidateAsset = path.join( candidateAssetRoot, name );
		const baseAsset = path.join( baseAssetsRoot, name );
		let selected;
		if ( baseAssetIds.has( id ) ) {
			const info = await regularFile( baseAsset, MAX_ASSET_BYTES, 'base world asset' );
			if ( await digest( baseAsset ) !== id ) throw new Error( `base world asset failed SHA-256 verification: ${id}` );
			selected = { path: baseAsset, info };
		} else {
			try {
				const info = await regularFile( candidateAsset, MAX_ASSET_BYTES, 'candidate asset' );
				if ( await digest( candidateAsset ) !== id ) throw new Error( `candidate asset failed SHA-256 verification: ${id}` );
				selected = { path: candidateAsset, info };
			} catch ( error ) {
				if ( error.code !== 'ENOENT' ) throw error;
				const info = await regularFile( baseAsset, MAX_ASSET_BYTES, 'base world asset' );
				if ( await digest( baseAsset ) !== id ) throw new Error( `base world asset failed SHA-256 verification: ${id}` );
				selected = { path: baseAsset, info };
			}
		}
		assetSources.set( id, selected );
		totalBytes += selected.info.size;
		packageAssetBytes += selected.info.size;
		if ( generatedIds.includes( id ) ) generatedAssets.push( { id, bytes: selected.info.size } );
		if ( totalBytes > MAX_PREPARED_BYTES ) throw new Error( 'prepared owner package exceeds the supported size limit' );
	}
	if ( packageAssetBytes > MAX_PACKAGE_BYTES ) throw new Error( 'complete referenced assets exceed the supported 16 GiB world package limit' );
	if ( candidateSource.source.rules.maxPackageBytes !== undefined && packageAssetBytes > candidateSource.source.rules.maxPackageBytes ) throw new Error( 'complete referenced assets exceed this world\'s maxPackageBytes rule' );

	const objectChanges = recordChanges( baseSource.source.objects, candidateSource.source.objects );
	const portalChanges = recordChanges( baseSource.source.portals, candidateSource.source.portals );
	const worldChanges = [ 'title', 'styleGuide', 'rules', 'hosts', 'components' ].filter( ( key ) => ! equalRecord( candidateSource.source[ key ], baseSource.source[ key ] ) ).map( ( field ) => ( { field, before: baseSource.source[ field ], after: candidateSource.source[ field ] } ) );
	const blendHash = await digest( blendPath );
	const report = {
		protocol: 'elsemesh.ai-edit-review/1', taskId: workerReport.taskId,
		worldId: candidateSource.source.worldId, worldTitle: candidateSource.source.title,
		instruction: workerReport.instruction, baseSourceFile: 'base.world-source.json',
		baseSourceHash: baseSource.hash, candidateSourceHash: candidateSource.hash,
		candidateSourceBytes: candidateSource.info.size, candidateBlendHash: blendHash, outputBytes: totalBytes,
		actionCounts: {}, preview,
		objectChanges, portalChanges, worldChanges, generatedAssets,
		addedObjectIds: objectChanges.filter( ( change ) => change.status === 'added' ).map( ( change ) => change.id ),
		removedObjectIds: objectChanges.filter( ( change ) => change.status === 'removed' ).map( ( change ) => change.id ),
		changedObjectIds: objectChanges.filter( ( change ) => change.status === 'changed' ).map( ( change ) => change.id ),
		addedPortalIds: portalChanges.filter( ( change ) => change.status === 'added' ).map( ( change ) => change.id ),
		removedPortalIds: portalChanges.filter( ( change ) => change.status === 'removed' ).map( ( change ) => change.id ),
		changedPortalIds: portalChanges.filter( ( change ) => change.status === 'changed' ).map( ( change ) => change.id ),
		changedWorldFields: worldChanges.map( ( change ) => change.field ),
		validation: { candidateSource: 'passed', referencedAssetHashes: 'passed', previewHash: preview ? 'passed' : 'not-available', ownerSignature: 'not-created', publication: 'not-performed' },
		signed: false, published: false,
	};

	const requestedOutput = path.resolve( outputPath );
	const parent = await realpath( path.dirname( requestedOutput ) );
	const output = path.join( parent, path.basename( requestedOutput ) );
	if ( isWithin( candidateRoot, output ) || isWithin( output, candidateRoot ) || isWithin( baseAssetsRoot, output ) || isWithin( output, baseAssetsRoot ) ) throw new Error( 'prepared output must be separate from candidate and base asset inputs' );
	try { await lstat( output ); throw new Error( 'prepared output directory already exists' ); }
	catch ( error ) { if ( error.code !== 'ENOENT' ) throw error; }
	const stage = await mkdtemp( path.join( parent, '.elsemesh-ai-publication-' ) );
	let outputCreated = false;
	try {
		await writeFile( path.join( stage, 'base.world-source.json' ), baseSource.bytes, { mode: 0o600, flag: 'wx' } );
		await writeFile( path.join( stage, 'candidate.world-source.json' ), candidateSource.bytes, { mode: 0o600, flag: 'wx' } );
		await copyPrivate( blendPath, path.join( stage, 'candidate.blend' ) );
		if ( await digest( path.join( stage, 'candidate.blend' ) ) !== blendHash ) throw new Error( 'candidate Blender scene changed while preparing the package' );
		if ( preview ) {
			await copyPrivate( path.join( candidateRoot, preview.file ), path.join( stage, preview.file ) );
			if ( await digest( path.join( stage, preview.file ) ) !== preview.sha256 ) throw new Error( 'rendered review preview changed while preparing the package' );
		}
		const assetsOut = path.join( stage, 'assets' );
		await mkdir( assetsOut, { mode: 0o700 } );
		for ( const [ id, item ] of assetSources ) {
			const destination = path.join( assetsOut, id.slice( 7 ) );
			await copyPrivate( item.path, destination );
			if ( await digest( destination ) !== id ) throw new Error( `asset changed while preparing the package: ${id}` );
		}
		await writeFile( path.join( stage, 'review.json' ), `${JSON.stringify( report, null, 2 )}\n`, { mode: 0o600, flag: 'wx' } );
		await writeFile( path.join( stage, 'review.html' ), renderAIEditReviewHTML( report ), { mode: 0o600, flag: 'wx' } );
		await writeFile( path.join( stage, 'PUBLISHING.md' ), [
			'# Owner publication checklist', '',
			'This package is still unsigned and unpublished. Review `review.html`, compare the source and Blender scene, and confirm the selected owner profile before continuing.', '',
			'Publish only after review using the owner-only command:', '',
			'```sh',
			'node tools/publish-world-source.mjs \\',
			'  --worldd /path/to/worldd \\',
			'  --data /path/to/owner/world-profile \\',
			'  --base-source ./base.world-source.json \\',
			'  --source ./candidate.world-source.json \\',
			'  --assets ./assets',
			'```', '',
			'Review the command paths and verify the base-source hash against the active profile. Publication is a separate, explicit owner action.', '',
		].join( '\n' ), { mode: 0o600, flag: 'wx' } );
		await mkdir( output, { mode: 0o700 } );
		outputCreated = true;
		for ( const name of await readdir( stage ) ) await rename( path.join( stage, name ), path.join( output, name ) );
		await rm( stage, { recursive: true } );
		return { output, worldId: report.worldId, objectChanges: objectChanges.length, portalChanges: portalChanges.length, assets: assetSources.size, generatedAssets: generatedAssets.length, preview: Boolean( preview ), published: false };
	} catch ( error ) {
		if ( outputCreated ) await rm( output, { recursive: true, force: true } );
		throw error;
	} finally {
		await rm( stage, { recursive: true, force: true } );
	}
}

async function main() {
	const args = parseArgs( process.argv.slice( 2 ) );
	const result = await prepareAIEditPublication( {
		baseSourcePath: args[ 'base-source' ], baseAssetsPath: args[ 'base-assets' ], candidatePath: args.candidate, outputPath: args.out,
	} );
	console.log( `Prepared unsigned owner-review package for ${result.worldId} at ${result.output}` );
	console.log( `${result.assets} verified package assets (${result.generatedAssets} generated), ${result.objectChanges} object changes, ${result.portalChanges} portal changes; preview ${result.preview ? 'included' : 'not available'}.` );
	console.log( 'Nothing was signed or published. Review PUBLISHING.md and use the explicit owner publication command only after approval.' );
}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) main().catch( ( error ) => { console.error( error.message ); process.exitCode = 1; } );
