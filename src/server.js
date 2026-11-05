import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { JsonCache } from './cache.js';
import { createNearby, geocode } from './places.js';
import { discoverPlaces, validateBounds } from './discover.js';
import { checkWebsite, combineWithReviews } from './guinness.js';
import { createMockNearby, mockGeocode, MOCK_SITES } from './mock.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const MAX_ACTIVE_SEARCHES = 3;

/** Run `fn` over `items` with at most `limit` in flight. Stops early if `stop()` is true. */
export async function runPool(items, limit, fn, stop = () => false) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !stop()) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const toPublic = (p, check) => ({
  id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, category: p.category,
  website: p.website, mapsUrl: p.mapsUrl, rating: p.rating, ratingCount: p.ratingCount, check,
});

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {Function} deps.nearby   ({center,radius}) => Promise<place[]>
 * @param {Function} deps.geocodeFn (query) => Promise<{name,bounds}|null>
 * @param {JsonCache} deps.cache
 * @param {object} [deps.fetchOpts] passed to safeFetch (tests inject fetchImpl)
 */
export function createApp({ config, nearby, geocodeFn, cache, fetchOpts = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use((_, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    next();
  });
  app.use(express.static(publicDir));

  if (config.mock) {
    app.get(/^\/mock-sites\/(.+)$/, (req, res) => {
      const body = MOCK_SITES[req.params[0]];
      return body ? res.type('html').send(body) : res.status(404).send('not found');
    });
  }

  app.get('/api/config', (_, res) =>
    res.json({
      browserKey: config.browserKey,
      mapId: config.mapId,
      mock: config.mock,
      defaultCenter: config.defaultCenter,
      maxSearchKm: config.maxSearchKm,
      searchEnabled: config.mock || Boolean(config.placesKey),
    }),
  );

  app.get('/api/geocode', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q || q.length > 200) return res.status(400).json({ error: 'Provide a place name (q).' });
    try {
      const hit = await geocodeFn(q);
      return hit ? res.json(hit) : res.status(404).json({ error: `Nothing found for "${q}".` });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  });

  let active = 0;
  app.post('/api/search', async (req, res) => {
    const bounds = req.body?.bounds;
    try {
      validateBounds(bounds, config.maxSearchKm);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!nearby) return res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY is not set. Add it to .env, or run `npm run mock` to try the app offline.' });
    if (active >= MAX_ACTIVE_SEARCHES) return res.status(429).json({ error: 'Too many searches running. Try again in a moment.' });

    active++;
    let closed = false;
    res.on('close', () => (closed = true));
    try {
      let found;
      try {
        found = await discoverPlaces({ bounds, nearby, maxRequests: config.maxPlacesRequests });
      } catch (err) {
        return res.status(502).json({ error: `Google Places error: ${err.message}` });
      }

      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      const send = (o) => !closed && res.write(`${JSON.stringify(o)}\n`);

      // Anything we can answer immediately (no site, cached, review hit) goes out right away.
      const pending = [];
      const initial = found.places.map((p) => {
        const cacheKey = `${p.id}|${p.website ?? ''}`;
        let site = p.website ? cache.get(cacheKey) : undefined;
        if (!p.website) site = { status: 'unknown', evidence: [], pagesChecked: 0, note: 'No website listed' };
        if (site) return toPublic(p, combineWithReviews(site, p.reviews));
        pending.push({ p, cacheKey });
        return toPublic(p, { status: 'pending' });
      });
      send({ type: 'places', places: initial, truncated: found.truncated, requests: found.requests });

      await runPool(pending, config.checkConcurrency, async ({ p, cacheKey }) => {
        const site = await checkWebsite(p.website, { fetchOpts });
        // Don't cache "unknown" - it is usually a transient failure worth retrying.
        if (site.status !== 'unknown') cache.set(cacheKey, site);
        send({ type: 'result', id: p.id, check: combineWithReviews(site, p.reviews) });
      }, () => closed);

      send({ type: 'done', total: found.places.length });
      return res.end();
    } finally {
      active--;
    }
  });

  return app;
}

function start() {
  const config = loadConfig();
  const origin = `http://127.0.0.1:${config.port}`;
  const cache = new JsonCache(config.mock ? null : path.resolve('data/website-cache.json'), config.cacheTtlDays * 864e5);

  const nearby = config.mock
    ? createMockNearby(origin)
    : config.placesKey
      ? createNearby({ key: config.placesKey, types: config.placeTypes, includeReviews: config.includeReviews })
      : null;
  const geocodeFn = config.mock ? mockGeocode : (query) => geocode({ key: config.placesKey, query });
  if (!config.mock && !config.placesKey) console.warn('! GOOGLE_PLACES_API_KEY not set - search is disabled. See .env.example, or run `npm run mock`.');
  if (!config.mock && !config.browserKey) console.warn('! GOOGLE_MAPS_BROWSER_KEY not set - the map cannot load.');

  const app = createApp({ config, nearby, geocodeFn, cache, fetchOpts: { allowPrivate: config.mock } });
  app.listen(config.port, () => console.log(`Guinness Finder ${config.mock ? '(MOCK MODE) ' : ''}on ${origin}`));
  process.on('SIGINT', () => (cache.flush(), process.exit(0)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
