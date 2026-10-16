// Local socket-scale qualification, NOT a WAN or physical-machine benchmark.
// Every simulated world has a distinct signing identity, authority and WSS port.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { newIdentity } from '../../network/identity.mjs';
import { sampleRegions } from '../../network/federation-fixtures.mjs';
import { createFederatedWorldServer } from './federated-world-server.mjs';
import { FederatedWorldClient } from '../../src/network/FederatedWorldClient.js';
import { nearestRank } from './quantiles.mjs';
globalThis.crypto ||= webcrypto;
const ORIGIN = 'http://localhost:5189';
class TestWS extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
const sizes = [2, 4, 10, 25, 50];
const rounds = 5;
const identity = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const bytes = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { nodeId: 'elsemesh-node:' + createHash('sha256').update(bytes).digest('hex'),
    publicKey: pair.publicKey, privateKey: pair.privateKey };
};
function recv(client, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Timeout waiting for ' + type)); }, timeout);
    const off = client.onMessage(message => {
      if (message.type !== type) return;
      clearTimeout(timer); off(); resolve(message);
    });
  });
}
const visitor = await identity();
const records = [];
for (const count of sizes) {
  const dir = mkdtempSync(join(tmpdir(), 'elsemesh-nnodes-'));
  const hosts = [], clients = [], times = [];
  let failures = 0, snapshots = 0, items = 0;
  const started = performance.now();
  try {
    const recordsForNodes = await Promise.all(Array.from({ length: count }, async (_, i) => {
      const owner = newIdentity(), other = newIdentity();
      const region = sampleRegions(other.nodeId, owner.nodeId).edWorld;
      region.worldId = 'elsemesh-world:bench-' + i;
      region.regionId = 'elsemesh-region:bench-' + i;
      region.portals = [];
      const host = await createFederatedWorldServer({
        identity: owner, region, browserOrigin: ORIGIN,
        replayFile: join(dir, 'replay-' + i + '.log'),
        authorize: ({ playerId, playerNodeId }) => playerId === 'player:bench' && playerNodeId === visitor.nodeId
          ? { allowed: true, permissions: ['view'] } : { allowed: false },
        initialEntities: Array.from({ length: 25 }, (_, n) => ({
          entityId: 'prop:' + n, kind: 'prop', position: [n * 5, 1, 0], yaw: 0, revision: 1 })),
      });
      hosts.push(host);
      const client = new FederatedWorldClient({
        url: 'ws://127.0.0.1:' + host.address.port + '/world',
        expectedOwnerNodeId: owner.nodeId, expectedWorldId: region.worldId,
        expectedRegionId: region.regionId, identity: visitor, playerId: 'player:bench',
        WebSocketClass: TestWS,
      });
      clients.push(client);
      await client.ready;
      return { host, client };
    }));
    for (let round = 0; round < rounds; round++) {
      const requests = recordsForNodes.map(async ({ client }) => {
        const start = performance.now();
        const received = recv(client, 'snapshot');
        await client.subscribe([0, 0, 0], 75);
        const packet = await received;
        times.push(performance.now() - start);
        snapshots++;
        items += packet.entities.length;
      });
      const settled = await Promise.allSettled(requests);
      failures += settled.filter(r => r.status !== 'fulfilled').length;
    }
    const totalBytes = hosts.reduce((sum, h) => sum + h.metrics().bytesOut, 0);
    times.sort((a, b) => a - b);
    records.push({ worlds: count, physicallyDistinctMachines: 1, worldSocketServices: count,
      snapshots, failures, entitiesPerSnapshot: items / Math.max(1, snapshots),
      p50Ms: times.length ? nearestRank(times, .5) : null,
      p95Ms: times.length ? nearestRank(times, .95) : null,
      p99Ms: times.length ? nearestRank(times, .99) : null,
      totalBytes, elapsedMs: performance.now() - started,
      heapUsedBytes: process.memoryUsage().heapUsed,
      rssBytes: process.memoryUsage().rss });
    console.log(JSON.stringify(records.at(-1)));
    if (failures) process.exitCode = 1;
  } finally {
    for (const c of clients) c.close();
    await Promise.all(hosts.map(h => h.close()));
    rmSync(dir, { recursive: true, force: true });
  }
}
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify({ scope: 'loopback-only', rounds,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  results: records }, null, 2) + '\n');
