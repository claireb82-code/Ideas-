// Browser test of the real front end against the real (mock-mode) server, with google.maps stubbed.
// Run with: npm run test:e2e   (needs Playwright + Chromium; not part of `npm test`).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createApp } from '../../src/server.js';
import { JsonCache } from '../../src/cache.js';
import { loadConfig } from '../../src/config.js';
import { createMockNearby, mockGeocode } from '../../src/mock.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const stub = fs.readFileSync(new URL('./google-maps-stub.js', import.meta.url), 'utf8');

let server, origin, browser;
test.before(async () => {
  const holder = {};
  server = http.createServer((q, r, n) => holder.app(q, r, n));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  const config = { ...loadConfig({ GOOGLE_MAPS_BROWSER_KEY: 'fake-key' }, ['--mock']) };
  holder.app = createApp({ config, nearby: createMockNearby(origin), geocodeFn: mockGeocode, cache: new JsonCache(null, 1e9), fetchOpts: { allowPrivate: true } });
  browser = await chromium.launch();
});
test.after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function openPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('https://maps.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: stub }));
  await page.goto(origin);
  await page.waitForFunction(() => !document.getElementById('search').disabled);
  return { page, errors };
}

const titles = (page) => page.$$eval('.stub-marker', (n) => n.map((x) => x.dataset.title).sort());

test('search streams in venues; by default only likely-Guinness venues are pinned', async () => {
  const { page, errors } = await openPage();
  await page.click('#search');
  await page.waitForFunction(() => /Checked 8 venues/.test(document.getElementById('status').textContent));
  assert.match(await page.textContent('#status'), /3 appear to serve Guinness/);
  assert.deepEqual(await titles(page), ['The Corner House', 'The Grand Hotel', 'The Old Stand']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('pins carry a glyph as well as a colour (accessibility)', async () => {
  const { page } = await openPage();
  await page.click('#search');
  await page.waitForFunction(() => /Checked 8/.test(document.getElementById('status').textContent));
  const glyphs = await page.$$eval('.stub-marker .pin', (n) => n.map((x) => x.textContent));
  assert.ok(glyphs.every((g) => g.length > 0));
  await page.close();
});

test('enabling the "No mention" and "Unknown" chips reveals the rest', async () => {
  const { page } = await openPage();
  await page.click('#search');
  await page.waitForFunction(() => /Checked 8/.test(document.getElementById('status').textContent));
  await page.click('#status-filters button:has-text("No mention")');
  await page.click('#status-filters button:has-text("Unknown")');
  assert.equal((await titles(page)).length, 8);
  await page.close();
});

test('category and text filters narrow the list and the map', async () => {
  const { page } = await openPage();
  await page.click('#search');
  await page.waitForFunction(() => /Checked 8/.test(document.getElementById('status').textContent));
  await page.click('#category-filters button:has-text("Hotel")');
  assert.deepEqual(await titles(page), ['The Grand Hotel']);
  await page.click('#category-filters button:has-text("Hotel")');
  await page.fill('#text', 'old stand');
  assert.deepEqual(await titles(page), ['The Old Stand']);
  await page.close();
});

test('clicking a list item pans the map and opens an info window with evidence and safe links', async () => {
  const { page } = await openPage();
  await page.click('#search');
  await page.waitForFunction(() => /Checked 8/.test(document.getElementById('status').textContent));
  await page.click('.item:has-text("The Old Stand")');
  const iw = page.locator('#stub-iw');
  await iw.waitFor();
  assert.match(await iw.textContent(), /The Old Stand/);
  assert.match(await iw.textContent(), /On the menu/);
  assert.match(await iw.textContent(), /Guinness/); // evidence snippet
  const hrefs = await iw.locator('a').evaluateAll((a) => a.map((x) => x.href + '|' + x.rel));
  assert.ok(hrefs.length >= 2 && hrefs.every((h) => /noopener/.test(h)));
  assert.equal(await page.evaluate(() => window.__gm.panned), 1);
  await page.close();
});

test('clicking a map pin also opens its info window', async () => {
  const { page } = await openPage();
  await page.click('#search');
  await page.waitForFunction(() => /Checked 8/.test(document.getElementById('status').textContent));
  await page.click('.stub-marker[data-title="The Grand Hotel"]');
  assert.match(await page.locator('#stub-iw').textContent(), /Mentioned on website/);
  await page.close();
});

test('venue text from the server is never interpreted as HTML (XSS)', async () => {
  const { page, errors } = await openPage();
  await page.route('**/api/search', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body: JSON.stringify({ type: 'places', places: [{ id: 'x', name: '<img src=x onerror="window.pwned=1">Evil', address: '<b>a</b>', lat: 53.34, lng: -6.26, category: 'pub', website: 'javascript:alert(1)', check: { status: 'menu', evidence: [{ snippet: '<script>window.pwned=1</script>Guinness', url: 'javascript:alert(2)' }] } }] }) + '\n' + JSON.stringify({ type: 'done', total: 1 }) + '\n',
    }),
  );
  await page.click('#search');
  await page.waitForFunction(() => /Checked 1/.test(document.getElementById('status').textContent));
  await page.click('.item');
  await page.locator('#stub-iw').waitFor();
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('#stub-iw a').count(), 0, 'javascript: links must not be rendered');
  assert.match(await page.locator('#stub-iw h3').textContent(), /<img/); // shown as text
  assert.deepEqual(errors, []);
  await page.close();
});

test('regression: the hidden "map failed" overlay must not sit on top of a working map', async () => {
  const { page } = await openPage();
  assert.equal(await page.locator('#fatal').isVisible(), false);
  const topEl = await page.evaluate(() => {
    const r = document.getElementById('map').getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id;
  });
  assert.notEqual(topEl, 'fatal');
  await page.close();
});

test('an area larger than the server limit disables search with a zoom hint', async () => {
  const { page } = await openPage();
  await page.evaluate(() => { window.__stubBounds = { south: 50, west: -10, north: 56, east: 2 }; window.__fireIdle(); });
  assert.equal(await page.locator('#search').isDisabled(), true);
  assert.match(await page.textContent('#search'), /Zoom in/);
  await page.evaluate(() => { window.__stubBounds = { south: 53.335, west: -6.28, north: 53.355, east: -6.245 }; window.__fireIdle(); });
  assert.equal(await page.locator('#search').isDisabled(), false);
  await page.close();
});

test('a server error is shown to the user and the search button recovers', async () => {
  const { page } = await openPage();
  await page.route('**/api/search', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Google Places error: API key not valid' }) }));
  await page.click('#search');
  await page.waitForFunction(() => /API key not valid/.test(document.getElementById('status').textContent));
  assert.ok(await page.locator('#status.error').count());
  assert.equal(await page.locator('#search').isDisabled(), false);
  await page.close();
});

test('"Go" looks up a place and fits the map to it', async () => {
  const { page } = await openPage();
  await page.fill('#place', 'Dublin');
  await page.click('#geo button[type=submit]');
  await page.waitForFunction(() => window.__gm.fit);
  assert.ok((await page.evaluate(() => window.__gm.fit)).north > 0);
  await page.close();
});
