import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonCache } from '../src/cache.js';

test('get/set round trip', () => {
  const c = new JsonCache(null, 1000);
  c.set('a', { status: 'menu' });
  assert.deepEqual(c.get('a'), { status: 'menu' });
  assert.equal(c.get('missing'), undefined);
});

test('entries expire after the TTL', () => {
  let t = 0;
  const c = new JsonCache(null, 1000, () => t);
  c.set('a', 1);
  t = 999;
  assert.equal(c.get('a'), 1);
  t = 1001;
  assert.equal(c.get('a'), undefined);
});

test('persists to disk and reloads; tolerates a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
  const file = path.join(dir, 'nested', 'c.json');
  const c1 = new JsonCache(file, 60_000);
  c1.set('k', { v: 1 });
  c1.flush();
  assert.deepEqual(new JsonCache(file, 60_000).get('k'), { v: 1 });
  fs.writeFileSync(file, '{not json');
  assert.equal(new JsonCache(file, 60_000).get('k'), undefined);
  fs.rmSync(dir, { recursive: true });
});
