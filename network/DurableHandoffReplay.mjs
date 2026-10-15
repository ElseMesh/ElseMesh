import { openSync, readFileSync, writeSync, fsyncSync, closeSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Portal handoff IDs are short-lived, but their replay rejection must survive
// a destination process restart. Append and sync before acknowledging admission.
export class DurableHandoffReplay {
  #seen = new Set();
  #fd;
  #max;
  constructor(path, { maxEntries = 100000 } = {}) {
    if (typeof path !== 'string' || !path) throw new Error('Durable replay path required');
    this.#max = maxEntries;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const contents = readFileSync(path, 'utf8');
      if (Buffer.byteLength(contents) > 5_000_000) throw new Error('Replay ledger too large: fail closed');
      for (const line of contents.split('\n')) {
        if (!line) continue;
        if (!/^[a-f0-9-]{36}$/.test(line) || this.#seen.has(line))
          throw new Error('Corrupt replay ledger: fail closed');
        this.#seen.add(line);
      }
    }
    if (this.#seen.size >= this.#max) throw new Error('Replay ledger full: fail closed');
    this.#fd = openSync(path, 'a', 0o600);
  }
  accept(key) {
    if (!/^[a-f0-9-]{36}$/.test(key) || this.#seen.has(key) || this.#seen.size >= this.#max) return false;
    const bytes = Buffer.from(key + '\n');
    const wrote = writeSync(this.#fd, bytes);
    if (wrote !== bytes.length) throw new Error('Replay ledger write incomplete');
    fsyncSync(this.#fd);
    this.#seen.add(key);
    return true;
  }
  close() { if (this.#fd !== undefined) { closeSync(this.#fd); this.#fd = undefined; } }
  get size() { return this.#seen.size; }
}
