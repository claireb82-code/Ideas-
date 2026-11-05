# Guinness Finder

Find hotels, bars, pubs and restaurants on Google Maps, check whether their websites
mention **Guinness**, and show the results as colour-coded pins on a map.

```
Pan/zoom the map → "Search this area" → venues appear → pins turn green/teal/amber
as each venue's website is read.
```

| Pin | Meaning |
|---|---|
| ✓ green | **On the menu** - found on a menu/drinks page of the venue's site |
| ✓ teal | **Mentioned on website** - found elsewhere on the site |
| “ amber | **Mentioned in reviews** - a Google review mentions it (weaker evidence) |
| – grey | **No mention found** - site was readable; *not proof they don't serve it* |
| ? light grey | **Couldn't check** - no website, site down, JavaScript-only page, or PDF/image menu |

By default only the first three (plus "checking") are shown; the chips in the sidebar toggle the rest.

## Quick start

Requires Node.js 22+.

```bash
npm install
npm run mock        # offline demo with sample Dublin venues (still needs a browser key to draw the map)
```

### With real Google data

1. In [Google Cloud](https://console.cloud.google.com/), create a project with billing and enable
   **Places API (New)** and **Maps JavaScript API**.
2. Create **two** API keys (see *Why two keys?* below):
   - **Server key** - restrict to the *Places API (New)* and to your server's IP.
   - **Browser key** - restrict to the *Maps JavaScript API* and to HTTP referrer `http://localhost:3000/*`
     (plus your real domain when deployed).
3. Configure and run:

```bash
cp .env.example .env     # then paste the two keys into .env
npm start                # http://localhost:3000
```

Search is capped by `MAX_SEARCH_KM` (default 10 km across) and `MAX_PLACES_REQUESTS` (default 40
Places calls per search) so one click can't produce a surprise bill. Set a **budget alert** in
Google Cloud as well.

> **Status:** everything except the live Google calls has been run and tested (see
> [docs/TESTING.md](docs/TESTING.md)). The Google request/response handling is tested against a fake
> `fetch`, but has **not yet been run against the real API** - the first real search is the real test.
> If Google rejects a request (e.g. a place type name), the error is shown in the UI's status line.

### Why two keys?

The Maps JavaScript key is sent to every visitor's browser, so it must be locked to your website's
referrer. The Places key is used by the server and must *not* be referrer-restricted (server calls have
no referrer) - and must never reach the browser. `GOOGLE_MAPS_API_KEY` can be used as a single
fallback for both in local experiments, but don't deploy that way.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server (real Google data) |
| `npm run mock` | Run with sample data and local fake venue websites - no Places key/billing needed |
| `npm run dev` | Run with auto-restart on file changes |
| `npm test` | Unit + integration tests (no network, no browser) |
| `npm run test:e2e` | Browser UI tests (needs Playwright + Chromium; set `PLAYWRIGHT_PATH` if it isn't resolvable) |

## How it works (short version)

1. **Discover** - Nearby Search returns at most 20 places per call, so the visible map box is split
   into quadrants recursively until no tile is "full" (bounded by `MAX_PLACES_REQUESTS`).
2. **Check** - for each venue the server fetches its website, follows up to 4 menu/drinks-looking links,
   and looks for "Guinness" in the visible text. Results are cached on disk for 14 days.
3. **Stream** - results are sent to the browser as newline-delimited JSON so pins update live.

Details, trade-offs and the API contract: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Known limitations

- **Google has no menu data.** Detection depends on the venue's own website. Many pubs only post menus
  as PDFs/images, on Facebook/Instagram, or on JavaScript-only sites - those show as **Couldn't check**.
  That is deliberate: we don't say "no" when we simply couldn't read it.
- **"Guinness" on the menu ≠ guaranteed on tap today.** Treat results as a shortlist.
- Google Places terms require Places data to be shown on a Google map and limit how long it can be
  stored. This app only caches *its own* check result keyed by place ID, never Google's content.
- The crawler identifies itself (`GuinnessFinderBot`), fetches only a handful of pages per venue,
  but does **not yet honour robots.txt**. Add that before running it at scale.

Ideas for next steps are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap).
