import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { nodeId, signObject, verifyObject } from '../../network/identity.mjs';
import { validateRegion, validatePortal, publishRegion, acceptPortalHandoff } from '../../network/federation.mjs';
import { DurableHandoffReplay } from '../../network/DurableHandoffReplay.mjs';

export const FEDERATION_WIRE = 'elsemesh.world-wss/1';
const MAX_CLIENT_FRAME = 8192;
const MAX_PEERS = 64;
const OUTBOUND_BUDGET = 128 * 1024;
const PLAYER = /^player:[A-Za-z0-9._-]{1,128}$/;
const ENTITY = /^[a-z0-9._:-]{1,128}$/;
const NONCE = /^[a-f0-9-]{36}$/;
const vector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1_000_000);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const shape = (obj, names) => obj && typeof obj === 'object' && !Array.isArray(obj)
  && Object.keys(obj).every(k => names.includes(k));
const sendBounded = (socket, value, stats) => {
  if (socket.readyState !== WebSocket.OPEN) return false;
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > MAX_CLIENT_FRAME || socket.bufferedAmount + Buffer.byteLength(bytes) > OUTBOUND_BUDGET) {
    stats.dropped++;
    // Do not let an unresponsive subscriber accumulate world state indefinitely.
    if (socket.bufferedAmount > OUTBOUND_BUDGET) socket.terminate();
    return false;
  }
  socket.send(bytes);
  stats.bytesOut += Buffer.byteLength(bytes);
  return true;
};
export function validatePublicEntity(entity) {
  if (!shape(entity, ['entityId', 'kind', 'position', 'yaw', 'revision']) ||
    !ENTITY.test(entity.entityId) || !['player', 'npc', 'prop'].includes(entity.kind) ||
    !vector(entity.position) || !Number.isFinite(entity.yaw) ||
    !Number.isSafeInteger(entity.revision) || entity.revision < 0)
    throw new Error('Invalid public entity');
  return { entityId: entity.entityId, kind: entity.kind, position: [...entity.position],
    yaw: entity.yaw, revision: entity.revision };
}
export function relevantEntities(entities, interest) {
  const squared = interest.radius * interest.radius;
  return entities.filter(e => e.position.reduce((sum, n, i) =>
    sum + (n - interest.center[i]) ** 2, 0) <= squared)
    .sort((a, b) => {
      const dist = e => e.position.reduce((sum, n, i) => sum + (n - interest.center[i]) ** 2, 0);
      return dist(a) - dist(b) || a.entityId.localeCompare(b.entityId);
    }).slice(0, 64);
}

/**
 * Standalone, single-owner authoritative WSS world. Networking only:
 * it does not replace ElseMesh's WebGPU renderer or install public ingress.
 *
 * Reverse proxy terminates TLS; this plaintext listener is loopback-only.
 * The caller must supply an explicit destination policy. No implicit guest admission.
 */
export async function createFederatedWorldServer({
  identity, region, port = 0, host = '127.0.0.1', browserOrigin,
  expectedHost = null, authorize, inboundPortals = [], replayFile,
  initialEntities = [],
} = {}) {
  validateRegion(region);
  if (!identity || region.ownerNodeId !== identity.nodeId ||
      region.authority.nodeId !== identity.nodeId || !region.hosts.includes(identity.nodeId))
    throw new Error('Phase-one world requires actual owner and authority key');
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Federated WSS backend must bind loopback');
  if (typeof browserOrigin !== 'string' || new URL(browserOrigin).origin !== browserOrigin ||
      !['http:', 'https:'].includes(new URL(browserOrigin).protocol))
    throw new Error('Explicit exact browser origin required');
  if (typeof authorize !== 'function') throw new Error('Explicit destination policy required');
  if (!replayFile) throw new Error('Durable replay ledger required');
  if (!Array.isArray(inboundPortals) || inboundPortals.length > 64) throw new Error('Invalid inbound portal list');
  const published = publishRegion(region, identity);
  const replay = new DurableHandoffReplay(replayFile);
  const inbound = new Map();
  for (const config of inboundPortals) {
    validatePortal(config.portal);
    if (config.portal.destinationRegion !== region.regionId ||
        !/^elsemesh-node:[a-f0-9]{64}$/.test(config.sourceAuthority) ||
        !Number.isSafeInteger(config.sourceEpoch) || config.sourceEpoch < 0 ||
        inbound.has(config.portal.portalId)) throw new Error('Invalid inbound portal configuration');
    inbound.set(config.portal.portalId, config);
  }
  let entities = new Map();
  let revision = 0;
  let flushTimer = null, lastBroadcastAt = 0;
  const broadcastSnapshots = () => {
    const now = Date.now();
    if (now - lastBroadcastAt >= 100) {
      lastBroadcastAt = now;
      for (const peer of wss.clients) if (peer.worldState?.interest) snapshot(peer);
    } else if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        lastBroadcastAt = Date.now();
        for (const peer of wss.clients) if (peer.worldState?.interest) snapshot(peer);
      }, 100 - (now - lastBroadcastAt));
      flushTimer.unref?.();
    }
  };
  const setEntities = list => {
    if (!Array.isArray(list) || list.length > 4096) throw new Error('Too many public entities');
    const next = new Map(list.map(item => {
      const e = validatePublicEntity(item);
      return [e.entityId, e];
    }));
    if (next.size !== list.length) throw new Error('Duplicate public entity');
    entities = next;
    revision++;
    if (wss.clients.size) broadcastSnapshots();
  };
  const sessions = new Map();
  const stats = { connections: 0, authenticated: 0, denied: 0, dropped: 0, bytesOut: 0 };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME, perMessageDeflate: false });
  const server = createServer((_req, res) => res.writeHead(404).end());
  server.on('upgrade', (req, socket, head) => {
    const hostname = expectedHost || `${host === '::1' ? '[::1]' : host}:${server.address().port}`;
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/world' || url.search || req.headers.origin !== browserOrigin ||
        req.headers.host !== hostname || wss.clients.size >= MAX_PEERS) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  function snapshot(socket) {
    const st = socket.worldState;
    if (!st?.authenticated || !st.interest) return;
    const selected = relevantEntities([...entities.values()], st.interest);
    const packet = { type: 'snapshot', protocol: FEDERATION_WIRE, worldId: region.worldId,
      regionId: region.regionId, revision, entities: selected, capturedAt: Date.now() };
    while (packet.entities.length && Buffer.byteLength(JSON.stringify(packet)) > MAX_CLIENT_FRAME) packet.entities.pop();
    sendBounded(socket, packet, stats);
  }
  wss.on('connection', socket => {
    stats.connections++;
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    const challenge = signObject({ kind: 'elsemesh-world-challenge/1', protocol: FEDERATION_WIRE,
      worldId: region.worldId, regionId: region.regionId, authorityEpoch: region.authority.epoch,
      manifestHash: published.manifestHash, nonce: randomUUID(), issuedAt: Date.now(),
      expiresAt: Date.now() + 5000 }, identity);
    socket.worldState = { authenticated: false, challenge, interest: null,
      count: 0, windowStart: Date.now(), permissions: [], playerId: null, playerNodeId: null };
    sendBounded(socket, { type: 'challenge', challenge, manifest: published }, stats);
    const timer = setTimeout(() => { if (!socket.worldState.authenticated) socket.close(1008, 'Auth timeout'); }, 5000);
    timer.unref?.();
    socket.on('close', () => {
      clearTimeout(timer);
      const st = socket.worldState;
      if (st?.playerNodeId && sessions.get(st.playerNodeId) === socket) sessions.delete(st.playerNodeId);
    });
    socket.on('error', () => socket.terminate());
    socket.on('message', (bytes, binary) => {
      const state = socket.worldState;
      try {
        if (binary) return socket.close(1003, 'Text only');
        const now = Date.now();
        if (state.authenticated && now > state.grant.expiresAt) return socket.close(1012, 'Session renewal required');
        if (now - state.windowStart >= 1000) { state.windowStart = now; state.count = 0; }
        if (++state.count > 30) return socket.close(1008, 'Rate limit');
        const msg = JSON.parse(bytes.toString());
        if (!shape(msg, ['type', 'join', 'center', 'radius', 'handoff']) || typeof msg.type !== 'string')
          return socket.close(1008, 'Invalid message');
        if (!state.authenticated) {
          if (msg.type !== 'authenticate' || !shape(msg.join, ['kind', 'protocol', 'worldId', 'regionId',
              'authorityEpoch', 'serverNonce', 'clientNonce', 'issuedAt', 'playerId', 'signer', 'publicKey', 'signature']))
            return socket.close(1008, 'Authentication required');
          const j = msg.join;
          if (j.kind !== 'elsemesh-world-join/1' || j.protocol !== FEDERATION_WIRE ||
              j.worldId !== region.worldId || j.regionId !== region.regionId ||
              j.authorityEpoch !== region.authority.epoch ||
              j.serverNonce !== challenge.nonce || !NONCE.test(j.clientNonce) ||
              now > challenge.expiresAt || !Number.isSafeInteger(j.issuedAt) || Math.abs(j.issuedAt - now) > 5000 ||
              !PLAYER.test(j.playerId) || !verifyObject(j, new Set([j.signer])) ||
              nodeId(j.publicKey) !== j.signer) {
            stats.denied++;
            return socket.close(1008, 'Invalid challenge proof');
          }
          // No identity claim is accepted merely because it was cryptographically
          // signed. The world owner must explicitly bind signer to player ID.
          const policy = authorize({ playerId: j.playerId, playerNodeId: j.signer,
            worldId: region.worldId, regionId: region.regionId });
          if (!policy || policy.allowed !== true ||
              !Array.isArray(policy.permissions) ||
              !policy.permissions.length ||
              !policy.permissions.every(p => ['view', 'visit'].includes(p))) {
            stats.denied++;
            return socket.close(1008, 'Destination denied admission');
          }
          // Exactly one active world session per cryptographic player identity.
          // A new authenticated device supersedes an old session without cloning an avatar.
          const previous = sessions.get(j.signer);
          if (previous && previous !== socket) previous.close(1012, 'New signed session');
          sessions.set(j.signer, socket);
          state.authenticated = true;
          state.playerId = j.playerId;
          state.playerNodeId = j.signer;
          state.permissions = [...new Set(policy.permissions)];
          stats.authenticated++;
          const grant = signObject({ kind: 'elsemesh-world-admission/1', protocol: FEDERATION_WIRE,
            worldId: region.worldId, regionId: region.regionId, playerId: j.playerId,
            playerNodeId: j.signer, sessionId: randomUUID(),
            authorityEpoch: region.authority.epoch, permissions: state.permissions,
            issuedAt: now, expiresAt: now + 10 * 60_000 }, identity);
          state.grant = grant;
          sendBounded(socket, { type: 'admitted', grant }, stats);
          return;
        }
        if (msg.type === 'subscribe') {
          if (!state.permissions.includes('view') || !vector(msg.center) ||
              !Number.isFinite(msg.radius) || msg.radius < 1 || msg.radius > 250)
            return socket.close(1008, 'Invalid subscription');
          state.interest = { center: [...msg.center], radius: msg.radius };
          snapshot(socket);
          return;
        }
        if (msg.type === 'travel') {
          const h = msg.handoff;
          if (!state.permissions.includes('visit') || !h || typeof h !== 'object' || !inbound.has(h.portalId))
            return socket.close(1008, 'No travel permission');
          const config = inbound.get(h.portalId);
          if (h.playerId !== state.playerId) return socket.close(1008, 'Player mismatch');
          // Portal source signature, current epoch, explicit destination policy,
          // portal player allowlist, freshness and durable replay rejection.
          const admitted = acceptPortalHandoff(h, {
            portal: config.portal, sourceAuthority: config.sourceAuthority,
            sourceEpoch: config.sourceEpoch, destinationRules: region.rules,
            supportedCapabilities: config.supportedCapabilities,
            trustedAuthorities: new Set([config.sourceAuthority]), replay,
            destinationAdmission: ({ handoff }) => ({
              accepted: true, playerId: state.playerId, sessionId: handoff.sessionId,
              destinationRegion: region.regionId }),
          });
          const arrival = signObject({ kind: 'elsemesh-world-travel/1', protocol: FEDERATION_WIRE,
            handoffId: admitted.handoffId, regionId: region.regionId, worldId: region.worldId,
            playerId: state.playerId, playerNodeId: state.playerNodeId,
            authorityEpoch: region.authority.epoch, spawn: admitted.spawn,
            issuedAt: now, sessionId: state.grant.sessionId }, identity);
          sendBounded(socket, { type: 'travel-admitted', arrival }, stats);
          return;
        }
        socket.close(1008, 'Unknown action');
      } catch {
        stats.denied++;
        socket.close(1008, 'Malformed or denied');
      }
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    setEntities(initialEntities);
  } catch (error) { replay.close(); throw error; }
  const heartbeat = setInterval(() => {
    for (const peer of wss.clients) {
      if (peer.worldState?.authenticated && Date.now() > peer.worldState.grant.expiresAt) {
        peer.close(1012, 'Session renewal required');
        continue;
      }
      if (!peer.alive) { peer.terminate(); continue; }
      peer.alive = false;
      peer.ping();
    }
  }, 15000);
  heartbeat.unref?.();
  return {
    address: server.address(), published, ownerNodeId: identity.nodeId, setEntities,
    metrics: () => ({ ...stats, connected: wss.clients.size, revision, replayEntries: replay.size }),
    close: async () => {
      clearInterval(heartbeat);
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      for (const peer of wss.clients) peer.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
      replay.close();
    },
  };
}
