// places.js talks to Google. These tests use a fake fetch, so they verify OUR request shape and
// response handling, not Google's behaviour. See docs/TESTING.md ("What is not covered").
import test from 'node:test';
import assert from 'node:assert/strict';
import { categorize, normalizePlace, createNearby, geocode } from '../src/places.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const recorder = (respond) => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return respond(calls.length);
  };
  f.calls = calls;
  return f;
};

test('categorize: pub beats bar beats restaurant beats hotel', () => {
  assert.equal(categorize(['restaurant', 'bar', 'pub']), 'pub');
  assert.equal(categorize(['irish_pub']), 'pub');
  assert.equal(categorize(['restaurant', 'bar']), 'bar');
  assert.equal(categorize(['bar_and_grill']), 'bar');
  assert.equal(categorize(['italian_restaurant']), 'restaurant');
  assert.equal(categorize(['lodging', 'hotel']), 'hotel');
  assert.equal(categorize(['bed_and_breakfast', 'lodging']), 'hotel');
  assert.equal(categorize(['hotel'], 'hotel'), 'hotel');
  assert.equal(categorize([]), 'restaurant');
});

test('normalizePlace maps Places API fields to our shape', () => {
  const p = normalizePlace({
    id: 'abc', displayName: { text: 'The Pub' }, formattedAddress: '1 Main St', location: { latitude: 1, longitude: 2 },
    types: ['pub'], websiteUri: 'https://pub.test', googleMapsUri: 'https://maps.google.com/?cid=1', rating: 4.5, userRatingCount: 10,
    businessStatus: 'OPERATIONAL', reviews: [{ text: { text: 'Great Guinness' } }, { originalText: { text: 'Bonne bière' } }, {}],
  });
  assert.deepEqual(p, {
    id: 'abc', name: 'The Pub', address: '1 Main St', lat: 1, lng: 2, category: 'pub', website: 'https://pub.test',
    mapsUrl: 'https://maps.google.com/?cid=1', rating: 4.5, ratingCount: 10, reviews: ['Great Guinness', 'Bonne bière'], closed: false,
  });
});

test('normalizePlace tolerates sparse data', () => {
  const p = normalizePlace({ id: 'z', location: { latitude: 1, longitude: 2 } });
  assert.equal(p.name, 'Unnamed venue');
  assert.deepEqual(p.reviews, []);
  assert.equal(p.website, undefined);
});

test('createNearby: sends key, field mask and a circle restriction', async () => {
  const f = recorder(() => json({ places: [] }));
  await createNearby({ key: 'KEY', types: ['bar', 'pub'], includeReviews: false, fetchImpl: f })({ center: { lat: 53.3, lng: -6.2 }, radius: 700 });
  const [c] = f.calls;
  assert.equal(c.url, 'https://places.googleapis.com/v1/places:searchNearby');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['x-goog-api-key'], 'KEY');
  assert.ok(c.init.headers['x-goog-fieldmask'].includes('places.websiteUri'));
  assert.ok(!c.init.headers['x-goog-fieldmask'].includes('places.reviews'));
  assert.deepEqual(c.body, {
    includedTypes: ['bar', 'pub'], maxResultCount: 20, rankPreference: 'DISTANCE',
    locationRestriction: { circle: { center: { latitude: 53.3, longitude: -6.2 }, radius: 700 } },
  });
});

test('createNearby: requests reviews only when enabled, and caps radius at 50 km', async () => {
  const f = recorder(() => json({}));
  await createNearby({ key: 'K', types: ['bar'], includeReviews: true, fetchImpl: f })({ center: { lat: 0, lng: 0 }, radius: 99999 });
  assert.ok(f.calls[0].init.headers['x-goog-fieldmask'].includes('places.reviews'));
  assert.equal(f.calls[0].body.locationRestriction.circle.radius, 50000);
});

test('createNearby: empty response ({}), closed venues and location-less places are dropped', async () => {
  const f = recorder((n) =>
    n === 1
      ? json({})
      : json({ places: [
          { id: '1', displayName: { text: 'Open' }, location: { latitude: 1, longitude: 1 }, types: ['bar'], businessStatus: 'OPERATIONAL' },
          { id: '2', displayName: { text: 'Shut' }, location: { latitude: 1, longitude: 1 }, types: ['bar'], businessStatus: 'CLOSED_PERMANENTLY' },
          { id: '3', displayName: { text: 'NoLoc' }, types: ['bar'] },
        ] }),
  );
  const nearby = createNearby({ key: 'K', types: ['bar'], includeReviews: false, fetchImpl: f });
  assert.deepEqual(await nearby({ center: { lat: 0, lng: 0 }, radius: 1 }), []);
  assert.deepEqual((await nearby({ center: { lat: 0, lng: 0 }, radius: 1 })).map((p) => p.id), ['1']);
});

test('createNearby: API errors surface Google’s message and status', async () => {
  const f = recorder(() => json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400));
  await assert.rejects(
    createNearby({ key: 'bad', types: ['bar'], includeReviews: false, fetchImpl: f })({ center: { lat: 0, lng: 0 }, radius: 1 }),
    (e) => /API key not valid/.test(e.message) && e.status === 400,
  );
});

test('createNearby: a non-JSON error body still produces a useful error', async () => {
  const f = async () => new Response('<html>Bad gateway</html>', { status: 502 });
  await assert.rejects(createNearby({ key: 'k', types: ['bar'], includeReviews: false, fetchImpl: f })({ center: { lat: 0, lng: 0 }, radius: 1 }), /Places API error 502/);
});

test('geocode: uses the viewport when present', async () => {
  const f = recorder(() => json({ places: [{ displayName: { text: 'Galway' }, location: { latitude: 53.27, longitude: -9.05 }, viewport: { low: { latitude: 53.2, longitude: -9.2 }, high: { latitude: 53.3, longitude: -8.9 } } }] }));
  const r = await geocode({ key: 'K', query: 'Galway', fetchImpl: f });
  assert.deepEqual(r, { name: 'Galway', bounds: { south: 53.2, west: -9.2, north: 53.3, east: -8.9 } });
  assert.equal(f.calls[0].url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(f.calls[0].body.textQuery, 'Galway');
});

test('geocode: falls back to a box around the point; returns null when nothing is found', async () => {
  const f = recorder((n) => (n === 1 ? json({ places: [{ location: { latitude: 10, longitude: 20 } }] }) : json({})));
  const r = await geocode({ key: 'K', query: 'Somewhere', fetchImpl: f });
  assert.equal(r.name, 'Somewhere');
  assert.ok(r.bounds.north > 10 && r.bounds.south < 10 && r.bounds.east > 20 && r.bounds.west < 20);
  assert.equal(await geocode({ key: 'K', query: 'Nowhere', fetchImpl: f }), null);
});
