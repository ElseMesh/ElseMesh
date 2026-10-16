import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestRank } from '../tools/networking/quantiles.mjs';

test('nearest-rank p99 reports the maximum of ten observations', () => {
  const samples = Array.from({ length: 10 }, (_, i) => i + 1);
  assert.equal(nearestRank(samples, .5), 5);
  assert.equal(nearestRank(samples, .95), 10);
  assert.equal(nearestRank(samples, .99), 10);
  assert.equal(nearestRank(samples, 1), 10);
  assert.throws(() => nearestRank([], .99), /Nonempty/);
});
