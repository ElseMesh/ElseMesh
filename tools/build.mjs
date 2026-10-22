import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const runPreview = args.includes('--run');
const installIfNeeded = args.includes('--install-if-needed');
const unknownArgs = args.filter((arg) => arg !== '--run' && arg !== '--install-if-needed');
if (unknownArgs.length > 0) {
  console.error(`Unknown build option: ${unknownArgs[0]}`);
  console.error('Usage: npm run build [-- --run]');
  process.exit(2);
}

const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
if (!existsSync(viteCli) && installIfNeeded) {
  console.log('Vite is not installed; installing locked dependencies with npm ci...');
  const npmExecPath = process.env.npm_execpath;
  const install = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, 'ci', '--no-audit', '--no-fund'], { stdio: 'inherit' })
    : spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { stdio: 'inherit' });
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status ?? 1);
}
if (!existsSync(viteCli)) {
  console.error('Vite is not installed. Run npm ci, or use npm start to install dependencies and launch the preview.');
  process.exit(1);
}

const build = spawn(process.execPath, [viteCli, 'build'], { stdio: 'inherit' });
const buildExitCode = await new Promise((resolve, reject) => {
  build.once('error', reject);
  build.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
if (buildExitCode !== 0) process.exit(buildExitCode);

if (runPreview) {
  const preview = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--no-strictPort'], { stdio: 'inherit' });
  const stopPreview = (signal) => preview.kill(signal);
  process.once('SIGINT', stopPreview);
  process.once('SIGTERM', stopPreview);
  const previewExitCode = await new Promise((resolve, reject) => {
    preview.once('error', reject);
    preview.once('close', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 0)));
  });
  process.exit(previewExitCode);
}
