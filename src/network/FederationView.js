import { FederatedWorldClient } from './FederatedWorldClient.js';

export class FederationView {
  constructor({ endpoint, ownerNodeId, worldId, regionId, playerId, identity, WebSocketClass,
    random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.config = { url: endpoint, expectedOwnerNodeId: ownerNodeId,
      expectedWorldId: worldId, expectedRegionId: regionId, identity, playerId, WebSocketClass };
    this.random = random;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.listeners = new Set();
    this.running = false;
    this.connected = false;
    this.latest = null;
    this.interest = null;
    this.attempt = 0;
    this.timer = null;
    this.client = null;
  }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const fn of this.listeners) fn(event); }
  start() {
    if (this.running) return;
    this.running = true;
    this.dial();
  }
  dial() {
    if (!this.running) return;
    let client;
    try { client = new FederatedWorldClient(this.config); }
    catch (error) { this.running = false; this.emit({ type: 'fatal', error: error.message }); return; }
    this.client = client;
    client.onMessage(message => {
      if (client !== this.client || !this.running) return;
      if (message.type === 'snapshot') {
        this.latest = message;
        this.emit({ type: 'snapshot', packet: message });
      } else if (message.type === 'protocol-error') {
        this.emit(message);
      } else if (message.type === 'disconnected') {
        this.connected = false;
        this.latest = null; // never display indefinitely stale remote state
        this.emit({ type: 'disconnected', code: message.code });
        if ([1003, 1008, 1009, 4009].includes(message.code)) {
          this.running = false; // No policy/identity/format downgrades
          this.emit({ type: 'denied', code: message.code });
        } else this.schedule();
      }
    });
    client.ready.then(async grant => {
      if (!this.running || this.client !== client) return;
      this.connected = true;
      this.attempt = 0;
      this.emit({ type: 'admitted', grant });
      if (this.interest) await client.subscribe(this.interest.center, this.interest.radius);
    }).catch(error => {
      if (!this.running || this.client !== client) return;
      this.emit({ type: 'error', error: error.message });
      // Socket close, not exception classification, determines if reconnect is legal.
      if (client.closed && !this.timer) this.schedule();
    });
  }
  schedule() {
    if (!this.running || this.timer) return;
    const cap = Math.min(15000, 500 * 2 ** Math.min(this.attempt++, 8));
    const delay = Math.max(100, Math.floor(cap * Math.max(0, Math.min(1, this.random()))));
    this.emit({ type: 'reconnecting', delayMs: delay });
    this.timer = this.setTimer(() => { this.timer = null; this.dial(); }, delay);
  }
  async watch(center, radius = 150) {
    if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite) ||
        !(Number.isFinite(radius) && radius >= 1 && radius <= 250))
      throw new Error('Invalid world-view interest');
    this.interest = { center: [...center], radius };
    if (this.connected) await this.client.subscribe(center, radius);
  }
  async visit(handoff, timeoutMs = 10000) {
    if (!this.connected || !this.client) throw new Error('Destination unavailable');
    const current = this.client;
    let cancelWait = () => {};
    const outcome = new Promise((resolve, reject) => {
      const timer = this.setTimer(() => { off(); reject(new Error('Portal destination timed out')); }, timeoutMs);
      const off = current.onMessage(message => {
        if (!['travel-admitted', 'disconnected', 'protocol-error'].includes(message.type)) return;
        this.clearTimer(timer);
        off();
        if (message.type === 'disconnected') reject(new Error('Portal transfer interrupted'));
        else if (message.type === 'protocol-error') reject(new Error(message.error));
        else resolve(message.arrival);
      });
      cancelWait = () => { this.clearTimer(timer); off(); };
    });
    try { await current.travel(handoff); }
    catch (error) { cancelWait(); throw error; }
    return outcome;
  }
  stop() {
    this.running = false;
    this.connected = false;
    this.latest = null;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.client?.close();
  }
}
