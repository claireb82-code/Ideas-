# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other AI assistants when working with code in this repository.

## Project overview

**Winter Goals** — a mobile-friendly, installable (PWA) browser app for tracking goals over the winter season. No backend, no build step, no dependencies: all data lives in the browser's `localStorage`.

## Codebase structure

- `index.html` — the entire app (inline CSS + JS). Sections in the script: helpers, state, progress, render, goal actions, goal form, settings, lifecycle.
- `manifest.webmanifest` — PWA manifest (standalone display, icon).
- `icon.svg` — app icon.
- `sw.js` — network-first service worker so the app works offline once visited. Bump `CACHE` if the cached asset list changes.

## Development workflow

- Run locally: `python3 -m http.server 8000` in the repo root, then open `http://localhost:8000` (the service worker only registers over http(s), not `file://`).
- There is no build, lint, or test tooling. Verify changes in a mobile-sized viewport (e.g. 390×844) and check the console for errors.
- Deploy: any static host works (GitHub Pages, Vercel, Netlify). Serve the repo root.

## Data model

Stored under `localStorage['winter-goals-v1']` as `{ season: {start, end}, goals: [...] }` (dates are local `YYYY-MM-DD`). A goal is one of three types:

- `task` — one-off, `done: boolean`.
- `count` — `value` toward `target`, with `unit` and `step` (amount added per tap).
- `habit` — `log: { 'YYYY-MM-DD': true }` check-ins, `perWeek` target; progress is the rolling last 7 days.

Overall progress is the average of each goal's progress (0–1). If the stored shape changes, bump the storage key or migrate in `load()`.

## Conventions

- Keep it dependency-free and single-page; mobile first (44px minimum tap targets, safe-area insets, light/dark via `prefers-color-scheme`).
- Escape all user text with `esc()` before putting it in `innerHTML`.
- Feature branches and descriptive commit messages.
