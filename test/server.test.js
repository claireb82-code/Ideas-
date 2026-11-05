// Integration tests: real Express app on an ephemeral port, fake Places + fake websites.
import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createApp, runPool } from '../src/server.js';
import { JsonCache } from '../src/cache.js';
import { loadConfig } from '../src/config.js';
import { createMockNearby, mockGeocode } from '../src/mock.js';
import { fakeFetch, page, filler } from './helpers.js';

const BOUNDS = { south: 53.335, west: -6.28, north: 53.355, east: -6.245 };

async function withServer({ mock = true, configOver = {}, nearby, fetchImpl, cache } = {}, fn) {
  const config = { ...loadConfig({}, mock ? ['--mock'] : []), ...configOver };
  // Listen first so mock venues can point at our own origin, then install the real app.
  const holder = {};
  const server = http.createServer((req, res, next) => holder.app(req, res, next));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  holder.app = createApp({
    config,
    nearby: nearby === undefined ? createMockNearby(origin) : nearby,
    geocodeFn: mockGeocode,
    cache: cache ?? new JsonCache(null, 1e9),
    fetchOpts: fetchImpl ? { fetchImpl, allowPrivate: true } : { allowPrivate: true },
  });
  try {
    await fn(origin);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (origin, body) => fetch(`${origin}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ndjson = async (res) => (await res.text()).trim().split('\n').map((l) => JSON.parse(l));

test('GET /api/config exposes browser key but never the places key', async () => {
  await withServer({ configOver: { browserKey: 'BROWSER', placesKey: 'SECRET' } }, async (o) => {
    const c = await (await fetch(`${o}/api/config`)).json();
    assert.equal(c.browserKey, 'BROWSER');
    assert.equal(c.searchEnabled, true);
    assert.ok(!JSON.stringify(c).includes('SECRET'));
  });
});

test('POST /api/search validates bounds', async () => {
  await withServer({}, async (o) => {
    assert.equal((await post(o, {})).status, 400);
    assert.equal((await post(o, { bounds: { south: 0, west: 0, north: 40, east: 40 } })).status, 400);
    const r = await post(o, { bounds: { south: 0, west: 0, north: 40, east: 40 } });
    assert.match((await r.json()).error, /too large/);
  });
});

test('POST /api/search with no Places key returns a helpful 503', async () => {
  await withServer({ mock: false, nearby: null }, async (o) => {
    const r = await post(o, { bounds: BOUNDS });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /GOOGLE_PLACES_API_KEY/);
  });
});

test('end to end (mock mode): streams places then results with the right statuses', async () => {
  await withServer({}, async (o) => {
    const res = await post(o, { bounds: BOUNDS });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /ndjson/);
    const events = await ndjson(res);

    const first = events[0];
    assert.equal(first.type, 'places');
    assert.equal(first.places.length, 8);
    assert.equal(events.at(-1).type, 'done');

    const status = Object.fromEntries(first.places.map((p) => [p.name, p.check.status]));
    // Answerable immediately: review hit and no-website venues.
    assert.equal(status['The Corner House'], 'reviews');
    assert.equal(status['Harbour Rooms'], 'unknown');
    assert.equal(status['The Old Stand'], 'pending');

    const final = { ...status };
    for (const e of events.filter((e) => e.type === 'result')) final[first.places.find((p) => p.id === e.id).name] = e.check.status;
    assert.deepEqual(final, {
      'The Old Stand': 'menu',
      'The Grand Hotel': 'website',
      'Pasta Place': 'none',
      'Spa Bar': 'unknown',
      'PDF Grill': 'unknown',
      'The Corner House': 'reviews',
      'Harbour Rooms': 'unknown',
      'Broken Link Bistro': 'unknown',
    });
  });
});

test('public payload never includes the raw reviews array or provider internals', async () => {
  await withServer({}, async (o) => {
    const events = await ndjson(await post(o, { bounds: BOUNDS }));
    for (const p of events[0].places) {
      assert.equal('reviews' in p, false);
      const allowed = new Set(['address', 'category', 'check', 'id', 'lat', 'lng', 'mapsUrl', 'name', 'rating', 'ratingCount', 'website']);
      assert.deepEqual(Object.keys(p).filter((k) => !allowed.has(k)), []);
    }
  });
});

test('second search is served from cache without re-crawling', async () => {
  const cache = new JsonCache(null, 1e9);
  const f = fakeFetch({ 'https://pub.test/': page('Pub', `${filler} Guinness on tap`) });
  const nearby = async () => [{ id: 'x1', name: 'Pub', category: 'pub', lat: 53.34, lng: -6.26, website: 'https://pub.test/', reviews: [] }];
  await withServer({ nearby, fetchImpl: f, cache }, async (o) => {
    const e1 = await ndjson(await post(o, { bounds: BOUNDS }));
    assert.equal(e1[0].places[0].check.status, 'pending');
    assert.equal(e1.find((e) => e.type === 'result').check.status, 'website');
    const callsAfterFirst = f.calls.length;

    const e2 = await ndjson(await post(o, { bounds: BOUNDS }));
    assert.equal(e2[0].places[0].check.status, 'website'); // answered instantly from cache
    assert.equal(e2.filter((e) => e.type === 'result').length, 0);
    assert.equal(f.calls.length, callsAfterFirst);
  });
});

test('"unknown" results are not cached (so transient failures are retried)', async () => {
  const cache = new JsonCache(null, 1e9);
  const nearby = async () => [{ id: 'x1', name: 'Down', category: 'bar', lat: 53.34, lng: -6.26, website: 'https://down.test/', reviews: [] }];
  await withServer({ nearby, fetchImpl: fakeFetch({}), cache }, async (o) => {
    await post(o, { bounds: BOUNDS }).then((r) => r.text());
    assert.equal(cache.get('x1|https://down.test/'), undefined);
  });
});

test('Places API failure becomes a 502 with a readable message', async () => {
  const nearby = async () => { throw new Error('API key not valid'); };
  await withServer({ nearby }, async (o) => {
    const r = await post(o, { bounds: BOUNDS });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /API key not valid/);
  });
});

test('GET /api/geocode', async () => {
  await withServer({}, async (o) => {
    assert.equal((await fetch(`${o}/api/geocode`)).status, 400);
    const j = await (await fetch(`${o}/api/geocode?q=Dublin`)).json();
    assert.equal(j.name, 'Dublin');
    assert.ok(j.bounds.north > j.bounds.south);
  });
});

test('runPool: respects the concurrency limit and processes every item', async () => {
  let inflight = 0;
  let peak = 0;
  const done = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 5));
    inflight--;
    done.push(n);
  });
  assert.equal(peak, 3);
  assert.equal(done.length, 7);
});

test('runPool: stops picking up work when stop() turns true', async () => {
  const done = [];
  await runPool([1, 2, 3, 4], 1, async (n) => done.push(n), () => done.length >= 2);
  assert.deepEqual(done, [1, 2]);
});

test('loadConfig: shared key fallback, defaults and overrides', () => {
  const c = loadConfig({ GOOGLE_MAPS_API_KEY: 'K' }, []);
  assert.equal(c.placesKey, 'K');
  assert.equal(c.browserKey, 'K');
  assert.equal(c.maxSearchKm, 10);
  assert.deepEqual(c.placeTypes, ['bar', 'pub', 'restaurant', 'hotel']);
  const d = loadConfig({ MAX_SEARCH_KM: '3', PLACE_TYPES: 'pub, bar', INCLUDE_REVIEWS: 'false' }, ['--mock']);
  assert.equal(d.maxSearchKm, 3);
  assert.deepEqual(d.placeTypes, ['pub', 'bar']);
  assert.equal(d.includeReviews, false);
  assert.equal(d.mock, true);
});
