import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DurableHandoffReplay } from '../network/DurableHandoffReplay.mjs';

test('durable replay bounds active window instead of exhausting after lifetime total', t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-ttl-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'accepted.log');
  let now = 1790000000000;
  const config = { maxEntries: 3, retentionMs: 30000, now: () => now };
  const replay = new DurableHandoffReplay(path, config);
  const first = randomUUID();
  assert.equal(replay.accept(first), true);
  assert.equal(replay.accept(first), false);
  assert.equal(replay.accept(randomUUID()), true);
  assert.equal(replay.accept(randomUUID()), true);
  assert.equal(replay.accept(randomUUID()), false, 'bounded unexpired window fails closed');
  now += 30001;
  for (let i = 0; i < 30; i++) {
    assert.equal(replay.accept(randomUUID()), true);
    now += 30001;
  }
  assert.equal(replay.size, 0);
  replay.close();
  const restored = new DurableHandoffReplay(path, config);
  assert.equal(restored.accept(first), true, 'expired IDs may be reused only after the signed token is invalid');
  assert.equal(restored.accept(first), false, 'accepted IDs remain protected across restart');
  restored.close();
  assert.ok(readFileSync(path, 'utf8').length < 1000, 'journal compacted instead of growing forever');
});

test('unacknowledged incomplete trailing write is truncated while committed replay remains blocked', t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-partial-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'accepted.log');
  const key = randomUUID();
  const replay = new DurableHandoffReplay(path);
  assert.equal(replay.accept(key), true);
  replay.close();
  appendFileSync(path, '1790000');
  const restored = new DurableHandoffReplay(path);
  assert.equal(restored.accept(key), false);
  assert.equal(restored.accept(randomUUID()), true);
  restored.close();
  assert.equal(readFileSync(path, 'utf8').includes('1790000\n'), false);
});
