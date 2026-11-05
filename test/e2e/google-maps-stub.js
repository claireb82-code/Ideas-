// Minimal stand-in for the Google Maps JS API so the UI can be tested offline.
// It implements only the calls public/app.js makes, and records them on window.__gm.
(() => {
  const log = { markers: [], opened: [], panned: 0 };
  window.__gm = log;
  window.__fireIdle = () => (window.__stubMap?.listeners.idle || []).forEach((f) => f());
  const mapDiv = () => document.getElementById('map');

  class LatLng { constructor(a, b) { this.a = a; this.b = b; } lat() { return this.a; } lng() { return this.b; } }
  class Map {
    constructor(div, opts) { this.div = div; this.opts = opts; this.listeners = {}; this.layer = document.createElement('div'); this.layer.id = 'stub-markers'; div.append(this.layer); window.__stubMap = this; }
    addListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); if (ev === 'idle') setTimeout(fn, 0); }
    getBounds() { const w = window.__stubBounds || { south: 53.335, west: -6.28, north: 53.355, east: -6.245 }; return { getNorthEast: () => new LatLng(w.north, w.east), getSouthWest: () => new LatLng(w.south, w.west) }; }
    panTo() { log.panned++; } setCenter() {} setZoom() {} fitBounds(b) { log.fit = b; }
  }
  class AdvancedMarkerElement {
    constructor({ map, position, content, title }) { this.position = position; this.title = title; this.content = content; this._map = map; this.clicks = []; log.markers.push(this); this._render(); }
    _render() { if (this._wrap) this._wrap.remove(); if (!this._map) return; this._wrap = document.createElement('div'); this._wrap.className = 'stub-marker'; this._wrap.dataset.title = this.title; this._wrap.append(this._content); this._wrap.onclick = () => this.clicks.forEach((f) => f()); this._map.layer.append(this._wrap); }
    set content(c) { this._content = c; if (this._wrap) this._render(); } get content() { return this._content; }
    set map(m) { this._map = m; this._render(); } get map() { return this._map; }
    addListener(ev, fn) { if (ev === 'click') this.clicks.push(fn); }
  }
  class InfoWindow {
    setContent(n) { this.node = n; }
    open() { let box = document.getElementById('stub-iw'); if (!box) { box = document.createElement('div'); box.id = 'stub-iw'; document.body.append(box); } box.replaceChildren(this.node); log.opened.push(this.node.querySelector('h3')?.textContent); }
    close() { document.getElementById('stub-iw')?.remove(); }
  }
  window.google = { maps: { importLibrary: async (n) => (n === 'maps' ? { Map, InfoWindow } : { AdvancedMarkerElement }) } };
  setTimeout(() => window.__gmReady && window.__gmReady(), 0);
})();
