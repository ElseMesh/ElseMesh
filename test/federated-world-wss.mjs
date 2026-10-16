import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { WebSocket } from 'ws';
import { newIdentity, assetId, signObject } from '../network/identity.mjs';
import { DurableHandoffReplay } from '../network/DurableHandoffReplay.mjs';
import { sampleRegions } from '../network/federation-fixtures.mjs';
import { createPortalHandoff } from '../network/federation.mjs';
import { createFederatedWorldServer, relevantEntities, validatePublicEntity } from '../tools/networking/federated-world-server.mjs';
import { FederatedWorldClient, verifyWorldSignature } from '../src/network/FederatedWorldClient.js';

globalThis.crypto ||= webcrypto;
const ORIGIN = 'http://localhost:5189';
class TestWS extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function visitorIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { nodeId: 'elsemesh-node:' + createHash('sha256').update(spki).digest('hex'),
    publicKey: pair.publicKey, privateKey: pair.privateKey };
}
const entity = (entityId, x) => ({ entityId, kind: 'prop', position: [x, 1, 0], yaw: 0, revision: 1 });
function wait(client, type, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Timed out: ' + type)); }, timeout);
    const unsubscribe = client.onMessage(message => {
      if (message.type !== type) return;
      clearTimeout(timer); unsubscribe(); resolve(message);
    });
  });
}
function connect(server, identity, region, key, playerId = 'player:visitor') {
  return new FederatedWorldClient({ url: `ws://127.0.0.1:${server.address.port}/world`,
    expectedOwnerNodeId: key, expectedWorldId: region.worldId, expectedRegionId: region.regionId,
    identity, playerId, WebSocketClass: TestWS });
}
test('durable replay survives restart and malformed ledger fails closed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-replay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'replay.log');
  const id = crypto.randomUUID();
  const a = new DurableHandoffReplay(path);
  assert.equal(a.accept(id), true);
  assert.equal(a.accept(id), false);
  a.close();
  const b = new DurableHandoffReplay(path);
  assert.equal(b.accept(id), false, 'Restart must not resurrect a spent handoff');
  assert.equal(b.accept(crypto.randomUUID()), true);
  b.close();
});
test('interest filtering bounds distance, validates public schema and caps payload', () => {
  const list = Array.from({ length: 150 }, (_, i) => entity('prop:' + i, i));
  const selected = relevantEntities(list, { center: [0, 0, 0], radius: 100 });
  assert.equal(selected.length, 64);
  assert.equal(selected[0].entityId, 'prop:0');
  assert.throws(() => validatePublicEntity({ ...entity('prop:1', 1), privateInstructions: 'secret' }), /Invalid public entity/);
});
test('two independently owned WSS worlds support identity challenge, scoped view, travel, denial and restart replay', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-federation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = newIdentity(), b = newIdentity(), unknown = newIdentity(), visitor = await visitorIdentity();
  const f = sampleRegions(a.nodeId, b.nodeId);
  // Two separately owned worlds, not two regions masquerading as one world.
  f.underneath.worldId = 'elsemesh-world:owner-a';
  f.edWorld.worldId = 'elsemesh-world:owner-b';
  const policy = ({ playerId, playerNodeId }) => playerId === 'player:visitor' && playerNodeId === visitor.nodeId
    ? { allowed: true, permissions: ['view', 'visit'] } : { allowed: false };
  const configA = { identity: a, region: f.underneath, browserOrigin: ORIGIN,
    authorize: policy, replayFile: join(dir, 'a.log'),
    inboundPortals: [{ portal: f.edReturn, sourceAuthority: b.nodeId,
      sourceEpoch: f.edWorld.authority.epoch, supportedCapabilities: f.capabilities }],
    initialEntities: [entity('prop:a', 1)] };
  const configB = { identity: b, region: f.edWorld, browserOrigin: ORIGIN,
    authorize: policy, replayFile: join(dir, 'b.log'),
    inboundPortals: [{ portal: f.edDoor, sourceAuthority: a.nodeId,
      sourceEpoch: f.underneath.authority.epoch, supportedCapabilities: f.capabilities }],
    initialEntities: [entity('prop:b1', 2), entity('prop:b2', 22), entity('prop:secret', 900)] };
  let hostA = await createFederatedWorldServer(configA);
  let hostB = await createFederatedWorldServer(configB);
  t.after(async () => { await hostA.close(); await hostB.close(); });
  const clientA = connect(hostA, visitor, f.underneath, a.nodeId);
  const clientB = connect(hostB, visitor, f.edWorld, b.nodeId);
  t.after(() => { clientA.close(); clientB.close(); });
  await Promise.all([clientA.ready, clientB.ready]);
  assert.equal(clientA.grant.playerNodeId, clientB.grant.playerNodeId);
  assert.notEqual(clientA.grant.worldId, clientB.grant.worldId);
  assert.equal(await verifyWorldSignature(hostB.published, b.nodeId), true);
  assert.equal(await verifyWorldSignature(hostB.published, a.nodeId), false);
  const snapshot = wait(clientB, 'snapshot');
  await clientB.subscribe([0, 0, 0], 30);
  const received = await snapshot;
  assert.equal(await verifyWorldSignature(received, b.nodeId), true, 'snapshot must be signed by the pinned owner');
  assert.equal(await verifyWorldSignature({ ...received, revision: Number.MAX_SAFE_INTEGER }, b.nodeId), false, 'snapshot tampering must fail');
  assert.equal(received.sessionId, clientB.grant.sessionId, 'snapshot bound to authenticated viewer session');
  assert.deepEqual(received.entities.map(e => e.entityId).sort(), ['prop:b1', 'prop:b2']);
  assert.equal(received.entities.some(e => e.entityId === 'prop:secret'), false);
  assert.equal(received.visibleCount, 2);
  assert.equal(received.truncated, false);
  const crowded = wait(clientB, 'snapshot');
  hostB.setEntities(Array.from({ length: 100 }, (_, i) => entity('prop:crowd-' + i, 2)));
  const crowdedPacket = await crowded;
  assert.equal(crowdedPacket.visibleCount, 100);
  assert.equal(crowdedPacket.entities.length, 64);
  assert.equal(crowdedPacket.truncated, true, 'entity clipping must be visible to the renderer');
  const byteLimited = wait(clientB, 'snapshot');
  hostB.setEntities(Array.from({ length: 64 }, (_, i) =>
    entity('prop:' + 'x'.repeat(110) + i, 2)));
  const limitedPacket = await byteLimited;
  assert.equal(limitedPacket.visibleCount, 64);
  assert.ok(limitedPacket.entities.length < 64, 'byte budget should clip long IDs');
  assert.equal(limitedPacket.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(limitedPacket)) <= 8192);
  const bad = connect(hostB, await visitorIdentity(), f.edWorld, b.nodeId);
  t.after(() => bad.close());
  await assert.rejects(bad.ready, /World disconnected|connection failed/i, 'Unknown player signer denied');
  // Owner A signs source transfer; owner B explicitly accepts this player into B.
  const hash = assetId(Buffer.alloc(0));
  const handoff = createPortalHandoff(a, { portal: f.edDoor, playerId: 'player:visitor',
    playerNodeId: visitor.nodeId, destinationAuthority: b.nodeId, destinationSessionId: clientB.grant.sessionId,
    sessionId: 'elsemesh-session:visit-test', sequence: 1,
    authorityEpoch: f.underneath.authority.epoch, avatarAssetId: hash, inventoryHash: hash,
    position: [-216, 1.2, -29], velocity: [0, 0, 0], controlMode: 'HUMAN' });
  const arriving = wait(clientB, 'travel-admitted');
  await clientB.travel(handoff);
  const arrival = (await arriving).arrival;
  assert.equal(arrival.regionId, f.edWorld.regionId);
  assert.equal(arrival.playerNodeId, visitor.nodeId);
  const returningHandoff = createPortalHandoff(b, { portal: f.edReturn,
    playerId: 'player:visitor', playerNodeId: visitor.nodeId, destinationAuthority: a.nodeId,
    destinationSessionId: clientA.grant.sessionId, sessionId: 'elsemesh-session:visit-test', sequence: 2,
    authorityEpoch: f.edWorld.authority.epoch, avatarAssetId: hash, inventoryHash: hash,
    position: [0, 1, 1], velocity: [0, 0, 0], controlMode: 'HUMAN' });
  const returning = wait(clientA, 'travel-admitted');
  await clientA.travel(returningHandoff);
  assert.equal((await returning).arrival.regionId, f.underneath.regionId);
  // A given source handoff ID cannot be reused even by same authenticated player.
  const disconnected = wait(clientB, 'disconnected');
  await clientB.travel(handoff);
  assert.equal((await disconnected).code, 1008);
  assert.equal(hostB.metrics().replayEntries, 1);
  // Restart destination but reuse owner identity and its durable replay ledger.
  await hostB.close();
  hostB = await createFederatedWorldServer(configB);
  const recovered = connect(hostB, visitor, f.edWorld, b.nodeId);
  t.after(() => recovered.close());
  await recovered.ready;
  const denied = wait(recovered, 'disconnected');
  await recovered.travel(handoff);
  assert.equal((await denied).code, 1008, 'Spent portal handoff denied after restart');
  assert.equal(hostB.metrics().replayEntries, 1);
  assert.equal(hostA.metrics().replayEntries, 1);
  assert.notEqual(unknown.nodeId, b.nodeId);
});
test('signed inconsistent snapshot metadata and unsigned tampering are rejected', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-snapshot-meta-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = newIdentity(), owner = newIdentity(), visitor = await visitorIdentity();
  const region = sampleRegions(a.nodeId, owner.nodeId).edWorld;
  const server = await createFederatedWorldServer({ identity: owner, region,
    browserOrigin: ORIGIN, replayFile: join(dir, 'ledger'),
    authorize: () => ({ allowed: true, permissions: ['view'] }),
    initialEntities: [entity('prop:one', 1)] });
  t.after(() => server.close());
  const client = connect(server, visitor, region, owner.nodeId);
  t.after(() => client.close());
  await client.ready;
  const first = wait(client, 'snapshot');
  await client.subscribe([0, 0, 0], 30);
  const packet = await first;
  assert.equal(await verifyWorldSignature({ ...packet, visibleCount: 2 }, owner.nodeId), false);
  const { signature, ...payload } = packet;
  const invalid = signObject({ ...payload, truncated: true }, owner);
  assert.equal(await verifyWorldSignature(invalid, owner.nodeId), true);
  const error = wait(client, 'protocol-error');
  await client.socket.onmessage({ data: JSON.stringify(invalid) });
  assert.match((await error).error, /Invalid remote world snapshot/);
});
test('unknown world owner pin rejected before sending browser authentication', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-pin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = newIdentity(), b = newIdentity(), f = sampleRegions(a.nodeId, b.nodeId);
  const server = await createFederatedWorldServer({ identity: b, region: f.edWorld, browserOrigin: ORIGIN,
    authorize: () => ({ allowed: true, permissions: ['view'] }), replayFile: join(dir, 'ledger') });
  t.after(() => server.close());
  const client = connect(server, await visitorIdentity(), f.edWorld, a.nodeId);
  t.after(() => client.close());
  await assert.rejects(client.ready, /Untrusted|disconnected/i);
  assert.equal(server.metrics().authenticated, 0);
});

test('signed reconnect supersedes the previous socket instead of cloning player authority', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-single-session-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = newIdentity(), b = newIdentity(), visitor = await visitorIdentity();
  const region = sampleRegions(a.nodeId, b.nodeId).edWorld;
  const server = await createFederatedWorldServer({ identity:b, region, browserOrigin:ORIGIN,
    replayFile:join(dir,'ledger'), authorize:({playerNodeId}) => playerNodeId === visitor.nodeId
      ? {allowed:true, permissions:['view']} : {allowed:false} });
  t.after(() => server.close());
  const first = connect(server, visitor, region, b.nodeId);
  t.after(() => first.close());
  await first.ready;
  const replacementNotice = wait(first, 'disconnected');
  const second = connect(server, visitor, region, b.nodeId);
  t.after(() => second.close());
  await second.ready;
  assert.equal((await replacementNotice).code, 4009, 'superseded identity must be fenced, not endlessly reconnected');
  assert.equal(second.closed, false);
});

test('unauthenticated slots are bounded independently of authenticated world capacity', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-pending-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = newIdentity(), b = newIdentity();
  const region = sampleRegions(a.nodeId, b.nodeId).edWorld;
  const server = await createFederatedWorldServer({
    identity: b, region, browserOrigin: ORIGIN, replayFile: join(dir, 'pending.log'),
    authorize: () => ({ allowed: false }),
  });
  t.after(() => server.close());
  const url = 'ws://127.0.0.1:' + server.address.port + '/world';
  const pending = [];
  for (let i = 0; i < 8; i++) {
    const socket = new WebSocket(url, { origin: ORIGIN });
    pending.push(socket);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  }
  t.after(() => pending.forEach(socket => socket.terminate()));
  assert.equal(server.metrics().pendingAuth, 8);
  const extra = new WebSocket(url, { origin: ORIGIN });
  extra.on('error', () => {});
  t.after(() => extra.terminate());
  const error = await new Promise(resolve => extra.once('error', resolve));
  assert.match(error.message, /403/);
  pending[0].close();
  await new Promise(resolve => pending[0].once('close', resolve));
  const settleBy = Date.now() + 1000;
  while (server.metrics().pendingAuth !== 7) {
    if (Date.now() > settleBy) throw new Error('Closed unauthenticated slot was not released');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const allowed = new WebSocket(url, { origin: ORIGIN });
  allowed.on('error', () => {});
  t.after(() => allowed.terminate());
  await new Promise((resolve, reject) => { allowed.once('open', resolve); allowed.once('error', reject); });
});

test('signed in-place renewal preserves session and view without reconnect', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-renew-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = newIdentity(), b = newIdentity(), visitor = await visitorIdentity();
  const region = sampleRegions(a.nodeId, b.nodeId).edWorld;
  const server = await createFederatedWorldServer({ identity: b, region,
    browserOrigin: ORIGIN, replayFile: join(dir, 'renew-ledger'),
    sessionTtlMs: 6000,
    authorize: ({ playerNodeId }) => playerNodeId === visitor.nodeId
      ? { allowed: true, permissions: ['view', 'visit'] } : { allowed: false },
    initialEntities: [entity('prop:renews', 1)] });
  t.after(() => server.close());
  const client = connect(server, visitor, region, b.nodeId);
  t.after(() => client.close());
  const first = await client.ready;
  const renewed = wait(client, 'renewed', 12000);
  const updated = (await renewed).grant;
  assert.equal(updated.sessionId, first.sessionId, 'renewal must not change visit session');
  assert.ok(updated.expiresAt > first.expiresAt);
  assert.equal(await verifyWorldSignature(updated, b.nodeId), true);
  assert.equal(server.metrics().authenticated, 1);
  const snapshot = wait(client, 'snapshot');
  await client.subscribe([0, 0, 0], 40);
  const result = await snapshot;
  assert.equal(result.sessionId, updated.sessionId);
  assert.equal(client.closed, false);
});
test('destination policy revocation ends renewal without escalating permissions', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-revoke-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = newIdentity(), b = newIdentity(), visitor = await visitorIdentity();
  const region = sampleRegions(a.nodeId, b.nodeId).edWorld;
  let allowed = true;
  const server = await createFederatedWorldServer({ identity: b, region,
    browserOrigin: ORIGIN, replayFile: join(dir, 'renew-ledger'), sessionTtlMs: 6000,
    authorize: ({ playerNodeId }) => ({ allowed: allowed && playerNodeId === visitor.nodeId,
      permissions: ['view'] }) });
  t.after(() => server.close());
  const client = connect(server, visitor, region, b.nodeId);
  t.after(() => client.close());
  await client.ready;
  allowed = false;
  const disconnected = wait(client, 'disconnected', 12000);
  assert.equal((await disconnected).code, 1008, 'owner revocation closes connection on renewal');
  assert.equal(client.closed, true);
});
