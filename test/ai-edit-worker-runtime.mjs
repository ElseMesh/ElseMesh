#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testTempRoot } from './temp-root.mjs';
import { createWorldSource } from '../src/network/WorldSource.js';
import { createAITaskBundle } from '../tools/create-ai-edit-task.mjs';
import { prepareAIEditPublication } from '../tools/prepare-ai-edit-publication.mjs';
import { runAIEditWorker } from '../tools/run-ai-edit-worker.mjs';

if ( process.env.ELSEMESH_RUN_BLENDER_WORKER !== '1' ) {
	console.log( 'skip sandboxed Blender worker integration (set ELSEMESH_RUN_BLENDER_WORKER=1 explicitly)' );
	process.exit( 0 );
}

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const blenderPrefix = path.resolve( process.env.BLENDER_PREFIX || '/usr' );
const blender = path.resolve( process.env.BLENDER_EXECUTABLE || path.join( blenderPrefix, 'bin/blender' ) );
const blenderResources = path.join( blenderPrefix, 'share/blender' );
const temporaryRoot = await mkdtemp( path.join( testTempRoot, 'elsemesh-ai-worker-runtime-' ) );

try {
	const sourcePath = path.join( temporaryRoot, 'world-source.json' );
	const blendPath = path.join( temporaryRoot, 'scene.blend' );
	const assetsPath = path.join( temporaryRoot, 'assets' );
	const taskPath = path.join( temporaryRoot, 'task' );
	const outputPath = path.join( temporaryRoot, 'candidate' );
	const publicationPath = path.join( temporaryRoot, 'publication-package' );
	await mkdir( assetsPath );
	const source = createWorldSource( { worldId: 'tw-world:ai-worker-runtime' } );
	await writeFile( sourcePath, `${JSON.stringify( source, null, 2 )}\n` );
	const blenderEnvironment = {
		...process.env,
		BLENDER_SYSTEM_RESOURCES: blenderResources,
		BLENDER_SYSTEM_SCRIPTS: path.join( blenderResources, 'scripts' ),
		BLENDER_SYSTEM_DATAFILES: path.join( blenderResources, 'datafiles' ),
		BLENDER_USER_CONFIG: path.join( temporaryRoot, 'blender-config' ),
		BLENDER_USER_SCRIPTS: path.join( temporaryRoot, 'blender-scripts' ),
		BLENDER_USER_DATAFILES: path.join( temporaryRoot, 'blender-datafiles' ),
		PYTHONDONTWRITEBYTECODE: '1',
	};
	const runtimeLibraryPaths = [ path.join( blenderPrefix, 'lib' ), path.join( blenderPrefix, 'lib/x86_64-linux-gnu' ), '/usr/lib', '/usr/lib/x86_64-linux-gnu' ];
	if ( blenderPrefix !== '/usr' ) blenderEnvironment.LD_LIBRARY_PATH = [ ...runtimeLibraryPaths, process.env.LD_LIBRARY_PATH ].filter( Boolean ).join( ':' );
	const saveScene = spawnSync( blender, [ '--background', '--factory-startup', '--python-expr', `import bpy; bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False); bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify( blendPath )})` ], { env: blenderEnvironment, encoding: 'utf8' } );
	if ( saveScene.status !== 0 ) throw new Error( `could not create test Blender scene:\n${saveScene.stdout || ''}${saveScene.stderr || ''}` );

	const task = await createAITaskBundle( {
		sourcePath, blendPath, assetsPath, instruction: 'Add a bounded wooden test prop.', outTaskPath: taskPath,
	} );
	const objectId = 'tw-object:worker-runtime-prop';
	await writeFile( path.join( taskPath, 'plan.json' ), `${JSON.stringify( {
		protocol: task.actionProtocol,
		sourceHash: task.sourceHash,
		actions: [ {
			op: 'mesh.create',
			object: {
				id: objectId, kind: 'asset-instance', label: 'Worker runtime prop', priority: 'visible',
				transform: { position: [ 1, 0, 2 ], yaw: 0 }, scale: [ 1, 1, 1 ],
				collision: { shape: 'none', enabled: false },
			},
			parts: [ { shape: 'box', dimensions: [ 0.8, 0.5, 0.4 ], position: [ 0, 0.25, 0 ], material: 'wood' } ],
		} ],
	} )}\n` );

	const report = await runAIEditWorker( { taskPath, outputPath, blender, blenderPrefix } );
	assert.deepEqual( report.addedObjectIds, [ objectId ] );
	assert.equal( report.objectChanges.length, 1 );
	assert.equal( report.objectChanges[ 0 ].status, 'added' );
	assert.equal( report.objectChanges[ 0 ].after.id, objectId );
	assert.equal( report.signed, false );
	assert.equal( report.published, false );
	const candidate = JSON.parse( await readFile( path.join( outputPath, 'candidate.world-source.json' ), 'utf8' ) );
	const generatedAssetId = candidate.objects.find( ( object ) => object.id === objectId )?.assetId;
	assert.match( generatedAssetId || '', /^sha256:[0-9a-f]{64}$/ );
	const generatedAsset = path.join( outputPath, 'assets', generatedAssetId.slice( 7 ) );
	const assetHash = `sha256:${createHash( 'sha256' ).update( await readFile( generatedAsset ) ).digest( 'hex' )}`;
	assert.equal( assetHash, generatedAssetId );
	assert.deepEqual( report.generatedAssets, [ { id: generatedAssetId, bytes: ( await readFile( generatedAsset ) ).length } ] );
	const candidateBlend = path.join( outputPath, 'candidate.blend' );
	assert.ok( ( await readFile( candidateBlend ) ).length > 100_000 );
	const inspectBlend = spawnSync( blender, [ '--background', candidateBlend, '--python-expr', "import bpy; assert bpy.data.objects.get('ElseMesh Temporary Review Camera') is None" ], { env: blenderEnvironment, encoding: 'utf8' } );
	assert.equal( inspectBlend.status, 0, `candidate blend must not retain temporary preview setup:\n${inspectBlend.stdout || ''}\n${inspectBlend.stderr || ''}` );
	const previewPath = path.join( outputPath, 'review-preview.png' );
	const previewBytes = await readFile( previewPath );
	assert.deepEqual( previewBytes.subarray( 0, 8 ), Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] ) );
	assert.equal( previewBytes.readUInt32BE( 16 ), 640 );
	assert.equal( previewBytes.readUInt32BE( 20 ), 420 );
	const review = JSON.parse( await readFile( path.join( outputPath, 'review.json' ), 'utf8' ) );
	assert.equal( review.candidateSourceHash, report.candidateSourceHash );
	assert.equal( review.preview.file, 'review-preview.png' );
	assert.equal( review.preview.sha256, `sha256:${createHash( 'sha256' ).update( previewBytes ).digest( 'hex' )}` );
	const reviewHTML = await readFile( path.join( outputPath, 'review.html' ), 'utf8' );
	assert.ok( reviewHTML.includes( 'Unsigned candidate' ) );
	assert.ok( reviewHTML.includes( generatedAssetId ) );
	assert.ok( reviewHTML.includes( 'review-preview.png' ) );
	const prepared = await prepareAIEditPublication( { baseSourcePath: sourcePath, baseAssetsPath: assetsPath, candidatePath: outputPath, outputPath: publicationPath } );
	assert.equal( prepared.published, false );
	assert.equal( prepared.preview, true );
	assert.equal( prepared.generatedAssets, 1 );
	assert.deepEqual( await readFile( path.join( publicationPath, 'assets', generatedAssetId.slice( 7 ) ) ), await readFile( generatedAsset ) );
	assert.deepEqual( await readFile( path.join( publicationPath, 'review-preview.png' ) ), previewBytes );
	const preparedReview = JSON.parse( await readFile( path.join( publicationPath, 'review.json' ), 'utf8' ) );
	assert.deepEqual( preparedReview.addedObjectIds, [ objectId ] );
	assert.ok( ( await readFile( path.join( publicationPath, 'PUBLISHING.md' ), 'utf8' ) ).includes( 'still unsigned and unpublished' ) );
	console.log( 'ok isolated Blender worker produced a verified candidate and complete, unsigned owner publication package' );
} finally {
	await rm( temporaryRoot, { recursive: true, force: true } );
}
