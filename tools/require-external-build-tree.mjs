import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const cwd = realpathSync(process.cwd());
const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
const sourceRoot = dirname(realpathSync(resolve(cwd, gitCommonDir)));
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
