# Testing

```bash
npm test            # 75 tests, ~1 s, no network, no browser
npm run test:e2e    # 11 browser tests (Playwright + Chromium)
```

If Playwright isn't resolvable from the project: `PLAYWRIGHT_PATH=/path/to/node_modules/playwright npm run test:e2e`.

## What each file covers

| File | Covers |
|---|---|
| `test/guinness.test.js` | Detector: spelling/case variants, "World Records" false positives, link picking, every status (`menu`, `website`, `none`, `unknown`-because-JS, `unknown`-because-PDF, unreachable, broken sub-page), early stop, review merging |
| `test/safe-fetch.test.js` | Private-IP detection (v4/v6/mapped), SSRF on literal IPs, DNS results and **redirect hops**, protocol allow-list, redirect limit, content-type/HTTP errors, size cap |
| `test/discover.test.js` | Geometry, circle covers all corners, bounds validation, adaptive subdivision finds all venues, dedupe, request budget, truncation flags, overspill filtering |
| `test/places.test.js` | Request shape (key header, field mask, body, radius cap), category mapping, normalisation, closed/location-less filtering, Google error handling, geocode viewport |
| `test/cache.test.js` | Round trip, TTL expiry, persistence, corrupt-file tolerance |
| `test/server.test.js` | Real Express app: config never leaks the Places key, validation, 503/502, **full streamed search in mock mode with exact expected statuses**, payload allow-list, cache hit skips re-crawling, `unknown` not cached, worker pool |
| `test/lib.test.js` | Front-end logic: sort/filter/count, NDJSON parsing across split chunks and split multi-byte characters, event application |
| `test/e2e/ui.e2e.js` | Real front end in Chromium against the real mock-mode server: streaming into pins, filters, info windows, glyphs (not colour alone), XSS payloads, error display, "too large" hint, geocode |

## Test doubles

- `test/helpers.js` - `fakeFetch(pages)` serves in-memory HTML.
- `src/mock.js` - sample venues + sample venue websites (used by `npm run mock` and the integration tests).
- `test/e2e/google-maps-stub.js` - a tiny stand-in for `google.maps`, implementing only what `app.js` calls.

## Bugs the tests found (kept as regression tests)

1. **Search circle missed venues** - radius was measured to one corner only (`discover.js`).
2. **Words glued across elements** - `<li>Guinness</li><li>Heineken</li>` became `GuinnessHeineken`, defeating the
   word-boundary match, i.e. missed detections on real menus (`guinness.js`).
3. **Size cap not enforced within a chunk** (`safe-fetch.js`).
4. **Invisible overlay blocked the whole map** - `.fatal{display:grid}` overrode the `hidden` attribute, so
   pins/dragging would have been unclickable on the real map (`style.css`). Verified the regression test fails
   when the fix is removed.

## What is NOT covered (be honest about this)

- **Live Google APIs.** `places.js` is tested against a fake `fetch` built from the documented API shape. It has not
  been run with real keys; Google may differ (e.g. an unsupported `includedTypes` value → HTTP 400, which the UI shows).
- **Real Google Maps rendering.** The e2e tests stub `google.maps`, so they prove *our* code, not that markers look right on
  a real map or that the Map ID/key is configured correctly.
- **Real-world websites.** Detection is tested on synthetic pages. Accuracy on messy real sites (cookie walls, bot blocking,
  Wix/Squarespace menus) is unmeasured. A good next step: hand-label ~50 venues and track precision/recall.
- DNS-rebinding SSRF, robots.txt, load/performance.

## Adding tests

- New detector rule → add a page to the `pages` map in `test/guinness.test.js` and assert the status.
- Found a bug → write the failing test first, label it `regression:`.
- Keep `npm test` free of network and browser dependencies.
