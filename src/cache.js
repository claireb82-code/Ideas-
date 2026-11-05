// Tiny JSON-file cache for website-check results (keyed by Google place id).
// Only our own derived result is stored - never Google Places content.
import fs from 'node:fs';
import path from 'node:path';

export class JsonCache {
  /** @param {string|null} file  path, or null for in-memory only */
  constructor(file, ttlMs, now = () => Date.now()) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.now = now;
    this.data = {};
    this.timer = null;
    if (file) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }

  get(key) {
    const e = this.data[key];
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) {
      delete this.data[key];
      return undefined;
    }
    return e.value;
  }

  set(key, value) {
    this.data[key] = { at: this.now(), value };
    this.#scheduleSave();
  }

  #scheduleSave() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 1000);
    this.timer.unref?.();
  }

  flush() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}
