// Detects whether a venue's website mentions Guinness.
//
// Strategy: fetch the home page, then follow a few same-site links that look
// like menu/drinks pages, and look for "Guinness" in the visible text.
//
// Result statuses (see docs/ARCHITECTURE.md):
//   menu     - found on a page whose URL looks like a menu/drinks page
//   website  - found elsewhere on the venue's site
//   none     - site was readable, no mention found (NOT proof they don't serve it)
//   unknown  - could not check (no site, unreachable, JS-only page, PDF-only menu)
import * as cheerio from 'cheerio';
import { safeFetch } from './safe-fetch.js';

// Matches Guinness plus the common misspelling "Guiness". Excludes the
// "Guinness World Records" / "Book of Records" false positives.
const GUINNESS_RE = /\bguinn?ess\b(?!\s+(?:world\s+record|book\s+of))/i;
// Pages likely to hold the drinks list.
const MENU_PATH_RE = /menu|drink|beer|tap|draught|draft|cocktail|wine|carte|bar-?list|on-?tap/i;
// Links worth following (broader: includes food/bar pages).
const FOLLOW_RE = new RegExp(`${MENU_PATH_RE.source}|food|dine|dining|eat|bar|pub|restaurant`, 'i');
const MIN_USEFUL_TEXT = 200; // below this the page is probably JS-rendered

export function findGuinness(text, radius = 80) {
  const m = GUINNESS_RE.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function isMenuUrl(url) {
  try {
    return MENU_PATH_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const sameSite = (a, b) => a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '');

/** Parse HTML into { title, text, links[] } with links resolved against baseUrl. */
export function parsePage(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    try {
      links.push({ url: new URL(href, baseUrl).toString(), label: $(el).text().trim() });
    } catch {
      /* ignore malformed href */
    }
  });
  const title = $('title').first().text().trim();
  $('script, style, noscript, svg, template').remove();
  // Separate adjacent elements with a space, otherwise "<li>Guinness</li><li>Heineken</li>"
  // becomes "GuinnessHeineken" and the word-boundary match fails.
  $('*').after(' ');
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { title, text, links };
}

/** Pick same-site links that look like menu pages. PDFs are counted, not fetched. */
export function pickMenuLinks(links, baseUrl, max = 4) {
  const base = new URL(baseUrl);
  const seen = new Set([base.toString().replace(/#.*$/, '')]);
  const picked = [];
  let pdfs = 0;
  for (const l of links) {
    let u;
    try {
      u = new URL(l.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u, base)) continue;
    if (!FOLLOW_RE.test(u.pathname) && !FOLLOW_RE.test(l.label)) continue;
    u.hash = '';
    const key = u.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    if (/\.(pdf|jpe?g|png|webp)$/i.test(u.pathname)) {
      pdfs++;
      continue;
    }
    picked.push({ url: key, score: (MENU_PATH_RE.test(u.pathname) ? 2 : 0) + (MENU_PATH_RE.test(l.label) ? 1 : 0) });
  }
  picked.sort((a, b) => b.score - a.score);
  return { urls: picked.slice(0, max).map((p) => p.url), pdfs };
}

/**
 * Check one venue website. Never throws: failures become status "unknown".
 * @param {string|undefined} website
 * @param {object} [opts] { fetchOpts, maxPages }
 */
export async function checkWebsite(website, opts = {}) {
  const { fetchOpts = {}, maxPages = 4 } = opts;
  if (!website) return { status: 'unknown', evidence: [], pagesChecked: 0, note: 'No website listed' };

  let home;
  try {
    home = await safeFetch(website, fetchOpts);
  } catch (err) {
    return { status: 'unknown', evidence: [], pagesChecked: 0, note: `Website unreachable (${err.message})` };
  }

  const evidence = [];
  const record = (url, text) => {
    const snippet = findGuinness(text);
    if (snippet) evidence.push({ url, snippet, menuPage: isMenuUrl(url) });
  };

  const page = parsePage(home.text, home.url);
  record(home.url, page.text);
  let usefulPages = page.text.length >= MIN_USEFUL_TEXT ? 1 : 0;
  let pagesChecked = 1;

  const { urls, pdfs } = pickMenuLinks(page.links, home.url, maxPages);
  let htmlMenuPagesRead = 0;
  for (const url of urls) {
    if (evidence.some((e) => e.menuPage)) break; // already have the strongest signal
    try {
      const sub = await safeFetch(url, fetchOpts);
      pagesChecked++;
      const p = parsePage(sub.text, sub.url);
      if (p.text.length >= MIN_USEFUL_TEXT) usefulPages++;
      if (isMenuUrl(sub.url)) htmlMenuPagesRead++;
      record(sub.url, p.text);
    } catch {
      /* a broken sub-page shouldn't fail the venue */
    }
  }

  if (evidence.length) {
    const best = evidence.find((e) => e.menuPage) ?? evidence[0];
    return { status: evidence.some((e) => e.menuPage) ? 'menu' : 'website', evidence: [best], pagesChecked, note: '' };
  }
  if (usefulPages === 0) {
    return { status: 'unknown', evidence: [], pagesChecked, note: 'Site has little readable text (likely JavaScript-rendered)' };
  }
  if (pdfs > 0 && htmlMenuPagesRead === 0) {
    return { status: 'unknown', evidence: [], pagesChecked, note: 'Menu appears to be a PDF/image, which is not scanned yet' };
  }
  return { status: 'none', evidence: [], pagesChecked, note: 'No mention found on the website' };
}

/**
 * Merge a (possibly cached) website result with Google review text.
 * A website hit always wins; otherwise a review mention upgrades none/unknown to "reviews".
 */
export function combineWithReviews(websiteResult, reviewTexts = []) {
  if (websiteResult.status === 'menu' || websiteResult.status === 'website') return websiteResult;
  for (const t of reviewTexts) {
    const snippet = t && findGuinness(t);
    if (snippet) {
      return { ...websiteResult, status: 'reviews', evidence: [{ url: null, snippet, menuPage: false }], note: 'Mentioned in a Google review' };
    }
  }
  return websiteResult;
}
