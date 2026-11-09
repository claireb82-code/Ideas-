# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other AI assistants when working with code in this repository.

## Project overview

**Winter Goals** — a mobile-friendly, installable (PWA) browser app for tracking goals over the winter season. The UI is a single static page. Goals live in the browser's `localStorage`; optional cross-device sync goes through one Vercel serverless function backed by a private Vercel Blob store.

Hosted on Vercel (team `claireb82`, project `winter-goals`, production branch `main`, https://winter-goals.vercel.app). Every push to `main` auto-deploys.

## Codebase structure

- `index.html` — the entire front end (inline CSS + JS). Script sections: helpers, state (normalisation, save), progress, render, goal actions, goal form, settings, sync, lifecycle.
- `api/sync.js` — Vercel Node function: `GET`/`POST /api/sync`. Reads/writes one JSON blob per sync code, merging on write with an ETag (`ifMatch`) retry loop.
- `api/_merge.js` — pure merge logic (no I/O). The leading underscore keeps Vercel from exposing it as a route.
- `package.json` — only dependency is `@vercel/blob` (pinned); `"type": "module"`.
- `manifest.webmanifest`, `icon.svg` — PWA manifest and icon.
- `sw.js` — network-first service worker (offline support). Never caches `/api/`.

## Development workflow

- Static UI only: `python3 -m http.server 8000`, open `http://localhost:8000`. `/api/sync` doesn't exist there, so sync will show "Couldn't reach the server"; everything else works. (The service worker registers only over http(s), not `file://`.)
- Full stack locally: `npx vercel dev` (needs `vercel link` and `vercel env pull` for `BLOB_READ_WRITE_TOKEN`).
- No build step, lint or test runner. To test sync without a backend, mock `**/api/sync` in Playwright using `mergeDocs` from `api/_merge.js` (this is how it was verified with two simulated devices). Check a mobile viewport (390×844) and the console.
- Deploy: push to `main`. Vercel env var `BLOB_READ_WRITE_TOKEN` comes from the Blob store `winter-goals-sync` (private, iad1) connected to the project.

## Data model

Local state is stored under `localStorage['winter-goals-v1']`:
`{ season: {start, end}, seasonUpdated, goals: [...], deleted: { [goalId]: ms } }` (dates are local `YYYY-MM-DD`; times are epoch ms).

A goal has `id`, `title`, `type`, `emoji`, `created`, `updated` plus the type's fields:

- `task` — `done`.
- `count` — `value` toward `target`, with `unit` and `step` (amount added per tap).
- `habit` — `log: { 'YYYY-MM-DD': true }` check-ins and a `perWeek` target; progress is the rolling last 7 days.

Overall progress is the average of each goal's progress (0–1). All data entering the app (storage, import, sync) goes through `normState`/`normGoal`, which coerces and bounds every field. If the shape changes, extend those and bump the storage key or migrate in `load()`.

## Sync design

- Opt-in. A device generates a random 128-bit hex **sync code** (stored in `localStorage['winter-goals-sync']`); other devices join by pasting the code or opening `…/#sync=CODE` (the fragment is never sent to the server). The code is the only credential: it goes in the `x-sync-code` header, and the server stores data at `sync/<sha256(code)>.json` in a private blob.
- Each sync POSTs the device's full document; the server merges it with what it holds and returns the result, which the client adopts (unless the user changed something mid-request, in which case it syncs again).
- Merge rules (`api/_merge.js`): per goal id, newest `updated` wins; deletions are tombstones in `deleted` and beat older edits; newest `seasonUpdated` wins for the season. So **every mutation must call `touch(goal)` (or set a tombstone) and then `save()`**; otherwise the change won't win a merge.
- Sync runs on load, ~1s after changes, when the tab regains focus, when back online, and every 60s while visible.
- **Weekly restore points** (`maybeBackup` in `api/sync.js`): the first time the stored document changes at least 7 days after the newest restore point, the server saves the document *as it was before that change* to `backups/<sha256(code)>/YYYY-MM-DD.json` and keeps the newest 8. There's no cron job or secret; it's driven by sync writes, so nothing is saved while nothing changes. Failures are logged and never break a sync. The app lists and restores them via `GET /api/sync?backups=1` and `?backup=DATE` (Settings → "Restore an earlier version"); a restore goes through `replaceAll`, so it propagates to every device.
- `GET /api/sync?health=1` is a read-only, code-free check that the function runs and the Blob store is reachable.
- Testing the API: the server logic can be tested by copying `api/` next to an in-memory stub of `@vercel/blob` (get/put/list/del with etags) and faking `Date` to simulate weeks passing.
- Known limit: conflict resolution is per goal, so two devices editing the *same goal* offline at the same time keep only the newer edit.

## Conventions

- Keep the front end dependency-free and a single page; mobile first (44px minimum tap targets, safe-area insets, light/dark via `prefers-color-scheme`).
- Escape all user text with `esc()` before putting it in `innerHTML`.
- Feature branches and descriptive commit messages.
