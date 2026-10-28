import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyWorldProposal } from '../tools/apply-world-proposal.mjs';

const temporaryRoot = process.env.PREFIX ? path.join( process.env.PREFIX, 'tmp' ) : '/var/tmp';
const root = await mkdtemp( path.join( temporaryRoot, 'elsemesh-proposal-test-' ) );
const source = {
	protocol: 'elsemesh.world-source/3', worldId: 'elsemesh:proposal-test', title: 'Proposal test',
	coordinateSystem: 'right-handed-y-up-meters', styleGuide: '',
	rules: { gravity: 1, maxVisitors: 128, spawnRadius: 8, avatarComplexity: 100, physicsProfile: 'default' },
	objects: [ { id: 'elsemesh-object:crate', kind: 'asset-instance', label: 'Crate', transform: { position: [ 0, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } } ],
	portals: [], updatedAt: '2026-10-01T00:00:00Z',
};

try {
	const sourceBytes = Buffer.from( `${JSON.stringify( source, null, 2 )}\n` );
	const sourceHash = `sha256:${createHash( 'sha256' ).update( sourceBytes ).digest( 'hex' )}`;
	const proposal = {
		protocol: 'elsemesh.world-proposal/1', worldId: source.worldId, sourceHash,
		operations: [
			{ op: 'object.update', id: 'elsemesh-object:crate', fields: { transform: { position: [ 4, 0, 0 ], yaw: 0 }, priority: 'nearby' } },
			{ op: 'object.add', object: { id: 'elsemesh-object:lamp', kind: 'asset-instance', label: 'Lamp', transform: { position: [ 2, 0, 0 ], yaw: 0 }, scale: [ 1, 1, 1 ], collision: { shape: 'none', enabled: false } } },
			{ op: 'world.update', fields: { title: 'Revised proposal world' } },
		],
	};
	const { source: revised, counts } = applyWorldProposal( sourceBytes, proposal );
	assert.equal( revised.title, 'Revised proposal world' );
	assert.deepEqual( revised.objects[ 0 ].transform.position, [ 4, 0, 0 ] );
	assert.equal( revised.objects.length, 2 );
	assert.deepEqual( counts, { added: 1, updated: 2, removed: 0 } );
	assert.equal( source.title, 'Proposal test', 'proposal application never mutates the source snapshot' );
	assert.throws( () => applyWorldProposal( sourceBytes, { ...proposal, operations: [ { op: 'object.update', id: 'elsemesh-object:crate', fields: { id: 'elsemesh-object:takeover' } } ] } ), /protected or unsupported/ );
	assert.throws( () => applyWorldProposal( sourceBytes, { ...proposal, operations: [ { op: 'object.add', object: source.objects[ 0 ] } ] } ), /Invalid or duplicate object/ );
	assert.throws( () => applyWorldProposal( sourceBytes, { ...proposal, operations: [ { op: 'run-python', script: 'raise SystemExit' } ] } ), /Unsupported proposal operation/ );
	assert.throws( () => applyWorldProposal( sourceBytes, { ...proposal, sourceHash: `sha256:${'0'.repeat( 64 )}` } ), /source hash mismatch/ );
	assert.throws( () => applyWorldProposal( sourceBytes, { ...proposal, worldId: 'elsemesh:someone-elses-world' } ), /world ID does not match/ );

	const sourcePath = path.join( root, 'source.json' );
	const proposalPath = path.join( root, 'proposal.json' );
	const outputPath = path.join( root, 'result.json' );
	await writeFile( sourcePath, sourceBytes );
	await writeFile( proposalPath, JSON.stringify( proposal ) );
	execFileSync( process.execPath, [ 'tools/apply-world-proposal.mjs', '--source', sourcePath, '--proposal', proposalPath, '--out', outputPath ], { stdio: 'ignore' } );
	assert.deepEqual( JSON.parse( await readFile( outputPath, 'utf8' ) ), revised, 'CLI produces the same validated result as the library function' );
	const staleProposalPath = path.join( root, 'stale.json' );
	await writeFile( staleProposalPath, JSON.stringify( { ...proposal, sourceHash: `sha256:${'0'.repeat( 64 )}` } ) );
	assert.throws( () => execFileSync( process.execPath, [ 'tools/apply-world-proposal.mjs', '--source', sourcePath, '--proposal', staleProposalPath, '--out', path.join( root, 'stale-result.json' ) ], { stdio: 'pipe' } ), /source hash mismatch/ );
	console.log( 'ok reviewable source-hash-bound world proposal patches' );
} finally {
	await rm( root, { recursive: true, force: true } );
}
