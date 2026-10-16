import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanPublicationTree } from '../publication-privacy.mjs';

const source = resolve(process.argv[2] || 'dist');
const destination = resolve(process.argv[3] || 'artifacts/preview-site');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Exact source commit required');
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
if (dirty && process.env.ELSEMESH_PREVIEW_TEST_ALLOW_DIRTY !== '1')
  throw new Error('Preview staging requires a clean source checkout');

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true, force: true });
const indexPath = resolve(destination, 'index.html');
let html = readFileSync(indexPath, 'utf8');
if (!html.includes('</head>') || !html.includes('<body>')) throw new Error('Unexpected built index');

const isolation = `<script>
// This preview shares the github.io origin with the existing site. Keep its
// local browser state separate before the application imports execute.
(() => {
  const prefix = 'elsemesh.preview.v1:';
  for (const method of ['getItem', 'setItem', 'removeItem']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function(key, ...rest) {
      return original.call(this, prefix + String(key), ...rest);
    };
  }
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name, ...rest) {
    return open.call(this, prefix + String(name), ...rest);
  };
  const remove = IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase = function(name) {
    return remove.call(this, prefix + String(name));
  };
})();
</script>`;
const label = `<aside id="elsemesh-preview-label" style="position:fixed;z-index:99999;top:8px;right:8px;max-width:260px;padding:8px 10px;border:1px solid #dfb64e;border-radius:6px;background:#171a20;color:#fff;font:12px/1.4 system-ui;box-shadow:0 3px 12px #0009">EXPERIMENTAL PREVIEW · solo gameplay<br><a href="https://github.com/lozknowles/ElseMesh/pull/5" style="color:#f7d36f">Source and known limits</a> · No live federation server</aside>`;
html = html.replace('</head>', `${isolation}\n</head>`).replace('<body>', `<body>\n${label}`);
html = html.replace('<title>ElseMesh</title>', '<title>ElseMesh — experimental preview</title>');
writeFileSync(indexPath, html);
writeFileSync(resolve(destination, '.nojekyll'), '');
writeFileSync(resolve(destination, 'preview-build.json'), JSON.stringify({
  kind: 'experimental-static-preview', sourceRepository: 'lozknowles/ElseMesh',
  sourceCommit: commit, liveFederation: false, productionRelease: false,
  sourceTreeDirty: dirty,
}, null, 2) + '\n');
const scan = scanPublicationTree(destination);
if (scan.issues.length || readdirSync(destination, { recursive: true }).some(name =>
  /(?:^|[\\/])models[\\/](?:godzilla|port[\\/]delorean)(?:[\\/]|$)/i.test(String(name))))
  throw new Error('Preview publication scan failed');
console.log(`Preview publication scan passed: ${scan.files} files, ${scan.textFiles} text files`);
console.log(`Staged isolated static preview from ${commit}`);
