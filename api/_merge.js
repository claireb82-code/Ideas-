// Pure merge logic for synced Winter Goals documents (no I/O, so it is easy to test).
//
// A document looks like:
//   { v: 1, season: {start, end}, seasonUpdated: ms,
//     goals: [{ id, updated: ms, ... }], deleted: { [goalId]: ms } }
//
// Rules: for each goal id the version with the newest `updated` wins; a deletion
// (tombstone) beats a goal that was last edited before it; the season setting with
// the newest `seasonUpdated` wins.

const MAX_GOALS = 300;
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function clean(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const goals = [];
  const seen = new Set();
  for (const g of Array.isArray(d.goals) ? d.goals : []) {
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !g.id || g.id.length > 64) continue;
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    goals.push({ ...g, updated: Number(g.updated) || 0 });
    if (goals.length >= MAX_GOALS) break;
  }
  const deleted = {};
  if (d.deleted && typeof d.deleted === 'object') {
    for (const [id, t] of Object.entries(d.deleted)) {
      if (id.length <= 64 && Number.isFinite(Number(t))) deleted[id] = Number(t);
    }
  }
  const s = d.season;
  const season = s && KEY_RE.test(s.start) && KEY_RE.test(s.end) && s.start <= s.end ? { start: s.start, end: s.end } : null;
  return { v: 1, season, seasonUpdated: Number(d.seasonUpdated) || 0, goals, deleted };
}

export function mergeDocs(a, b) {
  a = clean(a);
  b = clean(b);

  const deleted = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] || 0, t);

  const byId = new Map();
  for (const g of [...a.goals, ...b.goals]) {
    const cur = byId.get(g.id);
    if (!cur || g.updated > cur.updated) byId.set(g.id, g);
  }
  const goals = [];
  for (const g of byId.values()) {
    if (g.id in deleted && deleted[g.id] >= g.updated) continue;
    goals.push(g);
  }

  const pickB = b.seasonUpdated > a.seasonUpdated || !a.season;
  const season = (pickB ? b.season : a.season) || a.season || b.season;
  const seasonUpdated = Math.max(a.seasonUpdated, b.seasonUpdated);

  return { v: 1, season, seasonUpdated, goals: goals.slice(0, MAX_GOALS), deleted };
}
