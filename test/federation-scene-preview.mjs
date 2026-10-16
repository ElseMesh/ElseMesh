import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group } from '../src/engine/index.js';
import { FederationScenePreview } from '../src/network/FederationScenePreview.js';

const state = (rev, items) => ({ revision: rev, entities: items });
const entity = (id, x = 0, kind = 'prop') => ({
  entityId: id, kind, position: [x, 0, 0], yaw: 0, revision: 1,
});
test('remote-world preview uses bounded ElseMesh scene meshes, resets on disconnect', () => {
  const scene = new Group(), camera = new Group();
  const preview = new FederationScenePreview(scene, camera, { center: [100, 0, 0] });
  assert.equal(scene.children.includes(preview.group), true);
  assert.equal(preview.group.visible, false);
  preview.applyVerifiedSnapshot(state(1, [entity('box:a', 100), entity('npc:b', 101, 'npc')]));
  assert.equal(preview.entries.size, 2);
  assert.equal(preview.group.visible, true);
  assert.equal(preview.entries.get('box:a').mesh.position.x, 0);
  assert.equal(preview.entries.get('npc:b').mesh.position.x, 0.012);
  preview.applyVerifiedSnapshot(state(2, [entity('npc:b', 103, 'npc')]));
  assert.equal(preview.entries.has('box:a'), false);
  assert.equal(preview.entries.get('npc:b').mesh.position.x, 0.036000000000000004);
  camera.position.set(5, 6, 7);
  preview.updateCamera();
  assert.ok(preview.group.position.x > 5);
  preview.disconnect();
  assert.equal(preview.entries.size, 0);
  assert.equal(preview.group.visible, false);
  preview.dispose();
  assert.equal(scene.children.includes(preview.group), false);
});
test('invalid or duplicate remote scene replacement fails atomically', () => {
  const scene = new Group(), camera = new Group(), preview = new FederationScenePreview(scene, camera);
  try {
    preview.applyVerifiedSnapshot(state(3, [entity('safe:one')]));
    assert.throws(() => preview.applyVerifiedSnapshot(state(4, [
      entity('safe:two'), entity('safe:two'),
    ])), /Malformed or duplicated/);
    assert.equal(preview.entries.has('safe:one'), true);
    assert.equal(preview.entries.has('safe:two'), false);
    assert.throws(() => preview.applyVerifiedSnapshot(state(2, [entity('safe:two')])), /budget invalid/);
    assert.throws(() => preview.applyVerifiedSnapshot(state(5, Array.from(
      { length: 65 }, (_, i) => entity('item:' + i)))), /budget invalid/);
    assert.throws(() => preview.applyVerifiedSnapshot(state(5, [{
      ...entity('bad:script'), shaderSource: 'arbitrary',
    }])), /Malformed or duplicated|budget invalid/);
  } finally { preview.dispose(); }
});

test('remote-world preview is opt-in and loopback-only, never enabled on live site', async () => {
  const { allowFederationPreviewOrigin } = await import('../src/network/FederationPreviewController.js');
  assert.equal(allowFederationPreviewOrigin('127.0.0.1'), true);
  assert.equal(allowFederationPreviewOrigin('localhost'), true);
  for (const host of ['elsemesh.io', 'github.io', 'collingham.org', 'localhost.evil.test', '192.168.1.4']) {
    assert.equal(allowFederationPreviewOrigin(host), false);
  }
});
