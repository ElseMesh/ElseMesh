import net from 'node:net';
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { NetworkTransport } from './transport.mjs';
import { signObject, verifyObject } from './identity.mjs';
import { CAPABILITIES, MAX_MESSAGE_BYTES, envelope, validateEnvelope, ReplayGuard, LatestTransient } from './protocol.mjs';

function framed(socket, onMessage) {
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > MAX_MESSAGE_BYTES * 2) return socket.destroy();
    while (pending.length >= 4) {
      const size = pending.readUInt32BE(0);
      if (size > MAX_MESSAGE_BYTES || size < 2) return socket.destroy();
      if (pending.length < size + 4) break;
      let parsed;
      try { parsed = JSON.parse(pending.subarray(4, size + 4).toString('utf8')); } catch { return socket.destroy(); }
      pending = pending.subarray(size + 4);
      onMessage(parsed, socket);
    }
  });
}
function writeFrame(socket, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_MESSAGE_BYTES) throw new Error('Oversized frame');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(bytes.length);
  socket.write(Buffer.concat([header, bytes]));
}

// Bounded reference adapter: TCP reliable stream + UDP transient datagrams.
// Explicit routes are supplied externally; it does not claim NAT traversal or encryption.
export class TcpUdpTransport extends NetworkTransport {
  #identity; #trusted; #server; #udp; #peers = new Map(); #events = new EventEmitter();
  #replay = new ReplayGuard(); #latestTransient = new LatestTransient(); #sequence = 0; #session = randomUUID(); #port; #host; #started = false;
  constructor({ identity, trustedIds, host = '127.0.0.1', port = 0, allowInsecureDevelopment = false }) {
    super();
    if (host !== '127.0.0.1' && !allowInsecureDevelopment) throw new Error('Unencrypted reference transport is loopback-only without explicit unsafe-development opt-in');
    this.#identity = identity; this.#trusted = trustedIds; this.#host = host; this.#port = port;
  }
  on(type, fn) { this.#events.on(type, fn); return this; }
  off(type, fn) { this.#events.off(type, fn); return this; }
  node_id() { return this.#identity.nodeId; }
  local_addresses() { return this.#started ? [{ host: this.#host, port: this.#port }] : []; }
  observed_addresses() { return []; }
  async start_node() {
    if (this.#started) return;
    this.#server = net.createServer((socket) => this.#wire(socket));
    await new Promise((resolve, reject) => { this.#server.once('error', reject); this.#server.listen(this.#port, this.#host, resolve); });
    this.#port = this.#server.address().port;
    this.#udp = dgram.createSocket('udp4');
    this.#udp.on('message', (data, remote) => {
      try {
        if (data.length > MAX_MESSAGE_BYTES) return;
        const signed = JSON.parse(data.toString());
        if (!verifyObject(signed, this.#trusted)) return;
        const msg = validateEnvelope(signed.message);
        if (msg.from !== signed.signer || msg.to !== this.node_id() || msg.channel !== 'transient') return;
        if (this.#peers.get(msg.from)?.session !== msg.session) return;
        if (!this.#latestTransient.accept(msg.from, msg.session, msg.sequence)) return;
        this.#events.emit('message', msg, remote);
      } catch { /* malformed datagrams are discarded */ }
    });
    await new Promise((resolve) => this.#udp.bind(this.#port, this.#host, resolve));
    this.#started = true;
  }
  async stop_node() {
    for (const { socket } of this.#peers.values()) socket.destroy();
    this.#peers.clear();
    if (this.#server) await new Promise((resolve) => this.#server.close(resolve));
    if (this.#udp) await new Promise((resolve) => this.#udp.close(resolve));
    this.#started = false;
  }
  #wire(socket) {
    socket.setTimeout(30_000, () => socket.destroy());
    framed(socket, (packet) => {
      try {
        if (packet.kind === 'hello') {
          if (!verifyObject(packet, this.#trusted) || packet.nodeId !== packet.signer || !Array.isArray(packet.capabilities)) return socket.destroy();
          if (typeof packet.session !== 'string' || !/^[0-9a-f-]{36}$/.test(packet.session)) return socket.destroy();
          socket.setTimeout(0);
          this.#peers.set(packet.nodeId, { socket, session: packet.session, route: { host: socket.remoteAddress, port: packet.port }, since: Date.now(), bytesSent: 0, bytesReceived: 0, reconnects: 0 });
          if (!socket.elsemeshHelloSent) this.#hello(socket);
          this.#events.emit('peer', packet.nodeId, packet.capabilities);
          return;
        }
        const msg = validateEnvelope(packet);
        const peer = this.#peers.get(msg.from);
        if (!peer || peer.socket !== socket || msg.to !== this.node_id() || msg.channel !== 'reliable' || msg.session !== peer.session) return socket.destroy();
        if (!this.#replay.accept(`${msg.from}:${msg.session}:${msg.channel}:${msg.sequence}`)) return;
        peer.bytesReceived += Buffer.byteLength(JSON.stringify(packet));
        this.#events.emit('message', msg, socket);
      } catch { socket.destroy(); }
    });
    socket.on('close', () => {
      for (const [id, peer] of this.#peers) if (peer.socket === socket) { this.#peers.delete(id); this.#events.emit('disconnect', id); }
    });
    socket.on('error', () => {});
  }
  #hello(socket) {
    writeFrame(socket, signObject({ kind: 'hello', nodeId: this.node_id(), port: this.#port, capabilities: CAPABILITIES, session: this.#session }, this.#identity));
    socket.elsemeshHelloSent = true;
  }
  async discover_peer(nodeId, route) { return { nodeId, route }; }
  async connect_peer(nodeId, route) {
    if (!this.#trusted.has(nodeId)) throw new Error('Unknown node');
    const socket = net.createConnection({ host: route.host, port: route.port });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    this.#wire(socket); this.#hello(socket);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('Peer identity timeout')); }, 5000);
      const onPeer = (id) => { if (id === nodeId) { clearTimeout(timer); this.#events.off('peer', onPeer); resolve(id); } };
      this.#events.on('peer', onPeer);
      socket.once('close', () => { clearTimeout(timer); this.#events.off('peer', onPeer); reject(new Error('Peer disconnected during handshake')); });
    });
  }
  async disconnect_peer(nodeId) { this.#peers.get(nodeId)?.socket.destroy(); }
  async open_stream(nodeId) { return this.#peers.get(nodeId)?.socket ?? null; }
  async send_reliable(nodeId, type, body) {
    const peer = this.#peers.get(nodeId); if (!peer) throw new Error('Peer disconnected');
    const msg = envelope(this.node_id(), nodeId, 'reliable', type, body, this.#sequence++, this.#session);
    writeFrame(peer.socket, msg); peer.bytesSent += Buffer.byteLength(JSON.stringify(msg));
    return msg.sequence;
  }
  async send_unreliable(nodeId, type, body) {
    const peer = this.#peers.get(nodeId); if (!peer) throw new Error('Peer disconnected');
    const packet = Buffer.from(JSON.stringify(signObject({ message: envelope(this.node_id(), nodeId, 'transient', type, body, this.#sequence++, this.#session) }, this.#identity)));
    if (packet.length > MAX_MESSAGE_BYTES) throw new Error('Oversized datagram');
    await new Promise((resolve, reject) => this.#udp.send(packet, peer.route.port, peer.route.host, (err) => err ? reject(err) : resolve()));
    peer.bytesSent += packet.length;
  }
  async advertise_service(name) { return { name, nodeId: this.node_id(), addresses: this.local_addresses() }; }
  async discover_service() { return []; } // external discovery supplies signed NodeID plus routes
  connection_metrics(nodeId) {
    const peer = this.#peers.get(nodeId); if (!peer) return null;
    return { peerNodeId: nodeId, transport: 'tcp-udp-reference', direct: true, relay: null, rttMs: null, jitterMs: null, packetLoss: null, bytesSent: peer.bytesSent, bytesReceived: peer.bytesReceived, reliableQueueDepth: peer.socket.writableLength, transientQueueDepth: 0, connectionAgeMs: Date.now() - peer.since, reconnectCount: peer.reconnects, lastPathChange: null };
  }
  is_direct(nodeId) { return this.#peers.has(nodeId); }
  relay_path() { return null; }
}
