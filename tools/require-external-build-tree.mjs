import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const cwd = realpathSync(process.cwd());
const markerPath = join(cwd, '.elsemesh-source-root');
let marker;
try {
  marker = readFileSync(markerPath, 'utf8').trim();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let sourceRoot;
if (marker !== undefined) {
  if (!marker) throw new Error(`The ElseMesh source-root marker is empty: ${markerPath}`);
  const markedSource = resolve(cwd, marker);
  try {
    sourceRoot = realpathSync(markedSource);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`The ElseMesh source-root marker points to an unavailable checkout: ${markedSource}`);
  }
  let sourcePackage;
  try {
    sourcePackage = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
  } catch {
    throw new Error(`The ElseMesh source-root marker does not point to an ElseMesh checkout: ${sourceRoot}`);
  }
  if (sourcePackage.name !== 'elsemesh') throw new Error(`The ElseMesh source-root marker does not point to an ElseMesh checkout: ${sourceRoot}`);
} else {
  const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  sourceRoot = dirname(realpathSync(resolve(cwd, gitCommonDir)));
}
const relativeCwd = relative(sourceRoot, cwd);
const isInsideSource = relativeCwd === '' || (!isAbsolute(relativeCwd) && relativeCwd !== '..' && !relativeCwd.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
const buildSibling = join(dirname(sourceRoot), `${basename(sourceRoot)}.build`);
let buildSiblingLinksToSource = false;
try {
  buildSiblingLinksToSource = lstatSync(buildSibling).isSymbolicLink() && realpathSync(buildSibling) === sourceRoot;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (isInsideSource && !buildSiblingLinksToSource && process.env.ELSEMESH_ALLOW_SOURCE_BUILD !== '1') {
  console.error(`Refusing to build inside the ElseMesh source tree. Run npm run build from ${buildSibling}, or make that path a symlink to the source tree.`);
  process.exit(1);
}
