import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, DEFAULT_STATUSES, statusOf, sortPlaces, filterPlaces, countByStatus, diagonalKm, readNdjson, applyEvent } from '../public/lib.js';

const P = (id, name, status, category = 'pub', extra = {}) => ({ id, name, category, address: `${name} St`, check: { status }, ...extra });

test('statusOf falls back to unknown for missing or bogus statuses', () => {
  assert.equal(statusOf({}), 'unknown');
  assert.equal(statusOf({ check: { status: 'wat' } }), 'unknown');
  assert.equal(statusOf(P('a', 'A', 'menu')), 'menu');
});

test('every status has label, glyph, rank and help text', () => {
  for (const s of Object.values(STATUS)) assert.ok(s.label && s.glyph && s.help && Number.isInteger(s.rank));
  assert.equal(new Set(Object.values(STATUS).map((s) => s.rank)).size, Object.keys(STATUS).length);
});

test('sortPlaces: best evidence first, then rating, then name; does not mutate', () => {
  const input = [P('1', 'Zed', 'none'), P('2', 'Bob', 'menu', 'pub', { rating: 4.0 }), P('3', 'Amy', 'menu', 'pub', { rating: 4.8 }), P('4', 'Cat', 'reviews')];
  const out = sortPlaces(input).map((p) => p.name);
  assert.deepEqual(out, ['Amy', 'Bob', 'Cat', 'Zed']);
  assert.equal(input[0].name, 'Zed');
});

test('filterPlaces: by status, category and text', () => {
  const places = [P('1', 'Old Stand', 'menu', 'pub'), P('2', 'Grand', 'website', 'hotel'), P('3', 'Pasta', 'none', 'restaurant'), P('4', 'Mystery', 'unknown', 'bar')];
  const statuses = new Set(DEFAULT_STATUSES);
  assert.deepEqual(filterPlaces(places, { statuses }).map((p) => p.id), ['1', '2']);
  assert.deepEqual(filterPlaces(places, { statuses: new Set(Object.keys(STATUS)), categories: new Set(['hotel', 'bar']) }).map((p) => p.id), ['2', '4']);
  assert.deepEqual(filterPlaces(places, { statuses: new Set(Object.keys(STATUS)), text: ' PASTA ' }).map((p) => p.id), ['3']);
  assert.deepEqual(filterPlaces(places, { statuses: new Set() }), []);
});

test('countByStatus counts every status, including zero', () => {
  const c = countByStatus([P('1', 'a', 'menu'), P('2', 'b', 'menu'), P('3', 'c', 'pending')]);
  assert.equal(c.menu, 2);
  assert.equal(c.pending, 1);
  assert.equal(c.none, 0);
});

test('diagonalKm', () => {
  assert.ok(Math.abs(diagonalKm({ south: 0, west: 0, north: 1, east: 0 }) - 111.19) < 0.1);
  assert.equal(diagonalKm({ south: 1, west: 1, north: 1, east: 1 }), 0);
});

const streamOf = (chunks) =>
  new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(typeof x === 'string' ? new TextEncoder().encode(x) : x));
      c.close();
    },
  });

test('readNdjson: handles multiple lines per chunk and lines split across chunks', async () => {
  const out = [];
  for await (const o of readNdjson(streamOf(['{"a":1}\n{"b"', ':2}\n', '{"c":3}']))) out.push(o);
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('readNdjson: survives a multi-byte character split between chunks', async () => {
  const bytes = new TextEncoder().encode('{"s":"Café “Guinness”"}\n');
  const out = [];
  for await (const o of readNdjson(streamOf([bytes.slice(0, 10), bytes.slice(10)]))) out.push(o);
  assert.equal(out[0].s, 'Café “Guinness”');
});

test('readNdjson: ignores blank lines and an empty stream', async () => {
  const out = [];
  for await (const o of readNdjson(streamOf(['\n\n{"a":1}\n\n']))) out.push(o);
  assert.deepEqual(out, [{ a: 1 }]);
  for await (const o of readNdjson(streamOf([]))) assert.fail(`unexpected ${o}`);
});

test('applyEvent: places replace the map, results update one venue, unknown ids are ignored', () => {
  const m = new Map([['old', P('old', 'Old', 'menu')]]);
  applyEvent(m, { type: 'places', places: [P('1', 'A', 'pending'), P('2', 'B', 'pending')] });
  assert.deepEqual([...m.keys()], ['1', '2']);
  applyEvent(m, { type: 'result', id: '1', check: { status: 'menu' } });
  assert.equal(m.get('1').check.status, 'menu');
  assert.equal(m.get('2').check.status, 'pending');
  applyEvent(m, { type: 'result', id: 'nope', check: { status: 'menu' } });
  assert.equal(m.size, 2);
  applyEvent(m, { type: 'done' });
  assert.equal(m.size, 2);
});
