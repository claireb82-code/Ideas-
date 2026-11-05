import test from 'node:test';
import assert from 'node:assert/strict';
import { findGuinness, isMenuUrl, parsePage, pickMenuLinks, checkWebsite, combineWithReviews } from '../src/guinness.js';
import { fakeFetch, page, filler } from './helpers.js';

const opts = (pages) => ({ fetchOpts: { fetchImpl: fakeFetch(pages), allowPrivate: true } });

test('findGuinness: matches case-insensitively and the common misspelling', () => {
  assert.match(findGuinness('Pint of GUINNESS £5'), /GUINNESS/);
  assert.match(findGuinness('we pour Guiness here'), /Guiness/);
});

test('findGuinness: returns a trimmed snippet with ellipses when truncated', () => {
  const s = findGuinness('x'.repeat(200) + ' Guinness ' + 'y'.repeat(200));
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.length < 200);
});

test('findGuinness: ignores false positives', () => {
  assert.equal(findGuinness('Holder of a Guinness World Record for longest bar'), null);
  assert.equal(findGuinness('Guinness Book of Records entry'), null);
  assert.equal(findGuinness('Our guinea pig petting zoo'), null);
  assert.equal(findGuinness('Nothing here'), null);
});

test('isMenuUrl', () => {
  assert.equal(isMenuUrl('https://x.com/menus/drinks'), true);
  assert.equal(isMenuUrl('https://x.com/about'), false);
  assert.equal(isMenuUrl('not a url'), false);
});

test('parsePage: strips scripts/styles and resolves links', () => {
  const p = parsePage(
    page('T', '<script>var Guinness=1</script><style>.g{}</style><p>Hello   world</p><a href="/menu">Menu</a><a href="mailto:a@b.c">m</a>'),
    'https://x.com/',
  );
  assert.equal(p.title, 'T');
  assert.equal(p.text, 'Hello world Menu m');
  assert.deepEqual(p.links, [{ url: 'https://x.com/menu', label: 'Menu' }]);
});

test('pickMenuLinks: same-site only, ranks menu pages first, counts PDFs', () => {
  const links = [
    { url: 'https://x.com/about', label: 'About' },
    { url: 'https://x.com/our-bar', label: 'Our bar' },
    { url: 'https://x.com/drinks-menu', label: 'Drinks' },
    { url: 'https://www.x.com/menu.pdf', label: 'Menu PDF' },
    { url: 'https://evil.com/menu', label: 'Menu' },
    { url: 'https://x.com/drinks-menu#top', label: 'dup' },
  ];
  const { urls, pdfs } = pickMenuLinks(links, 'https://x.com/');
  assert.deepEqual(urls, ['https://x.com/drinks-menu', 'https://x.com/our-bar']);
  assert.equal(pdfs, 1);
});

test('checkWebsite: no website -> unknown', async () => {
  const r = await checkWebsite(undefined);
  assert.equal(r.status, 'unknown');
  assert.match(r.note, /No website/);
});

test('checkWebsite: unreachable -> unknown, never throws', async () => {
  const r = await checkWebsite('https://down.test/', opts({}));
  assert.equal(r.status, 'unknown');
  assert.match(r.note, /unreachable/);
});

test('checkWebsite: Guinness on a followed menu page -> menu', async () => {
  const pages = {
    'https://pub.test/': page('Pub', `${filler}<a href="/drinks">Drinks</a>`),
    'https://pub.test/drinks': page('Drinks', `${filler} Draught: Guinness, Heineken`),
  };
  const r = await checkWebsite('https://pub.test/', opts(pages));
  assert.equal(r.status, 'menu');
  assert.equal(r.evidence[0].url, 'https://pub.test/drinks');
  assert.match(r.evidence[0].snippet, /Guinness/);
});

test('checkWebsite: Guinness only on the home page -> website', async () => {
  const pages = { 'https://h.test/': page('Hotel', `${filler} Enjoy a pint of Guinness in our lounge.`) };
  const r = await checkWebsite('https://h.test/', opts(pages));
  assert.equal(r.status, 'website');
});

test('checkWebsite: home mention is upgraded to menu when a menu page also matches', async () => {
  const pages = {
    'https://u.test/': page('U', `${filler} Guinness fans welcome <a href="/menu">Menu</a>`),
    'https://u.test/menu': page('Menu', `${filler} Guinness 5.50`),
  };
  const r = await checkWebsite('https://u.test/', opts(pages));
  assert.equal(r.status, 'menu');
});

test('checkWebsite: readable site, no mention -> none', async () => {
  const pages = {
    'https://p.test/': page('Pasta', `${filler}<a href="/menu">Menu</a>`),
    'https://p.test/menu': page('Menu', `${filler} Carbonara, Margherita, Tiramisu`),
  };
  const r = await checkWebsite('https://p.test/', opts(pages));
  assert.equal(r.status, 'none');
  assert.equal(r.pagesChecked, 2);
});

test('checkWebsite: near-empty (JS-rendered) page -> unknown, not none', async () => {
  const pages = { 'https://spa.test/': page('App', '<div id="root"></div><script>render()</script>') };
  const r = await checkWebsite('https://spa.test/', opts(pages));
  assert.equal(r.status, 'unknown');
  assert.match(r.note, /JavaScript/);
});

test('checkWebsite: PDF-only menu -> unknown, not none', async () => {
  const pages = { 'https://pdf.test/': page('Pdf', `${filler}<a href="/menu.pdf">Download our menu</a>`) };
  const r = await checkWebsite('https://pdf.test/', opts(pages));
  assert.equal(r.status, 'unknown');
  assert.match(r.note, /PDF/);
});

test('checkWebsite: a broken sub-page does not fail the venue', async () => {
  const pages = {
    'https://b.test/': page('B', `${filler}<a href="/menu">Menu</a><a href="/drinks">Drinks</a>`),
    'https://b.test/drinks': page('D', `${filler} Guinness on tap`),
    // /menu -> 404
  };
  const r = await checkWebsite('https://b.test/', opts(pages));
  assert.equal(r.status, 'menu');
});

test('checkWebsite: stops following links once a menu hit is found', async () => {
  const f = fakeFetch({
    'https://s.test/': page('S', `${filler}<a href="/menu">Menu</a><a href="/drinks">Drinks</a><a href="/food">Food</a>`),
    'https://s.test/menu': page('M', `${filler} Guinness`),
    'https://s.test/drinks': page('D', filler),
    'https://s.test/food': page('F', filler),
  });
  await checkWebsite('https://s.test/', { fetchOpts: { fetchImpl: f, allowPrivate: true } });
  assert.equal(f.calls.length, 2);
});

test('combineWithReviews: website hit wins over reviews', () => {
  const w = { status: 'menu', evidence: [], pagesChecked: 1, note: '' };
  assert.equal(combineWithReviews(w, ['great Guinness']).status, 'menu');
});

test('combineWithReviews: review mention upgrades none/unknown to reviews', () => {
  for (const status of ['none', 'unknown']) {
    const r = combineWithReviews({ status, evidence: [], pagesChecked: 0, note: '' }, ['Lovely', 'Best pint of Guinness in town']);
    assert.equal(r.status, 'reviews');
    assert.match(r.evidence[0].snippet, /Guinness/);
  }
});

test('combineWithReviews: no mention leaves result untouched', () => {
  const w = { status: 'none', evidence: [], pagesChecked: 1, note: '' };
  assert.deepEqual(combineWithReviews(w, ['nice', undefined, '']), w);
});

test('regression: Guinness in a list is found even with no whitespace between elements', async () => {
  const pages = { 'https://list.test/': page('L', `${filler}<ul><li>Guinness</li><li>Heineken</li><li>Carlsberg</li></ul>`) };
  const r = await checkWebsite('https://list.test/', opts(pages));
  assert.equal(r.status, 'website');
});
