import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { WebSocket } from 'ws';
import { newIdentity } from '../network/identity.mjs';
import { sampleRegions } from '../network/federation-fixtures.mjs';
import { createFederatedWorldServer } from '../tools/networking/federated-world-server.mjs';
import { FederationView } from '../src/network/FederationView.js';

globalThis.crypto ||= webcrypto;
const ORIGIN = 'http://localhost:5189';
class TestWS extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function browserIdentity() {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign','verify']);
  return { privateKey: keys.privateKey, publicKey: keys.publicKey,
    nodeId: 'elsemesh-node:' + createHash('sha256').update(Buffer.from(await crypto.subtle.exportKey('spki', keys.publicKey))).digest('hex') };
}
function event(view, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Timed out: ' + type)); }, timeoutMs);
    const off = view.onEvent(m => { if (m.type !== type) return; clearTimeout(timer); off(); resolve(m); });
  });
}
test('federated remote window clears stale state and resubscribes after world owner restarts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-restore-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const owner = newIdentity(), other = newIdentity();
  const region = sampleRegions(other.nodeId, owner.nodeId).edWorld;
  region.worldId = 'elsemesh-world:reconnect-owner';
  const visitor = await browserIdentity();
  const cfg = { identity: owner, region, browserOrigin: ORIGIN,
    replayFile: join(dir, 'ledger'),
    authorize: ({ playerNodeId }) => playerNodeId === visitor.nodeId
      ? { allowed: true, permissions: ['view'] } : { allowed: false },
    initialEntities: [{ entityId:'prop:one', kind:'prop', position:[0,0,0], yaw:0, revision:1 }] };
  let server = await createFederatedWorldServer(cfg);
  const port = server.address.port;
  const view = new FederationView({
    endpoint: 'ws://127.0.0.1:' + port + '/world',
    ownerNodeId: owner.nodeId, worldId: region.worldId, regionId: region.regionId,
    playerId: 'player:observer', identity: visitor, WebSocketClass: TestWS,
    random: () => 0,
  });
  t.after(async () => { view.stop(); await server.close(); });
  await view.watch([0,0,0], 100);
  const before = event(view, 'snapshot');
  view.start();
  assert.equal((await before).packet.entities[0].entityId, 'prop:one');
  const dropped = event(view, 'disconnected');
  await server.close();
  await dropped;
  assert.equal(view.latest, null, 'Old remote view must not remain deceptively live');
  const restored = event(view, 'snapshot', 4500);
  server = await createFederatedWorldServer({ ...cfg, port,
    initialEntities: [{entityId:'prop:two',kind:'npc',position:[0,0,0],yaw:1,revision:2}] });
  assert.equal((await restored).packet.entities[0].entityId, 'prop:two');
  assert.equal(view.connected, true);
});
test('federated view rejects denied player without an endless reconnection loop', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-denial-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const owner = newIdentity(), other = newIdentity();
  const region = sampleRegions(other.nodeId, owner.nodeId).edWorld;
  const visitor = await browserIdentity();
  const server = await createFederatedWorldServer({ identity: owner, region,
    browserOrigin: ORIGIN, replayFile: join(dir,'ledger'), authorize: () => ({ allowed:false }) });
  t.after(() => server.close());
  const view = new FederationView({ endpoint:'ws://127.0.0.1:' + server.address.port + '/world',
    ownerNodeId:owner.nodeId, worldId:region.worldId, regionId:region.regionId,
    identity:visitor, playerId:'player:observer', WebSocketClass:TestWS, random:()=>0 });
  t.after(() => view.stop());
  const denial = event(view, 'denied');
  view.start();
  assert.equal((await denial).code, 1008);
  assert.equal(view.running, false);
  assert.equal(view.timer, null);
});
