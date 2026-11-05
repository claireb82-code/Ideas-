// Finds every venue inside a bounding box despite Nearby Search returning at
// most 20 places per call: query the box; if the response is "full", split the
// box into four quadrants and recurse (breadth-first, bounded by a request budget).

export const PAGE_CAP = 20;

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const centerOf = (b) => ({ lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 });

/**
 * A circle containing the whole box. The radius is the farthest of the four
 * corners: longitude degrees shrink with latitude, so the corners are not
 * equidistant from the centre.
 */
export function circleFor(b) {
  const c = centerOf(b);
  const corners = [[b.south, b.west], [b.south, b.east], [b.north, b.west], [b.north, b.east]];
  const radius = Math.max(...corners.map(([lat, lng]) => distanceM(c, { lat, lng })));
  return { center: c, radius: Math.ceil(radius) };
}

export const diagonalM = (b) => distanceM({ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east });

export const contains = (b, p) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

export function split(b) {
  const c = centerOf(b);
  return [
    { south: b.south, west: b.west, north: c.lat, east: c.lng },
    { south: b.south, west: c.lng, north: c.lat, east: b.east },
    { south: c.lat, west: b.west, north: b.north, east: c.lng },
    { south: c.lat, west: c.lng, north: b.north, east: b.east },
  ];
}

/** Throws a user-facing Error if bounds are malformed or too large. */
export function validateBounds(b, maxKm) {
  const nums = b && ['south', 'west', 'north', 'east'].every((k) => Number.isFinite(b[k]));
  if (!nums) throw new Error('bounds must have numeric south, west, north, east');
  if (b.south >= b.north || b.west >= b.east) throw new Error('bounds are empty or cross the antimeridian');
  if (b.south < -90 || b.north > 90 || b.west < -180 || b.east > 180) throw new Error('bounds out of range');
  const km = diagonalM(b) / 1000;
  if (km > maxKm) throw new Error(`Search area too large (${km.toFixed(1)} km across, max ${maxKm} km). Zoom in.`);
}

/**
 * @param {object} p
 * @param {{south,west,north,east}} p.bounds
 * @param {(circle)=>Promise<Array<{id,lat,lng}>>} p.nearby  one Nearby Search call
 * @returns {{places:Array, requests:number, truncated:boolean}}
 */
export async function discoverPlaces({ bounds, nearby, maxRequests = 40, maxDepth = 3, parallel = 4 }) {
  const found = new Map();
  let requests = 0;
  let truncated = false;
  let queue = [{ b: bounds, depth: 0 }];

  while (queue.length && requests < maxRequests) {
    const batch = queue.slice(0, Math.min(parallel, maxRequests - requests));
    queue = queue.slice(batch.length);
    requests += batch.length;
    const results = await Promise.all(batch.map((t) => nearby(circleFor(t.b))));
    results.forEach((places, i) => {
      for (const p of places) if (contains(bounds, p) && !found.has(p.id)) found.set(p.id, p);
      if (places.length >= PAGE_CAP) {
        if (batch[i].depth < maxDepth) split(batch[i].b).forEach((q) => queue.push({ b: q, depth: batch[i].depth + 1 }));
        else truncated = true;
      }
    });
  }
  if (queue.length) truncated = true; // ran out of request budget
  return { places: [...found.values()], requests, truncated };
}
