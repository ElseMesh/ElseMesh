// Transport-independent WebCrypto proof used by ordinary browser worlds.
// Never trust the authority name supplied by a network endpoint: pin NodeID.
const encoder = new TextEncoder();
const b64ToBytes = base64 => Uint8Array.from(atob(base64), c => c.charCodeAt(0));
const bytesToB64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
const decodePEM = pem => {
  if (typeof pem !== 'string' || !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(pem))
    throw new Error('Malformed owner public key');
  return b64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''));
};
const spkiToPEM = bytes => '-----BEGIN PUBLIC KEY-----\n' +
  bytesToB64(bytes).match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----\n';
export async function verifyWorldSignature(signed, expectedNodeId, subtle = crypto.subtle) {
  if (!signed || signed.signer !== expectedNodeId || typeof signed.signature !== 'string') return false;
  try {
    const spki = decodePEM(signed.publicKey);
    const hash = new Uint8Array(await subtle.digest('SHA-256', spki));
    const calculated = 'elsemesh-node:' + Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
    if (calculated !== expectedNodeId) return false;
    const key = await subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
    const { signature, ...payload } = signed;
    return await subtle.verify({ name: 'Ed25519' }, key, b64ToBytes(signature), encoder.encode(canonical(payload)));
  } catch { return false; }
}
export async function signedWorldJoin(identity, challenge, playerId, subtle = crypto.subtle) {
  const spki = await subtle.exportKey('spki', identity.publicKey);
  const publicKey = spkiToPEM(new Uint8Array(spki));
  const hash = new Uint8Array(await subtle.digest('SHA-256', spki));
  const signer = 'elsemesh-node:' + Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  if (signer !== identity.nodeId) throw new Error('Browser identity mismatch');
  const payload = { kind: 'elsemesh-world-join/1', protocol: 'elsemesh.world-wss/1',
    worldId: challenge.worldId, regionId: challenge.regionId,
    authorityEpoch: challenge.authorityEpoch, serverNonce: challenge.nonce,
    clientNonce: crypto.randomUUID(), issuedAt: Date.now(), playerId, signer, publicKey };
  const signature = bytesToB64(await subtle.sign({ name: 'Ed25519' }, identity.privateKey, encoder.encode(canonical(payload))));
  return { ...payload, signature };
}
/**
 * The client does not switch worlds until signed destination arrival succeeds.
 * Caller controls the actual player/world renderer and its rollback on failure.
 */
export class FederatedWorldClient {
  constructor({ url, expectedOwnerNodeId, expectedWorldId, expectedRegionId, identity,
    playerId, WebSocketClass = WebSocket, subtle = crypto.subtle } = {}) {
    if (typeof expectedOwnerNodeId !== 'string' || !/^elsemesh-node:[a-f0-9]{64}$/.test(expectedOwnerNodeId) ||
        !identity?.privateKey || !playerId || !expectedWorldId || !expectedRegionId)
      throw new Error('Pinned owner, world, region and player identity required');
    const target = new URL(url);
    if (!['wss:', 'ws:'].includes(target.protocol) || (target.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)))
      throw new Error('Federation requires WSS outside loopback');
    this.socket = new WebSocketClass(target.href);
    this.owner = expectedOwnerNodeId;
    this.world = expectedWorldId;
    this.region = expectedRegionId;
    this.identity = identity;
    this.playerId = playerId;
    this.subtle = subtle;
    this.listeners = new Set();
    this.closed = false;
    this.snapshotRevision = -1;
    this.pendingHandoffId = null;
    this.ready = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.readyTimeout = setTimeout(() => {
      this.rejectReady(new Error('Timed out authenticating destination'));
      this.socket.close();
    }, 8000);
    this.readyTimeout.unref?.();
    this.socket.onmessage = async event => {
      try {
        const m = JSON.parse(event.data.toString());
        if (m.type === 'challenge') {
          if (m.challenge?.kind !== 'elsemesh-world-challenge/1' ||
              m.challenge.worldId !== this.world || m.challenge.regionId !== this.region ||
              m.manifest?.descriptor?.regionId !== this.region || m.manifest?.descriptor?.worldId !== this.world ||
              m.challenge.manifestHash !== m.manifest?.manifestHash ||
              m.manifest.manifestHash !== 'sha256:' + Array.from(new Uint8Array(await this.subtle.digest('SHA-256', encoder.encode(canonical(m.manifest.descriptor)))), byte => byte.toString(16).padStart(2, '0')).join('') ||
              Date.now() > m.challenge.expiresAt ||
              !await verifyWorldSignature(m.challenge, this.owner, this.subtle) ||
              !await verifyWorldSignature(m.manifest, this.owner, this.subtle))
            throw new Error('Untrusted or expired world challenge');
          this.socket.send(JSON.stringify({ type: 'authenticate',
            join: await signedWorldJoin(this.identity, m.challenge, this.playerId, this.subtle) }));
          return;
        }
        if (m.type === 'admitted') {
          const g = m.grant;
          if (!g || g.kind !== 'elsemesh-world-admission/1' ||
              g.worldId !== this.world || g.regionId !== this.region ||
              g.playerId !== this.playerId || g.playerNodeId !== this.identity.nodeId ||
              typeof g.sessionId !== 'string' ||
              !Array.isArray(g.permissions) || !g.permissions.length ||
              !g.permissions.every(p => ['view', 'visit'].includes(p)) ||
              !Number.isFinite(g.expiresAt) || Date.now() > g.expiresAt ||
              !await verifyWorldSignature(g, this.owner, this.subtle))
            throw new Error('Untrusted destination admission');
          this.grant = g;
          clearTimeout(this.readyTimeout);
          this.resolveReady(g);
        } else if (m.type === 'travel-admitted') {
          if (m.arrival?.worldId !== this.world ||
              m.arrival?.regionId !== this.region ||
              m.arrival?.playerId !== this.playerId ||
              m.arrival?.playerNodeId !== this.identity.nodeId ||
              m.arrival?.sessionId !== this.grant?.sessionId ||
              m.arrival?.handoffId !== this.pendingHandoffId ||
              Math.abs(Date.now() - m.arrival?.issuedAt) > 30000 ||
              m.arrival?.authorityEpoch !== this.grant?.authorityEpoch ||
              !await verifyWorldSignature(m.arrival, this.owner, this.subtle))
            throw new Error('Untrusted portal arrival');
          this.pendingHandoffId = null;
        } else if (m.type === 'snapshot') {
          if (!this.grant?.permissions.includes('view') || m.protocol !== 'elsemesh.world-wss/1' ||
              m.worldId !== this.world || m.regionId !== this.region ||
              !Number.isSafeInteger(m.revision) || m.revision < this.snapshotRevision ||
              !Number.isFinite(m.capturedAt) || Math.abs(Date.now() - m.capturedAt) > 60000 ||
              !Array.isArray(m.entities) || m.entities.length > 64 ||
              !m.entities.every(e => e && Object.keys(e).every(k => ['entityId', 'kind', 'position', 'yaw', 'revision'].includes(k)) &&
                typeof e.entityId === 'string' && /^[a-z0-9._:-]{1,128}$/.test(e.entityId) &&
                ['player','npc','prop'].includes(e.kind) && Array.isArray(e.position) && e.position.length === 3 &&
                e.position.every(v => Number.isFinite(v) && Math.abs(v) <= 1000000) &&
                Number.isFinite(e.yaw) && Number.isSafeInteger(e.revision) && e.revision >= 0))
            throw new Error('Invalid remote world snapshot');
          this.snapshotRevision = m.revision;
        }
        for (const listener of this.listeners) listener(m);
      } catch (error) {
        this.rejectReady(error);
        this.socket.close(1008, 'Untrusted destination');
      }
    };
    this.socket.onclose = event => {
      clearTimeout(this.readyTimeout);
      this.closed = true;
      this.rejectReady(new Error('World disconnected: ' + event.code));
      for (const listener of this.listeners) listener({ type: 'disconnected', code: event.code });
    };
    this.socket.onerror = () => this.rejectReady(new Error('World connection failed'));
  }
  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async subscribe(center, radius = 150) {
    await this.ready;
    if (!this.grant.permissions.includes('view')) throw new Error('No world viewing grant');
    this.socket.send(JSON.stringify({ type: 'subscribe', center, radius }));
  }
  async travel(handoff) {
    await this.ready;
    if (!this.grant.permissions.includes('visit')) throw new Error('No world entry grant');
    if (this.pendingHandoffId) throw new Error('Another portal transfer is pending');
    if (!handoff || typeof handoff.handoffId !== 'string') throw new Error('Signed handoff required');
    this.pendingHandoffId = handoff.handoffId;
    this.socket.send(JSON.stringify({ type: 'travel', handoff }));
  }
  close() { clearTimeout(this.readyTimeout); this.socket.close(); }
}
