import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

test('static preview is labelled and scopes browser saves before application import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-preview-test-'));
  try {
    const input = join(dir, 'input');
    const output = join(dir, 'output');
    mkdirSync(input);
    writeFileSync(join(input, 'index.html'), '<html><head><title>ElseMesh</title></head><body><script type="module" src="./app.js"></script></body></html>');
    execFileSync(process.execPath, ['tools/preview/stage-static-preview.mjs', input, output], {
      env: { ...process.env, ELSEMESH_PREVIEW_TEST_ALLOW_DIRTY: '1' },
    });
    const html = readFileSync(join(output, 'index.html'), 'utf8');
    assert.match(html, /EXPERIMENTAL PREVIEW/);
    assert.ok(html.indexOf('elsemesh.preview.v1:') < html.indexOf('type="module"'));
    assert.equal(JSON.parse(readFileSync(join(output, 'preview-build.json'))).liveFederation, false);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    assert.ok(script);
    const data = new Map([['save', 'production']]);
    class Storage {
      getItem(key) { return data.get(key) ?? null; }
      setItem(key, value) { data.set(key, value); }
      removeItem(key) { data.delete(key); }
    }
    class IDBFactory {
      open(name) { return name; }
      deleteDatabase(name) { return name; }
    }
    runInNewContext(script, { Storage, IDBFactory });
    const storage = new Storage();
    storage.setItem('save', 'preview');
    assert.equal(data.get('save'), 'production');
    assert.equal(storage.getItem('save'), 'preview');
    assert.equal(new IDBFactory().open('keys'), 'elsemesh.preview.v1:keys');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
