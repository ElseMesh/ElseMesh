import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateWorldComponents } from '../src/network/WorldConnector.js';
import { createWorldSource, validateWorldSource, WORLD_SOURCE_PROTOCOL } from '../src/network/WorldSource.js';
import { validateWorldRequirements } from '../src/network/WorldRules.js';

const temporaryRoot = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const root = await mkdtemp( path.join( temporaryRoot, 'elsemesh-generic-manifest-' ) );

try {
	const assetsPath = path.join( root, 'assets' );
	await mkdir( assetsPath );
	const bytes = Buffer.from( 'world-owned opaque component data' );
	const assetId = `sha256:${createHash( 'sha256' ).update( bytes ).digest( 'hex' )}`;
	await writeFile( path.join( assetsPath, assetId.slice( 'sha256:'.length ) ), bytes );
	const source = createWorldSource( { worldId: 'elsemesh:generic-manifest-test', title: 'Generic manifest test' } );
	source.updatedAt = '2026-10-01T12:00:00Z';
	source.rules.requiredFeatures = [ 'elsemesh.static-glb/1' ];
	source.components = [ {
		id: 'elsemesh-component:opaque-fixture',
		type: 'elsemesh.static-glb/1',
		priority: 'visible',
		assets: [ { assetId, kind: 'example-binary/1' } ],
		data: { ownerDefined: { nested: [ 1, true, 'opaque' ] } },
	} ];
	assert.equal( WORLD_SOURCE_PROTOCOL, 'elsemesh.world-source/3' );
	assert.doesNotThrow( () => validateWorldSource( source ) );
	assert.throws( () => validateWorldSource( { ...source, components: [ { ...source.components[ 0 ], data: [] } ] } ), /component envelope/ );
	assert.throws( () => validateWorldSource( { ...source, components: [ { ...source.components[ 0 ], extra: true } ] } ), /component envelope/ );

	await writeFile( path.join( root, 'world-source.json' ), JSON.stringify( source ) );
	const outputs = [ 'first.json', 'second.json' ];
	for ( const output of outputs ) execFileSync( process.execPath, [
		'tools/world-source-to-manifest.mjs', '--source', path.join( root, 'world-source.json' ),
		'--owner', 'owner-peer', '--assets', assetsPath, '--out', path.join( root, output ),
	], { stdio: 'pipe' } );
	const [ first, second ] = await Promise.all( outputs.map( output => readFile( path.join( root, output ) ) ) );
	assert.deepEqual( first, second, 'generic manifest conversion is byte deterministic' );
	const manifest = JSON.parse( first );
	assert.deepEqual( manifest.components, source.components, 'component envelope and opaque data survive conversion unchanged' );
	assert.deepEqual( manifest.assets, [ { id: assetId, bytes: bytes.length, kind: 'example-binary/1', priority: 'visible' } ], 'asset inventory derives only from generic references' );
	assert.doesNotThrow( () => validateWorldRequirements( manifest ) );
	assert.doesNotThrow( () => validateWorldComponents( manifest.components, manifest.rules, new Set(), manifest.assets, manifest.objects ) );
	console.log( 'ok generic source-to-manifest conversion' );
} finally {
	await rm( root, { recursive: true, force: true } );
}
