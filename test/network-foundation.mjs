import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newIdentity, nodeId, assetId } from '../network/identity.mjs';
import { CAPABILITIES, ReplayGuard, acceptAsset, acceptHandoff, acceptManifest, createHandoff, createManifest, required, validateEnvelope } from '../network/protocol.mjs';
import { TcpUdpTransport } from '../network/tcp-udp-transport.mjs';
import { RouteTable } from '../network/routes.mjs';

const a = newIdentity(), b = newIdentity(), unknown = newIdentity();
const trusted = new Set([a.nodeId, b.nodeId]);

test('unencrypted native reference refuses non-loopback listeners by default', () => {
  assert.throws(() => new TcpUdpTransport({ identity: a, trustedIds: trusted, host: '0.0.0.0' }), /loopback-only/);
  assert.ok(new TcpUdpTransport({ identity: a, trustedIds: trusted }).node_id() === a.nodeId);
});

test('identity is key-derived rather than route-derived, including overlapping private IPs', () => {
  assert.equal(nodeId(a.publicKeyPem), a.nodeId);
  assert.notEqual(a.nodeId, b.nodeId);
  const routes = [{ nodeId: a.nodeId, ip: '192.0.2.10', site: 'A' }, { nodeId: b.nodeId, ip: '192.0.2.10', site: 'B' }];
  assert.equal(new Set(routes.map((r) => r.nodeId)).size, 2);
});

test('capability negotiation rejects unsupported combinations', () => {
  assert.ok(required(CAPABILITIES, ['elsemesh.asset/1']));
  assert.equal(required(['elsemesh.peer/1'], ['elsemesh.authority/1']), false);
});

test('signed handoff validates authority, epoch, expiry, replay, unknown node, tampering', () => {
  const authority = new Map([['elsemesh:SEA-01', { nodeId: a.nodeId, epoch: 17 }]]);
  const stateHash = assetId(Buffer.from('state'));
  const handoff = createHandoff(a, { playerId: 'elsemesh:player-1', worldId: 'elsemesh:world-1', sourceSector: 'elsemesh:SEA-01', targetSector: 'elsemesh:UNDERNEATH-01', position: [1, 2, 3], velocity: [0, 0, 1], playerStateHash: stateHash, inventoryHash: stateHash, sequence: 4, epoch: 17 });
  const context = { trustedIds: trusted, authority, replay: new ReplayGuard(), now: handoff.timestamp };
  assert.equal(acceptHandoff(handoff, context).sectorId, 'elsemesh:UNDERNEATH-01');
  assert.throws(() => acceptHandoff(handoff, context), /Replayed/);
  assert.throws(() => acceptHandoff({ ...handoff, position: [9, 9, 9] }, { ...context, replay: new ReplayGuard() }), /signature/);
  assert.throws(() => acceptHandoff(handoff, { ...context, replay: new ReplayGuard(), now: handoff.timestamp + 31_000 }), /Expired/);
  authority.set('elsemesh:SEA-01', { nodeId: a.nodeId, epoch: 18 });
  assert.throws(() => acceptHandoff(handoff, { ...context, replay: new ReplayGuard() }), /Stale/);
  const bad = createHandoff(unknown, { playerId: 'elsemesh:player-1', worldId: 'elsemesh:world-1', sourceSector: 'elsemesh:SEA-01', targetSector: 'elsemesh:UNDERNEATH-01', position: [1, 2, 3], velocity: [0, 0, 1], playerStateHash: stateHash, inventoryHash: stateHash, sequence: 4, epoch: 18 });
  assert.throws(() => acceptHandoff(bad, { ...context, replay: new ReplayGuard() }), /signature/);
});

test('signed manifest and content-addressed asset reject substitution and corruption', () => {
  const bytes = Buffer.from('small development asset');
  const hash = assetId(bytes);
  const manifest = createManifest(a, { worldId: 'elsemesh:world-1', sectorId: 'elsemesh:SEA-01', assets: [{ hash, type: 'model/glb' }] });
  assert.equal(acceptManifest(manifest, new Set([a.nodeId])).assets[0].hash, hash);
  assert.throws(() => acceptManifest({ ...manifest, version: 99 }, new Set([a.nodeId])), /signature/);
  assert.throws(() => acceptManifest(manifest, new Set([b.nodeId])), /signature/);
  assert.deepEqual(acceptAsset(hash, bytes), bytes);
  assert.throws(() => acceptAsset(hash, Buffer.from('corrupt')), /hash/);
});

test('malformed and oversized messages are rejected', () => {
  assert.throws(() => validateEnvelope({ protocol: 'bad' }), /identity/);
  assert.throws(() => validateEnvelope({ protocol: 'elsemesh', from: a.nodeId, to: b.nodeId, channel: 'reliable', sequence: 1, session: '00000000-0000-4000-8000-000000000000', type: 'huge', body: 'x'.repeat(70_000) }), /Oversized/);
});

test('deterministic chaos: overlapping subnets, route change, direct failure, relay fallback and outage', async () => {
  const routes = new RouteTable();
  routes.set(a.nodeId, [{ kind: 'direct', address: '192.0.2.10', scope: 'site-A' }, { kind: 'relay', address: 'relay-A', scope: 'public' }]);
  routes.set(b.nodeId, [{ kind: 'direct', address: '192.0.2.10', scope: 'site-B' }]);
  assert.notDeepEqual(routes.get(a.nodeId)[0], routes.get(b.nodeId)[0]);
  assert.equal((await routes.connect(a.nodeId, async (r) => r.kind === 'direct')).kind, 'direct');
  assert.equal((await routes.connect(a.nodeId, async (r) => r.kind === 'relay')).kind, 'relay');
  routes.set(a.nodeId, [{ kind: 'direct', address: '203.0.113.30', scope: 'site-C' }]);
  assert.equal((await routes.connect(a.nodeId, async (r) => r.address === '203.0.113.30')).address, '203.0.113.30');
  await assert.rejects(routes.connect(a.nodeId, async () => false), /No reachable route/);
});

test('deterministic chaos: duplicate unreliable sequence is dropped', () => {
  const guard = new ReplayGuard();
  assert.equal(guard.accept(`${a.nodeId}:transient:42`), true);
  assert.equal(guard.accept(`${a.nodeId}:transient:42`), false);
  assert.equal(guard.accept(`${a.nodeId}:transient:43`), true);
});

test('reference transport exchanges reliable and transient messages, reports route', async () => {
  const server = new TcpUdpTransport({ identity: a, trustedIds: trusted, host: '127.0.0.1' });
  const client = new TcpUdpTransport({ identity: b, trustedIds: trusted, host: '127.0.0.1' });
  await server.start_node(); await client.start_node();
  try {
    await client.connect_peer(a.nodeId, { host: '127.0.0.1', port: server.local_addresses()[0].port });
    const reliable = new Promise((resolve) => server.on('message', (msg) => msg.type === 'test-reliable' && resolve(msg)));
    await client.send_reliable(a.nodeId, 'test-reliable', { value: 42 });
    assert.equal((await reliable).body.value, 42);
    const transient = new Promise((resolve) => server.on('message', (msg) => msg.type === 'test-transient' && resolve(msg)));
    await client.send_unreliable(a.nodeId, 'test-transient', { x: 4 });
    assert.equal((await transient).body.x, 4);
    assert.equal(client.connection_metrics(a.nodeId).direct, true);
  } finally { await client.stop_node(); await server.stop_node(); }
});
