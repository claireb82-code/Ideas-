import {
  STATUS, CATEGORY, DEFAULT_STATUSES, statusOf, sortPlaces, filterPlaces, countByStatus, diagonalKm, readNdjson, applyEvent,
} from './lib.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

const state = {
  cfg: null,
  places: new Map(),
  filters: { statuses: new Set(DEFAULT_STATUSES), categories: new Set(), text: '' },
  markers: new Map(), // id -> { marker, pin }
  activeId: null,
  abort: null,
  searching: false,
};
let map, infoWindow, AdvancedMarkerElement;

function setStatus(msg, isError = false) {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('error', isError);
}

function fatal(html) {
  const f = $('fatal');
  f.replaceChildren(...html);
  f.hidden = false;
}

// ---------- Google Maps loading ----------
function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    window.__gmReady = resolve;
    window.gm_authFailure = () => reject(new Error('Google rejected the Maps key (check it is enabled for the Maps JavaScript API and the referrer matches).'));
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__gmReady`;
    s.async = true;
    s.onerror = () => reject(new Error('Could not load the Google Maps script.'));
    document.head.append(s);
  });
}

async function initMap() {
  await loadGoogleMaps(state.cfg.browserKey);
  const { Map, InfoWindow } = await google.maps.importLibrary('maps');
  ({ AdvancedMarkerElement } = await google.maps.importLibrary('marker'));
  map = new Map($('map'), {
    center: state.cfg.defaultCenter,
    zoom: 15,
    mapId: state.cfg.mapId,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
  });
  infoWindow = new InfoWindow();
  map.addListener('idle', updateSearchButton);
  updateSearchButton();
}

const currentBounds = () => {
  const b = map.getBounds();
  if (!b) return null;
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  return { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() };
};

function updateSearchButton() {
  const btn = $('search');
  const b = currentBounds();
  if (!state.cfg.searchEnabled) {
    btn.disabled = true;
    btn.textContent = 'Search unavailable (no Places key)';
  } else if (state.searching) {
    btn.disabled = true;
    btn.textContent = 'Searching…';
  } else if (!b) {
    btn.disabled = true;
  } else if (diagonalKm(b) > state.cfg.maxSearchKm) {
    btn.disabled = true;
    btn.textContent = 'Zoom in to search this area';
  } else {
    btn.disabled = false;
    btn.textContent = 'Search this area';
  }
}

// ---------- Search ----------
async function search() {
  const bounds = currentBounds();
  if (!bounds) return;
  state.abort?.abort();
  const abort = (state.abort = new AbortController());
  state.searching = true;
  state.activeId = null;
  infoWindow.close();
  updateSearchButton();
  setStatus('Finding venues…');
  let res;
  try {
    res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bounds }), signal: abort.signal });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Search failed (${res.status})`);
    for await (const ev of readNdjson(res.body)) {
      applyEvent(state.places, ev);
      if (ev.type === 'places') {
        setStatus(`Found ${ev.places.length} venues. Reading their websites…${ev.truncated ? ' (Very dense area: zoom in for complete results.)' : ''}`);
      }
      if (ev.type === 'done') {
        const c = countByStatus([...state.places.values()]);
        setStatus(`Checked ${ev.total} venues: ${c.menu + c.website + c.reviews} appear to serve Guinness.`);
      }
      render();
    }
  } catch (err) {
    if (err.name !== 'AbortError') setStatus(err.message, true);
  } finally {
    if (state.abort === abort) {
      state.searching = false;
      updateSearchButton();
    }
  }
}

// ---------- Rendering ----------
function makePin(status) {
  return el('div', { className: `pin s-${status}${status === 'pending' ? ' pending' : ''}`, textContent: STATUS[status].glyph });
}

function render() {
  const all = [...state.places.values()];
  renderFilters(all);
  const visible = sortPlaces(filterPlaces(all, state.filters));
  renderMarkers(visible);
  renderList(visible, all.length);
}

function renderFilters(all) {
  const counts = countByStatus(all);
  const sBox = $('status-filters');
  sBox.replaceChildren(
    ...Object.entries(STATUS).filter(([key]) => key !== 'pending' || counts.pending > 0).map(([key, meta]) => {
      const b = el('button', { type: 'button', className: 'chip', title: meta.help });
      b.setAttribute('aria-pressed', String(state.filters.statuses.has(key)));
      b.append(el('span', { className: `dot s-${key}`, style: '' }), meta.short + ' ', el('span', { className: 'n', textContent: counts[key] }));
      b.querySelector('.dot').style.setProperty('--c', `var(--${key})`);
      b.onclick = () => toggle(state.filters.statuses, key);
      return b;
    }),
  );
  $('category-filters').replaceChildren(
    ...Object.entries(CATEGORY).map(([key, label]) => {
      const b = el('button', { type: 'button', className: 'chip', textContent: label });
      b.setAttribute('aria-pressed', String(state.filters.categories.has(key)));
      b.onclick = () => toggle(state.filters.categories, key);
      return b;
    }),
  );
}

function toggle(set, key) {
  set.has(key) ? set.delete(key) : set.add(key);
  render();
}

function renderMarkers(visible) {
  const keep = new Set(visible.map((p) => p.id));
  for (const [id, m] of state.markers) {
    if (!keep.has(id)) {
      m.marker.map = null;
      state.markers.delete(id);
    }
  }
  for (const p of visible) {
    const status = statusOf(p);
    let m = state.markers.get(p.id);
    if (!m) {
      const pin = makePin(status);
      const marker = new AdvancedMarkerElement({ map, position: { lat: p.lat, lng: p.lng }, content: pin, title: p.name });
      marker.addListener('click', () => select(p.id));
      m = { marker, pin, status };
      state.markers.set(p.id, m);
    } else if (m.status !== status) {
      const pin = makePin(status);
      m.marker.content = pin;
      Object.assign(m, { pin, status });
    }
    m.pin.classList.toggle('active', p.id === state.activeId);
  }
}

function renderList(visible, total) {
  const ul = $('list');
  if (!visible.length) {
    ul.replaceChildren(el('li', { className: 'empty', textContent: total ? 'No venues match the current filters. Try turning on “No mention found” or “Unknown”.' : 'Move the map and press “Search this area”.' }));
    return;
  }
  ul.replaceChildren(
    ...visible.map((p) => {
      const status = statusOf(p);
      const btn = el('button', { type: 'button', className: `item${p.id === state.activeId ? ' active' : ''}` });
      btn.append(
        makePin(status),
        el('span', {}, el('div', { className: 'name', textContent: p.name }), el('div', { className: 'meta', textContent: `${CATEGORY[p.category] ?? 'Venue'} · ${STATUS[status].label}${p.rating ? ` · ★ ${p.rating}` : ''}` })),
      );
      btn.onclick = () => select(p.id, true);
      return el('li', {}, btn);
    }),
  );
}

function infoContent(p) {
  const status = statusOf(p);
  const box = el('div', { className: 'iw' });
  box.append(
    el('h3', { textContent: p.name }),
    el('div', { className: 'm', textContent: [CATEGORY[p.category], p.rating && `★ ${p.rating} (${p.ratingCount ?? 0})`, p.address].filter(Boolean).join(' · ') }),
    el('span', { className: `badge s-${status}`, textContent: `${STATUS[status].glyph} ${STATUS[status].label}` }),
  );
  const ev = p.check?.evidence?.[0];
  if (ev?.snippet) box.append(el('blockquote', { textContent: ev.snippet }));
  const note = p.check?.note || STATUS[status].help;
  box.append(el('div', { className: 'note', textContent: note }));
  const links = el('div');
  const addLink = (href, text) => {
    if (!href || !/^https?:\/\//i.test(href)) return; // never render javascript: etc.
    links.append(el('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text }));
  };
  addLink(ev?.url, 'Where we found it');
  addLink(p.website, 'Website');
  addLink(p.mapsUrl, 'Google Maps');
  box.append(links);
  return box;
}

function select(id, pan = false) {
  state.activeId = id;
  const p = state.places.get(id);
  if (p) {
    if (pan) map.panTo({ lat: p.lat, lng: p.lng });
    infoWindow.setContent(infoContent(p));
    const m = state.markers.get(id);
    if (m) infoWindow.open({ map, anchor: m.marker });
  }
  render();
}

// ---------- Wiring ----------
$('search').onclick = search;
$('text').oninput = (e) => {
  state.filters.text = e.target.value;
  render();
};
$('geo').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('place').value.trim();
  if (!q) return;
  setStatus(`Looking up “${q}”…`);
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    map.fitBounds({ south: j.bounds.south, west: j.bounds.west, north: j.bounds.north, east: j.bounds.east });
    setStatus(`Showing ${j.name}. Press “Search this area” (zoom in if the area is too big).`);
  } catch (err) {
    setStatus(err.message, true);
  }
};
$('locate').onclick = () => {
  if (!navigator.geolocation) return setStatus('Geolocation is not available in this browser.', true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      map.setZoom(15);
    },
    () => setStatus('Could not get your location.', true),
  );
};

async function main() {
  state.cfg = await (await fetch('/api/config')).json();
  render();
  if (!state.cfg.browserKey) {
    return fatal([
      el('h2', { textContent: 'Map key needed' }),
      el('p', {}, 'Set ', el('code', { textContent: 'GOOGLE_MAPS_BROWSER_KEY' }), ' in ', el('code', { textContent: '.env' }), ' and restart. See the README for the two APIs to enable.'),
    ]);
  }
  try {
    await initMap();
    setStatus(state.cfg.mock ? 'Mock mode: sample Dublin venues. Press “Search this area”.' : 'Pan/zoom to an area and press “Search this area”.');
  } catch (err) {
    fatal([el('h2', { textContent: 'The map could not load' }), el('p', { textContent: err.message })]);
    setStatus(err.message, true);
  }
}
main();
