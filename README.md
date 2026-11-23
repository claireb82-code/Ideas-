# ❄️ Winter Goals

A mobile-friendly web app for tracking your goals over the winter season: one-off goals, counters, habits, and a weekly routine that starts fresh every Monday. It installs to your phone's home screen, works offline, and can sync between your phone and laptop.

**Live app:** https://winter-goals.vercel.app

## What it does

**Winter goals** (the progress ring at the top covers these)

| Type | Good for | Example |
| --- | --- | --- |
| **One-off** | Something you do once | Try a winter sport |
| **Counter** | Reaching a number, with a +/− step you choose | Read 6 books, 100 miles |
| **Habit** | Ticking off specific days, with a streak | Get outside 5× a week |

**Every week** (its own section above the winter goals)

- Standing routine items such as **Strength session**, **Zwift** and **Swim** that reset every Monday (weeks run Monday–Sunday).
- Each can be once a week or several times a week. Tap to tick off a session, tap again to undo.
- A 🔥 week streak and a strip of the last 8 weeks on every card.

**Season history** (the 📅 button under the weekly goals)

- A grid with one row per week of the season and one column per weekly goal, plus a 🏆 **All** column showing whether you hit every goal that week.
- ✓ hit · **1/2** partly there · ✕ missed · ○ this week so far · a faint dot for weeks still to come.
- Hit rate and best streak for each goal at the top.
- **Tap any past week to fix it** (each tap adds a session), and use **↑ Earlier weeks** to go back and fill in weeks from before you started using the app.

**Season dates** default to 1 Dec – 20 Mar and can be changed in Settings (⚙︎).

## Installing it on your phone

Open the live link, then:

- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home screen**

It then opens full-screen like a regular app and keeps working without a connection after the first visit.

## Syncing your phone and laptop

Sync is optional and off by default. Without it, your goals are saved only in the browser on that device.

1. On the first device, open **Settings → Turn on sync**. This creates a private **sync code**.
2. Tap **Share link** and open it on your other device (or paste the code under **I already have a sync code**). Goals already on that device are merged in.
3. After that it's automatic: changes sync within a second or two, whenever you come back to the app, and when you reconnect after being offline.

How changes are combined: each goal syncs on its own and the newest edit wins. Deleting a goal deletes it everywhere. If you edit the *same* goal on two devices while both are offline, only the newer edit is kept.

**Keep your sync code private.** It is the only thing protecting your synced data: anyone who has it can read and change your goals. Your goals are stored in a private cloud store under a hash of the code, and the shared link carries the code after a `#`, which browsers don't send to the server.

## Backups and restoring

- **Weekly restore points:** with sync on, the first time your goals change each week the server saves a copy of how they were just before that change, and keeps the latest 8 (about two months). Restore one from **Settings → Restore an earlier version**. A restore replaces your goals on all synced devices.
- **Your own copy:** **Settings → Export backup** downloads a JSON file, and **Import backup** loads one back. Worth doing now and then, since it doesn't depend on the cloud store or your sync code.

## Good to know

- Everything runs in the browser, so there's no account or login.
- The weekly routine (Strength session, Zwift, Swim) is added once on first use. Rename, change or delete the items any time; deleted ones stay deleted.
- Weeks before you added a goal don't count against it in the history, unless you log something in them.
- The current week only counts as a hit once you've reached the target; it's never shown as missed while it's still going.

## For developers

Plain HTML, CSS and JavaScript with no build step. The only server code is one small Vercel function used for sync.

```
index.html              the whole front end (inline CSS + JS)
api/sync.js             sync endpoint: merge, weekly restore points, health check
api/_merge.js           pure merge logic (no I/O)
sw.js                   network-first service worker (offline support)
manifest.webmanifest    PWA manifest
icon.svg                app icon
package.json            one dependency: @vercel/blob
CLAUDE.md               detailed notes on the data model, sync design and testing
```

**Run it locally**

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. The app works fully except sync, which needs the `/api/sync` function. To run everything, use `npx vercel dev` (after `vercel link` and `vercel env pull`).

**Deploy:** the repo is connected to a Vercel project and every push to `main` deploys automatically. Sync needs a private Vercel Blob store connected to the project, which provides the `BLOB_READ_WRITE_TOKEN` environment variable.

**Health check:** `GET /api/sync?health=1` confirms the function is running and can reach the store. It needs no sync code and touches no user data.

See [`CLAUDE.md`](CLAUDE.md) for the data model, the merge rules, and how the sync and restore logic is tested.
