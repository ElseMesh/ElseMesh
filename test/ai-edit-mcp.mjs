import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { testTempRoot } from './temp-root.mjs';
import { createWorldSource } from '../src/network/WorldSource.js';
import { createAITaskBundle } from '../tools/create-ai-edit-task.mjs';
import { readAIEditTaskContext } from '../tools/ai-editor-mcp.mjs';
import { validateAITaskBundle } from '../tools/run-ai-edit-worker.mjs';

const temporaryRoot = await mkdtemp( path.join( testTempRoot, 'elsemesh-ai-mcp-' ) );
let serverProcess;
try {
	const input = path.join( temporaryRoot, 'input' );
	const assetsPath = path.join( input, 'assets' );
	await mkdir( assetsPath, { recursive: true } );
	const assetBytes = Buffer.from( 'fixture-glb' );
	const assetId = `sha256:${createHash( 'sha256' ).update( assetBytes ).digest( 'hex' )}`;
	const world = createWorldSource( { worldId: 'elsemesh:ai-mcp-test', title: 'MCP test world' } );
	world.objects.push( { id: 'elsemesh-object:selected', kind: 'asset-instance', label: 'Selected prop', assetId, priority: 'visible', transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } } );
	world.objects.push( { id: 'elsemesh-object:unselected', kind: 'asset-instance', label: 'Private prop', assetId, priority: 'visible', transform: { position: [ 1, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } } );
	const sourcePath = path.join( input, 'world-source.json' );
	const blendPath = path.join( input, 'scene.blend' );
	await writeFile( sourcePath, `${JSON.stringify( world, null, 2 )}\n` );
	await writeFile( blendPath, 'opaque-scene-fixture' );
	await writeFile( path.join( assetsPath, assetId.slice( 7 ) ), assetBytes );
	const taskPath = path.join( temporaryRoot, 'task' );
	const task = await createAITaskBundle( { sourcePath, blendPath, assetsPath, instruction: 'Move the selected prop slightly east.', outTaskPath: taskPath, objectIds: [ 'elsemesh-object:selected' ] } );

	const context = await readAIEditTaskContext( taskPath );
	assert.equal( context.protocol, 'elsemesh.ai-edit-context/1' );
	assert.equal( context.task.taskId, task.taskId );
	assert.deepEqual( context.editableObjects.map( ( object ) => object.id ), [ 'elsemesh-object:selected' ] );
	assert.deepEqual( context.availableAssets, [ assetId ] );
	assert.equal( context.worker.ownerKeysAvailable, false );

	serverProcess = spawn( process.execPath, [ path.resolve( 'tools/ai-editor-mcp.mjs' ), '--task', taskPath, '--out', path.join( temporaryRoot, 'candidate' ) ], { stdio: [ 'pipe', 'pipe', 'pipe' ] } );
	let stdout = '';
	let stderr = '';
	const messages = [];
	serverProcess.stdout.setEncoding( 'utf8' );
	serverProcess.stderr.setEncoding( 'utf8' );
	serverProcess.stdout.on( 'data', ( chunk ) => {
		stdout += chunk;
		for ( const line of stdout.split( '\n' ).slice( 0, -1 ) ) {
			try { messages.push( JSON.parse( line ) ); } catch {}
		}
		stdout = stdout.slice( stdout.lastIndexOf( '\n' ) + 1 );
	} );
	serverProcess.stderr.on( 'data', ( chunk ) => { stderr += chunk; } );
	let nextId = 1;
	async function request(method, params = {}) {
		const id = nextId ++;
		serverProcess.stdin.write( `${JSON.stringify( { jsonrpc: '2.0', id, method, params } )}\n` );
		const deadline = Date.now() + 5000;
		while ( Date.now() < deadline ) {
			const match = messages.find( ( message ) => message.id === id );
			if ( match ) {
				messages.splice( messages.indexOf( match ), 1 );
				return match;
			}
			await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
		}
		throw new Error( `MCP request timed out: ${method}; stderr=${stderr}` );
	}
	const initialized = await request( 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'elsemesh-test', version: '1.0.0' } } );
	assert.equal( initialized.error, undefined );
	serverProcess.stdin.write( `${JSON.stringify( { jsonrpc: '2.0', method: 'notifications/initialized' } )}\n` );
	const listed = await request( 'tools/list' );
	assert.deepEqual( listed.result.tools.map( ( tool ) => tool.name ).sort(), [ 'get_task_context', 'run_candidate', 'submit_action_plan' ] );
	const toolContext = await request( 'tools/call', { name: 'get_task_context', arguments: {} } );
	assert.equal( JSON.parse( toolContext.result.content[ 0 ].text ).task.taskId, task.taskId );
	const submitted = await request( 'tools/call', {
		name: 'submit_action_plan',
		arguments: { actions: [ { op: 'object.update', id: 'elsemesh-object:selected', fields: { transform: { position: [ 0.25, 0, 0 ], yaw: 0 } } } ] },
	} );
	assert.equal( submitted.result.isError, undefined );
	assert.equal( JSON.parse( submitted.result.content[ 0 ].text ).actionCount, 1 );
	const planPath = path.join( taskPath, 'plan.json' );
	assert.equal( ( await readFile( planPath, 'utf8' ) ).includes( task.sourceHash ), true );
	const rejected = await request( 'tools/call', { name: 'submit_action_plan', arguments: { actions: [ { op: 'object.remove', id: 'elsemesh-object:unselected' } ] } } );
	assert.equal( rejected.error, undefined );
	assert.equal( rejected.result.isError, true );
	assert.match( rejected.result.content[ 0 ].text, /outside the task object allow-list/ );
	const verifiedBundle = await validateAITaskBundle( taskPath );
	assert.deepEqual( verifiedBundle.actionCounts, { 'object.update': 1 } );
	const afterSubmitContext = await readAIEditTaskContext( taskPath );
	assert.equal( afterSubmitContext.task.sourceHash, task.sourceHash, 'context remains readable after the one-time plan is submitted' );
	process.stdout.write( 'ok MCP exposes scoped task context and accepts one validated, immutable action plan\n' );
} finally {
	if ( serverProcess && serverProcess.exitCode === null ) {
		serverProcess.kill( 'SIGTERM' );
		await Promise.race( [ once( serverProcess, 'exit' ), new Promise( ( resolve ) => setTimeout( resolve, 1000 ) ) ] );
	}
	await rm( temporaryRoot, { recursive: true, force: true } );
}
