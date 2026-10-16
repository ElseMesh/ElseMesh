import { openSync, readFileSync, writeSync, writeFileSync, fsyncSync, closeSync, existsSync, mkdirSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// A source-authorised handoff expires after 30s. Persist accepted IDs only for
// the replay window, with a conservative extra retention interval.
// This synchronous prototype must still be latency-profiled before release.
export class DurableHandoffReplay {
  #seen = new Map();
  #fd;
  #path;
  #max;
  #retentionMs;
  #now;
  #logEntries = 0;
  constructor(path, { maxEntries = 100000, retentionMs = 60000, now = Date.now } = {}) {
    if (typeof path !== 'string' || !path) throw new Error('Durable replay path required');
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 2 || maxEntries > 1000000 ||
        !Number.isSafeInteger(retentionMs) || retentionMs < 30000 || retentionMs > 3600000 ||
        typeof now !== 'function') throw new Error('Invalid replay ledger configuration');
    this.#path = path;
    this.#max = maxEntries;
    this.#retentionMs = retentionMs;
    this.#now = now;
    mkdirSync(dirname(path), { recursive: true });
    let dirty = false;
    if (existsSync(path)) {
      const bytes = statSync(path).size;
      if (bytes > 16000000) throw new Error('Replay ledger too large: fail closed');
      const contents = readFileSync(path, 'utf8');
      const lines = contents.split('\n');
      if (lines.at(-1) !== '') {
        // An unfinished final record was not acknowledged, because ack
        // happens only after fsync of the complete record.
        dirty = true;
      }
      lines.pop();
      const time = this.#now();
      for (const line of lines) {
        if (!line) continue;
        const match = /^(\d{13})\t([0-9a-f-]{36})$/.exec(line);
        if (!match || !Number.isSafeInteger(Number(match[1])) || this.#seen.has(match[2]))
          throw new Error('Corrupt committed replay ledger: fail closed');
        const expiry = Number(match[1]);
        if (expiry <= time) { dirty = true; continue; }
        this.#seen.set(match[2], expiry);
        this.#logEntries++;
      }
    }
    if (this.#seen.size >= this.#max) {
      throw new Error('Unexpired replay IDs exceed ledger capacity: fail closed');
    }
    if (dirty) this.#compact();
    this.#fd = openSync(path, 'a', 0o600);
  }
  #compact() {
    const temp = this.#path + '.compact-' + randomUUID();
    const records = [...this.#seen].map(([key, expiry]) => String(expiry) + '\t' + key + '\n').join('');
    let fd;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, records);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, this.#path);
      this.#logEntries = this.#seen.size;
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temp); } catch {}
      throw error;
    }
  }
  #prune(time) {
    for (const [key, expiry] of this.#seen) if (expiry <= time) this.#seen.delete(key);
  }
  accept(key, { expiresAt, now } = {}) {
    if (!/^[0-9a-f-]{36}$/.test(key)) return false;
    const time = now ?? this.#now();
    this.#prune(time);
    if (this.#seen.has(key)) return false;
    if (this.#seen.size >= this.#max) return false;
    const expiry = expiresAt ?? time + this.#retentionMs;
    if (!Number.isSafeInteger(expiry) || expiry <= time || expiry > time + this.#retentionMs)
      return false;
    // Compact only *before* processing a new handoff. Both the old journal
    // and a successfully renamed compact copy contain all acknowledged IDs.
    if (this.#logEntries > Math.max(16, this.#max * 2)) {
      closeSync(this.#fd);
      this.#fd = undefined;
      try { this.#compact(); }
      finally { this.#fd = openSync(this.#path, 'a', 0o600); }
    }
    const bytes = Buffer.from(String(expiry) + '\t' + key + '\n');
    const written = writeSync(this.#fd, bytes);
    if (written !== bytes.length) throw new Error('Replay ledger write incomplete');
    fsyncSync(this.#fd);
    this.#seen.set(key, expiry);
    this.#logEntries++;
    return true;
  }
  close() {
    if (this.#fd !== undefined) { closeSync(this.#fd); this.#fd = undefined; }
  }
  get size() { this.#prune(this.#now()); return this.#seen.size; }
}
