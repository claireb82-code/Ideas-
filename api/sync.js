// Sync endpoint for Winter Goals.
//
//   GET  /api/sync                       -> { doc }          (doc is null if nothing stored yet)
//   POST /api/sync   body: { doc }       -> { doc }          (stored doc merged with the one sent)
//   GET  /api/sync?backups=1             -> { backups: [{date}] }   weekly restore points
//   GET  /api/sync?backup=YYYY-MM-DD     -> { doc }
//   GET  /api/sync?health=1              -> { ok }           (no code needed, read-only)
//
// The caller proves who they are with the secret sync code in the `x-sync-code`
// header (32 hex chars, generated in the browser). Only a SHA-256 of the code is
// used as the storage key, and the blob store is private.
import { createHash } from 'node:crypto';
import { get, put, list, del, BlobPreconditionFailedError } from '@vercel/blob';
import { clean, mergeDocs } from './_merge.js';

const CODE_RE = /^[0-9a-f]{32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BYTES = 512 * 1024;
const BACKUP_EVERY_DAYS = 7;   // a restore point is saved at the first change after this many days
const BACKUP_KEEP = 8;         // ...and the newest 8 are kept (about two months)

const sha = (code) => createHash('sha256').update(code).digest('hex');
const pathFor = (code) => `sync/${sha(code)}.json`;
const backupPrefix = (code) => `backups/${sha(code)}/`;

// Restore points, newest first: [{ date: 'YYYY-MM-DD', pathname }]
async function listBackups(code) {
  const prefix = backupPrefix(code);
  const { blobs } = await list({ prefix, limit: 100 });
  return blobs
    .map((b) => ({ date: b.pathname.slice(prefix.length).replace(/\.json$/, ''), pathname: b.pathname }))
    .filter((b) => DATE_RE.test(b.date))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Called after a change has been saved. `previousText` is the document as it was
// *before* that change, so a restore point is a state you can go back to if the change
// turns out to be a mistake. Never lets a backup problem break a sync.
async function maybeBackup(code, previousText) {
  try {
    if (!previousText) return;
    const backups = await listBackups(code);
    const today = new Date().toISOString().slice(0, 10);
    if (backups.length) {
      const ageDays = (Date.parse(today) - Date.parse(backups[0].date)) / 86400000;
      if (ageDays < BACKUP_EVERY_DAYS) return;
    }
    await put(`${backupPrefix(code)}${today}.json`, previousText, {
      access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
    });
    const stale = backups.filter((b) => b.date !== today).slice(BACKUP_KEEP - 1);
    if (stale.length) await del(stale.map((b) => b.pathname));
  } catch (e) {
    console.error('backup failed', e);
  }
}

async function readDoc(path) {
  const res = await get(path, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return { text: null, etag: null };
  const text = await new Response(res.stream).text();
  return { text, etag: res.blob.etag };
}

const parse = (text) => {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Read-only health check (GET /api/sync?health=1): confirms the function runs and can
  // reach the Blob store. Touches no user data and needs no code.
  if (req.method === 'GET' && req.query && req.query.health !== undefined) {
    try {
      await get('sync/_health', { access: 'private', useCache: false });
      return res.status(200).json({ ok: true, store: 'reachable' });
    } catch (e) {
      console.error('health check failed', e);
      return res.status(500).json({ ok: false, store: 'unreachable' });
    }
  }

  const code = String(req.headers['x-sync-code'] || '').toLowerCase();
  if (!CODE_RE.test(code)) return res.status(401).json({ error: 'Invalid sync code' });
  const path = pathFor(code);

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.backups !== undefined) {
        const backups = await listBackups(code);
        return res.status(200).json({ backups: backups.map((b) => ({ date: b.date })) });
      }
      if (q.backup !== undefined) {
        const date = String(q.backup);
        if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Bad date' });
        const { text } = await readDoc(`${backupPrefix(code)}${date}.json`);
        if (!text) return res.status(404).json({ error: 'No such restore point' });
        return res.status(200).json({ doc: parse(text) });
      }
      const { text } = await readDoc(path);
      return res.status(200).json({ doc: parse(text) });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = parse(body);
      const incoming = body && body.doc;
      if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'Missing doc' });
      if (JSON.stringify(incoming).length > MAX_BYTES) return res.status(413).json({ error: 'Too large' });

      // Read-merge-write with an ETag precondition, so two devices syncing at the
      // same moment can't silently overwrite each other; retry on conflict.
      for (let attempt = 0; attempt < 5; attempt++) {
        const { text, etag } = await readDoc(path);
        const existing = parse(text);
        const merged = mergeDocs(existing, incoming);
        const out = JSON.stringify(merged);
        if (text && JSON.stringify(clean(existing)) === out) return res.status(200).json({ doc: merged });
        try {
          await put(path, out, {
            access: 'private',
            contentType: 'application/json',
            addRandomSuffix: false,
            ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
          });
          await maybeBackup(code, text);
          return res.status(200).json({ doc: merged });
        } catch (e) {
          const conflict = e instanceof BlobPreconditionFailedError || /already exists/i.test(String(e && e.message));
          if (!conflict) throw e;
        }
      }
      return res.status(409).json({ error: 'Busy, try again' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('sync error', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
