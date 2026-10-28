#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorldSource } from '../src/network/WorldSource.js';

export const AI_TASK_PROTOCOL = 'elsemesh.ai-edit-task/1';
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const MAX_BLEND_BYTES = 1024 * 1024 * 1024;
export const MAX_ASSET_BYTES = 256 * 1024 * 1024;
export const MAX_TASK_BYTES = 2 * 1024 * 1024 * 1024;
const ASSET_ID = /^sha256:[0-9a-f]{64}$/;
const OBJECT_ID = /^elsemesh-object:[\w.-]{1,128}$/;
const PORTAL_ID = /^elsemesh-portal:[\w.-]{1,128}$/;

function parseArgs(argv) {
	const result = { objectIds: [], portalIds: [], assetIds: [] };
	for ( let i = 0; i < argv.length; i ++ ) {
		const key = argv[ i ];
		if ( key === '--include-object' || key === '--include-portal' || key === '--include-asset' ) {
			const value = argv[ ++ i ];
			if ( ! value ) throw new Error( `Missing value for ${key}` );
			result[ key === '--include-object' ? 'objectIds' : key === '--include-portal' ? 'portalIds' : 'assetIds' ].push( value );
			continue;
		}
		if ( ! [ '--source', '--blend', '--assets', '--instruction', '--out-task' ].includes( key ) || ! argv[ i + 1 ] ) throw new Error( `Invalid or incomplete option: ${key}` );
		result[ key.slice( 2 ).replaceAll( '-', '' ) ] = argv[ ++ i ];
	}
	for ( const key of [ 'source', 'blend', 'assets', 'instruction', 'outtask' ] ) if ( ! result[ key ] ) throw new Error( `Missing --${key === 'outtask' ? 'out-task' : key}` );
	return result;
}

async function privateRegularFile(file, limit, label) {
	const info = await lstat( file );
	if ( ! info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > limit ) throw new Error( `${label} must be a single-link regular file within its size limit` );
	return info;
}

async function hashFile(file) {
	const hasher = createHash( 'sha256' );
	for await ( const chunk of createReadStream( file ) ) hasher.update( chunk );
	return `sha256:${hasher.digest( 'hex' )}`;
}

export function objectAssetIDs(object) {
	return [ object.assetId, ...( object.lods || [] ).map( ( level ) => level.assetId ) ].filter( ( id ) => ASSET_ID.test( id || '' ) );
}

export function sourceAssetIDs(source) {
	const ids = new Set( source.objects.flatMap( objectAssetIDs ) );
	for ( const component of source.components || [] ) {
		if ( ASSET_ID.test( component.placementAssetId || '' ) ) ids.add( component.placementAssetId );
		for ( const bed of component.beds || [] ) if ( ASSET_ID.test( bed.assetId || '' ) ) ids.add( bed.assetId );
	}
	return ids;
}

async function copyImmutable(source, target) {
	try { await copyFile( source, target, constants.COPYFILE_FICLONE ); }
	catch ( error ) {
		if ( error.code !== 'ENOTSUP' && error.code !== 'EOPNOTSUPP' && error.code !== 'EXDEV' && error.code !== 'EINVAL' ) throw error;
		await copyFile( source, target );
	}
	await chmod( target, 0o400 );
}

export async function createAITaskBundle({ sourcePath, blendPath, assetsPath, instruction, outTaskPath, objectIds = [], portalIds = [], assetIds = [] }) {
	if ( typeof instruction !== 'string' || ! instruction.trim() || instruction.length > 8000 ) throw new Error( 'instruction must contain 1 to 8000 characters' );
	if ( objectIds.length > 128 || new Set( objectIds ).size !== objectIds.length || objectIds.some( ( id ) => ! OBJECT_ID.test( id ) ) ) throw new Error( 'included object IDs must be at most 128 unique stable world object IDs' );
	if ( portalIds.length > 128 || new Set( portalIds ).size !== portalIds.length || portalIds.some( ( id ) => ! PORTAL_ID.test( id ) ) ) throw new Error( 'included portal IDs must be at most 128 unique stable portal IDs' );
	if ( assetIds.length > 256 || new Set( assetIds ).size !== assetIds.length || assetIds.some( ( id ) => ! ASSET_ID.test( id ) ) ) throw new Error( 'included asset IDs must be at most 256 unique SHA-256 content IDs' );
	const sourceInputInfo = await lstat( sourcePath );
	const blendInputInfo = await lstat( blendPath );
	const assetsInputInfo = await lstat( assetsPath );
	if ( sourceInputInfo.isSymbolicLink() || blendInputInfo.isSymbolicLink() || assetsInputInfo.isSymbolicLink() ) throw new Error( 'source inputs cannot be symlinks' );
	const sourceFile = await realpath( sourcePath );
	const blendFile = await realpath( blendPath );
	const assetsRoot = await realpath( assetsPath );
	const sourceInfo = await privateRegularFile( sourceFile, MAX_SOURCE_BYTES, 'source' );
	const blendInfo = await privateRegularFile( blendFile, MAX_BLEND_BYTES, 'Blender scene' );
	const assetsInfo = await lstat( assetsRoot );
	if ( ! assetsInfo.isDirectory() || assetsInfo.isSymbolicLink() ) throw new Error( 'assets must be a real directory' );
	const sourceBytes = await readFile( sourceFile );
	const source = validateWorldSource( JSON.parse( sourceBytes.toString( 'utf8' ) ) );
	const knownObjectIDs = new Set( source.objects.map( ( object ) => object.id ) );
	const knownPortalIDs = new Set( source.portals.map( ( portal ) => portal.id ) );
	if ( objectIds.some( ( id ) => ! knownObjectIDs.has( id ) ) ) throw new Error( 'an included object ID is not present in the world source' );
	if ( portalIds.some( ( id ) => ! knownPortalIDs.has( id ) ) ) throw new Error( 'an included portal ID is not present in the world source' );
	const available = sourceAssetIDs( source );
	const selectedAssetIDs = new Set( [ ...objectIds.flatMap( ( id ) => objectAssetIDs( source.objects.find( ( object ) => object.id === id ) ) ), ...assetIds ] );
	if ( [ ...selectedAssetIDs ].some( ( id ) => ! available.has( id ) ) ) throw new Error( 'an included asset ID is not referenced by the world source' );
	const requestedOutputPath = path.resolve( outTaskPath );
	const parent = await realpath( path.dirname( requestedOutputPath ) );
	const taskDir = path.join( parent, path.basename( requestedOutputPath ) );
	if ( taskDir === sourceFile || taskDir === blendFile || taskDir === assetsRoot || [ sourceFile, blendFile, assetsRoot ].some( ( item ) => item.startsWith( `${taskDir}${path.sep}` ) || taskDir.startsWith( `${item}${path.sep}` ) ) ) throw new Error( 'task bundle must be separate from all source inputs' );
	const stage = path.join( parent, `.${path.basename( taskDir )}.staging-${randomUUID()}` );
	const assetsDir = path.join( stage, 'assets' );
	let stageExists = false;
	let taskCreated = false;
	try {
		await mkdir( stage, { mode: 0o700 } ); stageExists = true;
		await mkdir( assetsDir, { mode: 0o700 } );
		await copyImmutable( sourceFile, path.join( stage, 'world-source.json' ) );
		await copyImmutable( blendFile, path.join( stage, 'scene.blend' ) );
		const snapshotBytes = await readFile( path.join( stage, 'world-source.json' ) );
		const snapshot = validateWorldSource( JSON.parse( snapshotBytes.toString( 'utf8' ) ) );
		if ( snapshot.worldId !== source.worldId || createHash( 'sha256' ).update( snapshotBytes ).digest( 'hex' ) !== createHash( 'sha256' ).update( sourceBytes ).digest( 'hex' ) ) throw new Error( 'world source changed while the task snapshot was being made' );
		let totalBytes = sourceInfo.size + blendInfo.size;
		for ( const assetId of selectedAssetIDs ) {
			const digest = assetId.slice( 'sha256:'.length );
			const asset = path.join( assetsRoot, digest );
			const assetInfo = await privateRegularFile( asset, MAX_ASSET_BYTES, `asset ${assetId}` );
			totalBytes += assetInfo.size;
			if ( totalBytes > MAX_TASK_BYTES ) throw new Error( 'task bundle exceeds the 2 GiB total size limit' );
			await copyImmutable( asset, path.join( assetsDir, digest ) );
			if ( await hashFile( path.join( assetsDir, digest ) ) !== assetId ) throw new Error( `asset content does not match ${assetId}` );
		}
		const sourceHash = `sha256:${createHash( 'sha256' ).update( snapshotBytes ).digest( 'hex' )}`;
		const blendHash = await hashFile( path.join( stage, 'scene.blend' ) );
		const task = {
			protocol: AI_TASK_PROTOCOL,
			taskId: randomUUID(),
			createdAt: new Date().toISOString(),
			worldId: source.worldId,
			worldTitle: source.title,
			sourceHash,
			blendHash,
			instruction: instruction.trim(),
			files: { source: 'world-source.json', blend: 'scene.blend', assets: 'assets', plan: 'plan.json' },
			includedObjectIds: [ ...objectIds ],
			includedPortalIds: [ ...portalIds ],
			availableAssetIds: [ ...selectedAssetIDs ].sort(),
			actionProtocol: 'elsemesh.blender-actions/1',
		};
		await writeFile( path.join( stage, 'task.json' ), `${JSON.stringify( task, null, 2 )}\n`, { mode: 0o600, flag: 'wx' } );
		await chmod( path.join( stage, 'task.json' ), 0o400 );
		await mkdir( taskDir, { mode: 0o700 } );
		taskCreated = true;
		const entries = await readdir( stage );
		for ( const entry of entries ) await rename( path.join( stage, entry ), path.join( taskDir, entry ) );
		await rm( stage, { recursive: true } );
		stageExists = false;
		return task;
	} catch ( error ) {
		if ( stageExists ) await rm( stage, { recursive: true, force: true } );
		if ( taskCreated ) await rm( taskDir, { recursive: true, force: true } );
		throw error;
	}
}

async function main() {
	const args = parseArgs( process.argv.slice( 2 ) );
	const task = await createAITaskBundle( {
		sourcePath: args.source, blendPath: args.blend, assetsPath: args.assets,
		instruction: args.instruction, outTaskPath: args.outtask, objectIds: args.objectIds, portalIds: args.portalIds, assetIds: args.assetIds,
	} );
	console.log( `Created review-only AI task ${task.taskId} for ${task.worldId}` );
	console.log( `Source snapshot: ${task.sourceHash}; included assets: ${task.availableAssetIds.length}` );
	console.log( 'Share only this task directory with the AI worker. It contains no owner key and does not authorize publication.' );
}

if ( process.argv[ 1 ] && path.resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) main().catch( ( error ) => { console.error( error.message ); process.exitCode = 1; } );
