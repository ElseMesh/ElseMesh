import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const cwd = realpathSync(process.cwd());
const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
const sourceRoot = dirname(realpathSync(resolve(cwd, gitCommonDir)));
const relativeCwd = relative(sourceRoot, cwd);
const isInsideSource = relativeCwd === '' || (!isAbsolute(relativeCwd) && relativeCwd !== '..' && !relativeCwd.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));

if (isInsideSource && process.env.ELSEMESH_ALLOW_SOURCE_BUILD !== '1') {
  console.error('Refusing to build inside the ElseMesh source tree. Run npm run build from the sibling elsemesh.build directory.');
  process.exit(1);
}
