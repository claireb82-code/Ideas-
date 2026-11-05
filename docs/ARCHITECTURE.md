# Architecture

## Goal

Given a map area, list every hotel / bar / pub / restaurant in it and say whether it serves Guinness,
displayed on a Google Map.

## The central design decision: where does "serves Guinness" come from?

Google's Places API has **no menu data** (it has `servesBeer`, which doesn't say *which* beer). So:

| Option | Verdict |
|---|---|
| Fetch the venue's own website (`websiteUri` from Places) and search the text | **Chosen.** Cheap, accurate when it hits, runs without paid third-party services. |
| Search Google reviews/photos text for "Guinness" | **Chosen as a secondary, weaker signal** (`reviews` status). |
| Scrape Google Maps pages / search results | Rejected - against Google's terms and brittle. |
| Menu aggregator APIs (Yelp, Foursquare, delivery platforms) | Possible future signal; needs extra accounts and venue matching. |
| OCR/LLM over menu PDFs and photos | Roadmap - the biggest accuracy gap today. |

Because detection is heuristic, every result carries a **status and evidence** instead of a boolean, and
the UI is explicit that "no mention" is not "doesn't serve".

## Components

```
public/            Browser UI (no build step, ES modules)
  index.html, style.css
  app.js           Google Maps + DOM glue (not unit-testable without a browser)
  lib.js           Pure helpers: status metadata, sort/filter, NDJSON reader  → test/lib.test.js
src/
  server.js        Express app factory createApp(); /api/config, /api/geocode, /api/search
  places.js        Google Places API (New) client: searchNearby, searchText, normalisation
  discover.js      Adaptive tiling so >20 venues per area can be found
  guinness.js      Website crawler + Guinness detector + review merge
  safe-fetch.js    SSRF-safe, size/time-bounded fetch used for venue sites
  cache.js         JSON-file cache of check results (TTL)
  mock.js          Offline venues + fake venue websites (npm run mock)
  config.js        Env/.env parsing
```

### Data flow of one search

```
browser ──POST /api/search {bounds}──▶ server
  1. validateBounds (size cap)
  2. discoverPlaces ──▶ Places Nearby Search × N   (adaptive quadrant split, ≤ MAX_PLACES_REQUESTS)
  3. emit {"type":"places", places:[…]}            venues with no site / cached result are already answered
  4. for each uncached venue (CHECK_CONCURRENCY at a time):
       checkWebsite() → emit {"type":"result", id, check}
  5. emit {"type":"done"}
```

The response is `application/x-ndjson`; each line is one JSON event. If the browser disconnects (or starts
a new search), the server stops scheduling further website checks.

### Discovery: beating the 20-result cap

`searchNearby` returns ≤ 20 places and has no pagination. `discoverPlaces` queries a circle that covers the
box; if the answer is "full" (20) it splits the box into 4 quadrants and repeats (breadth-first, max depth 3,
`MAX_PLACES_REQUESTS` budget, 4 calls in parallel). Places outside the original box are dropped; duplicates
are merged by place ID. If the budget or depth runs out while tiles are still full, `truncated: true` is sent
and the UI tells the user to zoom in. (The circle radius is the farthest of the four corners - a bug found
by `test/discover.test.js`, where using one corner missed venues at high latitudes.)

### Detection: `checkWebsite`

1. Fetch the home page (HTML only, ≤ 1.5 MB, 8 s timeout, ≤ 3 redirects).
2. Extract visible text (scripts/styles removed, elements separated by spaces).
3. Follow up to 4 **same-site** links whose URL/label looks like menu/drinks/food/bar pages
   (menu-looking URLs first). PDFs/images are *counted*, not read.
4. Search each page for `Guinness`/`Guiness` (not "Guinness World Records").

| Status | Rule |
|---|---|
| `menu` | match on a page whose URL looks like a menu/drinks page |
| `website` | match elsewhere on the site |
| `reviews` | no website match, but a Google review mentions it (applied at response time, not cached) |
| `none` | ≥ 1 page with real text, no match, and no unread PDF menu |
| `unknown` | no website / fetch failed / < 200 chars of text (JS app) / PDF-or-image menu only |

`unknown` is **not cached** (usually transient). Everything else is cached for `CACHE_TTL_DAYS`, keyed by
`placeId|website`.

## Security notes

- **SSRF:** the server fetches URLs that come from third-party data. `safe-fetch.js` allows only http(s),
  resolves the host and rejects private/loopback/link-local/CGNAT addresses, and re-checks every redirect hop.
  (Residual risk: DNS rebinding between the check and the connect. Mitigate with an egress proxy if deployed
  publicly.) `--mock` mode is the only place private hosts are allowed.
- **XSS:** venue names, addresses and website snippets are untrusted. The UI builds DOM with `textContent`
  only, and only renders links whose scheme is http(s). Covered by an e2e test.
- **Keys:** the Places key never leaves the server (`/api/config` only exposes the browser key; tested).
- **Cost control:** bounded search area, bounded Places calls per search, max 3 concurrent searches, cache.

## API contract

`GET /api/config` → `{ browserKey, mapId, mock, defaultCenter, maxSearchKm, searchEnabled }`

`GET /api/geocode?q=Galway` → `{ name, bounds }` | 404/400/502 `{ error }`

`POST /api/search` body `{ bounds: {south,west,north,east} }`
- 400 invalid/too large, 429 too many searches, 502 Places failure, 503 no Places key - all `{ error }`
- 200 NDJSON events:
  - `{type:"places", places:[Place], truncated, requests}`
  - `{type:"result", id, check}`
  - `{type:"done", total}`
- `Place`: `{ id, name, address, lat, lng, category: pub|bar|restaurant|hotel, website?, mapsUrl?, rating?, ratingCount?, check }`
- `check`: `{ status, evidence:[{url, snippet, menuPage}], pagesChecked, note }`

## Decisions log

| Decision | Why |
|---|---|
| Plain Node + Express, vanilla ES-module front end, no bundler | Small surface, runs anywhere, nothing to build. |
| Only deps: `express`, `cheerio` | HTML parsing is the one thing not worth hand-rolling. |
| JSON-file cache instead of SQLite | No native build step; fine at this scale. Swap `cache.js` for a DB when needed. |
| NDJSON streaming rather than WebSockets/SSE | Works with plain `fetch` POST; trivial to test. |
| `AdvancedMarkerElement` (needs a Map ID) | Classic `Marker` is deprecated; DOM pins let us use glyph + colour. |
| Google Map (not Leaflet/OSM) | Places terms require Places data to be shown on a Google map. |
| Default filter hides `none`/`unknown` | The point is to find Guinness; the rest is one click away. |

## Roadmap

1. **PDF + image menus** (largest source of `unknown`): add PDF text extraction; OCR/vision for images.
2. honour **robots.txt** and per-host politeness before any large-scale crawling.
3. Look-ups for venues whose "website" is a Facebook/Instagram page.
4. Distinguish *on draught* vs *bottled/cans*, and extract price.
5. Persist searches/results in a database; scheduled refresh; shareable links.
6. Headless-browser fallback for JavaScript-rendered sites (costly - opt in).
7. Run an egress proxy and rate-limit per client before exposing publicly.
