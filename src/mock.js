// Offline mock backend (`npm run mock`). Lets you exercise the whole pipeline -
// discovery, website crawling, caching, streaming - with no Google keys.
// Venue websites are served by our own server under /mock-sites/.
import { distanceM, PAGE_CAP } from './discover.js';

const lorem = 'Welcome to our family run venue serving the local community with warm hospitality every day of the week. '.repeat(3);
const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${lorem}</p>${body}</body></html>`;

export const MOCK_SITES = {
  'old-stand/index.html': html('The Old Stand', '<a href="/mock-sites/old-stand/drinks.html">Drinks</a>'),
  'old-stand/drinks.html': html('Drinks', '<ul><li>Guinness</li><li>Smithwicks</li><li>Heineken</li></ul>'),
  'grand-hotel/index.html': html('The Grand Hotel', '<p>Relax in our lounge with a creamy pint of Guinness.</p>'),
  'pasta-place/index.html': html('Pasta Place', '<a href="/mock-sites/pasta-place/menu.html">Menu</a>'),
  'pasta-place/menu.html': html('Menu', '<ul><li>Carbonara</li><li>Margherita</li><li>Tiramisu</li></ul>'),
  'spa-bar/index.html': '<!doctype html><html><head><title>Spa Bar</title></head><body><div id="root"></div></body></html>',
  'pdf-grill/index.html': html('PDF Grill', '<a href="/mock-sites/pdf-grill/menu.pdf">Download our menu</a>'),
};

const v = (id, name, category, lat, lng, extra = {}) => ({ id, name, category, lat, lng, address: `${name}, Dublin`, rating: 4.3, ratingCount: 120, ...extra });
const site = (slug, origin) => `${origin}/mock-sites/${slug}/index.html`;

export function mockVenues(origin) {
  return [
    v('m1', 'The Old Stand', 'pub', 53.3411, -6.2627, { website: site('old-stand', origin) }),
    v('m2', 'The Grand Hotel', 'hotel', 53.3478, -6.2597, { website: site('grand-hotel', origin) }),
    v('m3', 'Pasta Place', 'restaurant', 53.3441, -6.2675, { website: site('pasta-place', origin) }),
    v('m4', 'Spa Bar', 'bar', 53.3459, -6.2631, { website: site('spa-bar', origin) }),
    v('m5', 'PDF Grill', 'restaurant', 53.3425, -6.2588, { website: site('pdf-grill', origin) }),
    v('m6', 'The Corner House', 'pub', 53.3492, -6.2712, { reviews: ['Cosy spot, best pint of Guinness on this side of town.'] }),
    v('m7', 'Harbour Rooms', 'hotel', 53.3463, -6.2549),
    v('m8', 'Broken Link Bistro', 'restaurant', 53.3402, -6.2701, { website: `${origin}/mock-sites/does-not-exist/index.html` }),
  ];
}

/** Same contract as createNearby(): radius filter, nearest first, 20-result cap. */
export function createMockNearby(origin) {
  const venues = mockVenues(origin);
  return async ({ center, radius }) =>
    venues
      .map((p) => ({ p, d: distanceM(center, p) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, PAGE_CAP)
      .map((x) => x.p);
}

export async function mockGeocode(query) {
  return { name: query, bounds: { south: 53.335, west: -6.28, north: 53.355, east: -6.245 } };
}
