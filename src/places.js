// Thin client for Google Places API (New): https://developers.google.com/maps/documentation/places/web-service
// Only the fields we need are requested (the field mask controls billing tier).
const BASE = 'https://places.googleapis.com/v1';

const NEARBY_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types',
  'places.primaryType', 'places.websiteUri', 'places.googleMapsUri', 'places.rating',
  'places.userRatingCount', 'places.businessStatus',
];

async function call(path, key, fieldMask, body, fetchImpl) {
  const res = await fetchImpl(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': fieldMask },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error?.message || `Places API error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

const CATEGORY_ORDER = ['pub', 'bar', 'restaurant', 'hotel'];

/** Map Google's type list to one of our four display categories. */
export function categorize(types = [], primaryType) {
  const has = (t) => types.includes(t) || primaryType === t;
  if (has('pub') || has('irish_pub')) return 'pub';
  if (has('bar') || has('bar_and_grill')) return 'bar';
  const primary = primaryType && CATEGORY_ORDER.find((c) => primaryType.includes(c));
  if (primary) return primary;
  if (types.some((t) => t.includes('restaurant'))) return 'restaurant';
  if (types.some((t) => t === 'hotel' || t === 'lodging' || t.endsWith('_hotel'))) return 'hotel';
  return 'restaurant';
}

/** Convert a raw Places API place into our internal shape. */
export function normalizePlace(p) {
  return {
    id: p.id,
    name: p.displayName?.text ?? 'Unnamed venue',
    address: p.formattedAddress ?? '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    category: categorize(p.types, p.primaryType),
    website: p.websiteUri,
    mapsUrl: p.googleMapsUri,
    rating: p.rating,
    ratingCount: p.userRatingCount,
    reviews: (p.reviews ?? []).map((r) => r.text?.text || r.originalText?.text || '').filter(Boolean),
    closed: p.businessStatus && p.businessStatus !== 'OPERATIONAL',
  };
}

/** @returns a `nearby({center,radius}) => Promise<place[]>` function bound to a key and config. */
export function createNearby({ key, types, includeReviews, fetchImpl = fetch }) {
  const mask = (includeReviews ? [...NEARBY_FIELDS, 'places.reviews'] : NEARBY_FIELDS).join(',');
  return async ({ center, radius }) => {
    const json = await call('/places:searchNearby', key, mask, {
      includedTypes: types,
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radius, 50000) } },
    }, fetchImpl);
    return (json.places ?? []).map(normalizePlace).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !p.closed);
  };
}

/** Resolve free text ("Galway") to a map viewport. Returns null if nothing found. */
export async function geocode({ key, query, fetchImpl = fetch }) {
  const json = await call('/places:searchText', key, 'places.displayName,places.location,places.viewport', { textQuery: query, maxResultCount: 1 }, fetchImpl);
  const p = json.places?.[0];
  if (!p) return null;
  const v = p.viewport;
  const bounds = v
    ? { south: v.low.latitude, west: v.low.longitude, north: v.high.latitude, east: v.high.longitude }
    : { south: p.location.latitude - 0.01, north: p.location.latitude + 0.01, west: p.location.longitude - 0.015, east: p.location.longitude + 0.015 };
  return { name: p.displayName?.text ?? query, bounds };
}
