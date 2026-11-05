// Central configuration. Reads .env (if present) and process.env.
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // No .env file - fine, rely on the real environment.
}

const int = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

export function loadConfig(env = process.env, argv = process.argv) {
  const mock = argv.includes('--mock') || env.MOCK === '1';
  const sharedKey = env.GOOGLE_MAPS_API_KEY || '';
  return {
    mock,
    port: int(env.PORT, 3000),
    placesKey: env.GOOGLE_PLACES_API_KEY || sharedKey,
    browserKey: env.GOOGLE_MAPS_BROWSER_KEY || sharedKey,
    mapId: env.GOOGLE_MAP_ID || 'DEMO_MAP_ID',
    maxSearchKm: int(env.MAX_SEARCH_KM, 10),
    maxPlacesRequests: int(env.MAX_PLACES_REQUESTS, 40),
    checkConcurrency: int(env.CHECK_CONCURRENCY, 6),
    cacheTtlDays: int(env.CACHE_TTL_DAYS, 14),
    placeTypes: list(env.PLACE_TYPES, ['bar', 'pub', 'restaurant', 'hotel']),
    includeReviews: (env.INCLUDE_REVIEWS ?? 'true') !== 'false',
    defaultCenter: { lat: 53.3455, lng: -6.264 }, // Dublin (home of Guinness)
  };
}
