# CLAUDE.md

Guidance for Claude Code and other AI assistants working in this repository.

## What this is

**Guinness Finder** - finds hotels/bars/pubs/restaurants via Google Places, checks each venue's
website (and Google reviews) for mentions of Guinness, and shows colour-coded pins on a Google Map.
Start with `README.md`; design decisions and the API contract are in `docs/ARCHITECTURE.md`; test
strategy and known gaps are in `docs/TESTING.md`.

## Commands

```bash
npm install
npm test             # unit + integration, no network/browser (must stay that way)
npm run test:e2e     # Chromium UI tests; set PLAYWRIGHT_PATH if playwright isn't resolvable
npm run mock         # run offline with sample data - no Google Places key needed
npm start            # real data; needs .env (see .env.example)
```

Node 22+. ES modules. Only runtime deps: `express`, `cheerio`.

## Layout

- `src/` server: `server.js` (createApp factory), `places.js` (Google client), `discover.js` (tiling),
  `guinness.js` (crawler/detector), `safe-fetch.js` (SSRF-safe fetch), `cache.js`, `mock.js`, `config.js`
- `public/` browser UI: `app.js` (Maps/DOM glue), `lib.js` (pure helpers, unit-tested), `style.css`
- `test/` node:test suites; `test/e2e/` Playwright UI tests with a stubbed `google.maps`

## Conventions and rules

- **Document and test as you go.** Every behaviour change needs a test; a bug fix needs a failing
  `regression:` test first. Update `docs/` when behaviour, API, statuses or config change.
- **Honest statuses.** Never report "no" when we merely couldn't read a site - use `unknown`. Keep the
  five-status model (`menu`, `website`, `reviews`, `none`, `unknown`) + transient `pending`.
- **Untrusted data.** Venue names/snippets/URLs come from third parties. In the UI use `textContent`
  and only http(s) links - never `innerHTML` with external data. Server fetches of venue sites must go
  through `safeFetch` (SSRF protection).
- **Keys.** The Places key is server-only. `/api/config` may expose only the browser key.
- **Cost guards** (`MAX_SEARCH_KM`, `MAX_PLACES_REQUESTS`, concurrency cap, cache) exist to avoid
  surprise Google bills - don't remove them casually.
- Google terms: Places data must be shown on a Google map; cache only our own derived results (keyed by
  place ID), not Google content.
- `hidden` elements: keep the `[hidden]{display:none!important}` rule in `style.css` (a past bug).
- Use feature branches and descriptive commit messages.

## Known gaps

Live Google API calls have not been run against real keys (only fake-fetch tests); PDF/image menus are not
read; robots.txt is not honoured. See `docs/TESTING.md` and the roadmap in `docs/ARCHITECTURE.md`.
