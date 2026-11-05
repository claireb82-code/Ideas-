import test from 'node:test';
import assert from 'node:assert/strict';
import { circleFor, contains, distanceM, diagonalM, split, validateBounds, discoverPlaces, PAGE_CAP } from '../src/discover.js';

const box = { south: 53.3, west: -6.3, north: 53.4, east: -6.2 };

test('distanceM: ~111km per degree of latitude', () => {
  const d = distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111195) < 200, String(d));
});

test('circleFor covers all four corners', () => {
  const { center, radius } = circleFor(box);
  for (const [lat, lng] of [[box.south, box.west], [box.south, box.east], [box.north, box.west], [box.north, box.east]]) {
    assert.ok(distanceM(center, { lat, lng }) <= radius);
  }
});

test('split yields four quadrants that tile the box', () => {
  const q = split(box);
  assert.equal(q.length, 4);
  assert.ok(q.every((b) => b.south < b.north && b.west < b.east));
  assert.equal(Math.min(...q.map((b) => b.south)), box.south);
  assert.equal(Math.max(...q.map((b) => b.north)), box.north);
});

test('validateBounds', () => {
  assert.doesNotThrow(() => validateBounds(box, 50));
  assert.throws(() => validateBounds(null, 50), /numeric/);
  assert.throws(() => validateBounds({ ...box, south: 'x' }, 50), /numeric/);
  assert.throws(() => validateBounds({ ...box, south: 54 }, 50), /empty/);
  assert.throws(() => validateBounds({ south: -91, north: 0, west: 0, east: 1 }, 5000), /range/);
  assert.throws(() => validateBounds(box, 5), /too large/);
});

/** Fake Nearby Search over a fixed venue list: radius filter + 20-result cap, nearest first. */
function fakeNearby(venues) {
  const calls = [];
  const fn = async ({ center, radius }) => {
    calls.push({ center, radius });
    return venues
      .map((v) => ({ v, d: distanceM(center, v) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, PAGE_CAP)
      .map((x) => x.v);
  };
  fn.calls = calls;
  return fn;
}

const grid = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: `p${i}`, lat: box.south + 0.0005 + ((i % 20) * 0.1) / 20, lng: box.west + 0.0005 + (Math.floor(i / 20) * 0.1) / (n / 20) });
  return out;
};

test('discoverPlaces: small area needs a single request', async () => {
  const venues = grid(5);
  const nearby = fakeNearby(venues);
  const r = await discoverPlaces({ bounds: box, nearby });
  assert.equal(r.places.length, 5);
  assert.equal(r.requests, 1);
  assert.equal(r.truncated, false);
});

test('discoverPlaces: a full page triggers subdivision and finds everything', async () => {
  const venues = grid(100);
  const nearby = fakeNearby(venues);
  const r = await discoverPlaces({ bounds: box, nearby, maxRequests: 200, maxDepth: 4 });
  assert.equal(r.places.length, 100);
  assert.ok(r.requests > 1);
  assert.equal(r.truncated, false);
});

test('discoverPlaces: de-duplicates places seen by overlapping circles', async () => {
  const r = await discoverPlaces({ bounds: box, nearby: fakeNearby(grid(60)), maxRequests: 200, maxDepth: 4 });
  assert.equal(new Set(r.places.map((p) => p.id)).size, r.places.length);
});

test('discoverPlaces: respects the request budget and reports truncation', async () => {
  const nearby = fakeNearby(grid(200));
  const r = await discoverPlaces({ bounds: box, nearby, maxRequests: 3, maxDepth: 5 });
  assert.ok(r.requests <= 3);
  assert.equal(r.truncated, true);
});

test('discoverPlaces: reports truncation when max depth is hit while still full', async () => {
  const dense = Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, lat: 53.35, lng: -6.25 + i * 1e-7 }));
  const r = await discoverPlaces({ bounds: box, nearby: fakeNearby(dense), maxRequests: 500, maxDepth: 1 });
  assert.equal(r.truncated, true);
});

test('discoverPlaces: drops places outside the requested box (circle overspill)', async () => {
  const outside = { id: 'out', lat: 53.45, lng: -6.25 };
  const inside = { id: 'in', lat: 53.35, lng: -6.25 };
  const r = await discoverPlaces({ bounds: box, nearby: async () => [outside, inside] });
  assert.deepEqual(r.places.map((p) => p.id), ['in']);
  assert.equal(contains(box, outside), false);
  assert.ok(diagonalM(box) > 0);
});

test('regression: circle covers a venue in the far (southern) corners at high latitude', async () => {
  const wide = { south: 60.0, west: 10.0, north: 60.2, east: 10.6 };
  const { center, radius } = circleFor(wide);
  assert.ok(distanceM(center, { lat: wide.south, lng: wide.west }) <= radius);
  assert.ok(distanceM(center, { lat: wide.south, lng: wide.east }) <= radius);
});
