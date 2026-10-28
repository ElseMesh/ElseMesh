import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = process.env.PREFIX ? path.join(process.env.PREFIX, 'tmp') : '/var/tmp';
const temp = await mkdtemp(path.join(tempRoot, 'elsemesh-build-tree-'));

try {
	const source = path.join(temp, 'source');
	const build = path.join(temp, 'source.build');
	await Promise.all([mkdir(source), mkdir(build)]);
	await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'elsemesh' }));
	await writeFile(path.join(build, '.elsemesh-source-root'), `${source}\n`);

	const guard = path.join(projectRoot, 'tools', 'require-external-build-tree.mjs');
	const accepted = spawnSync(process.execPath, [guard], { cwd: build, encoding: 'utf8' });
	assert.equal(accepted.status, 0, `marker-linked build without Git metadata should be accepted:\n${accepted.stderr}`);

	await writeFile(path.join(build, '.elsemesh-source-root'), `${path.join(temp, 'missing')}\n`);
	const rejected = spawnSync(process.execPath, [guard], { cwd: build, encoding: 'utf8' });
	assert.notEqual(rejected.status, 0, 'a marker that does not point to an ElseMesh checkout must fail closed');
	assert.match(rejected.stderr, /ElseMesh source-root marker/);
} finally {
	await rm(temp, { recursive: true, force: true });
}

console.log('external build guard resolves the source marker without a Git worktree');
