// Pure, DOM-free helpers shared by the UI and unit tests.

/** Display metadata per check status. `rank` drives sorting (lower = better). */
export const STATUS = {
  menu: { label: 'On the menu', short: 'Menu', glyph: '✓', rank: 0, help: 'Guinness found on a menu or drinks page of the venue’s website.' },
  website: { label: 'Mentioned on website', short: 'Website', glyph: '✓', rank: 1, help: 'Guinness is mentioned on the venue’s website, but not on a recognisable menu page.' },
  reviews: { label: 'Mentioned in reviews', short: 'Reviews', glyph: '“', rank: 2, help: 'A Google review mentions Guinness. Weaker evidence than the venue’s own site.' },
  none: { label: 'No mention found', short: 'No mention', glyph: '–', rank: 3, help: 'The website was readable but never mentions Guinness. They may still serve it.' },
  unknown: { label: 'Couldn’t check', short: 'Unknown', glyph: '?', rank: 4, help: 'No website, site unreachable, JavaScript-only page or PDF/image menu.' },
  pending: { label: 'Checking…', short: 'Checking', glyph: '…', rank: 5, help: 'Still reading this venue’s website.' },
};

export const CATEGORY = { pub: 'Pub', bar: 'Bar', restaurant: 'Restaurant', hotel: 'Hotel' };

/** Statuses visible by default: venues that probably serve Guinness, plus ones still loading. */
export const DEFAULT_STATUSES = ['menu', 'website', 'reviews', 'pending'];

export const statusOf = (p) => (STATUS[p.check?.status] ? p.check.status : 'unknown');

export function sortPlaces(places) {
  return [...places].sort(
    (a, b) =>
      STATUS[statusOf(a)].rank - STATUS[statusOf(b)].rank ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

/** @param {{statuses:Set<string>, categories:Set<string>, text:string}} f  empty categories = all */
export function filterPlaces(places, { statuses, categories = new Set(), text = '' }) {
  const q = text.trim().toLowerCase();
  return places.filter(
    (p) =>
      statuses.has(statusOf(p)) &&
      (categories.size === 0 || categories.has(p.category)) &&
      (!q || p.name.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q)),
  );
}

export function countByStatus(places) {
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
  for (const p of places) counts[statusOf(p)]++;
  return counts;
}

const R = 6371.0088;
/** Great-circle diagonal of a {south,west,north,east} box in km. */
export function diagonalKm({ south, west, north, east }) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(north - south) / 2) ** 2 + Math.cos(rad(south)) * Math.cos(rad(north)) * Math.sin(rad(east - west) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Parse a streamed NDJSON body into objects, tolerating chunks split anywhere (even mid-character). */
export async function* readNdjson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
    if (done) break;
  }
  if (buf.trim()) yield JSON.parse(buf);
}

/** Apply a streamed event to the places map; returns the same map. */
export function applyEvent(byId, ev) {
  if (ev.type === 'places') {
    byId.clear();
    for (const p of ev.places) byId.set(p.id, p);
  } else if (ev.type === 'result') {
    const p = byId.get(ev.id);
    if (p) p.check = ev.check;
  }
  return byId;
}
