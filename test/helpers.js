// Test helper: a fake fetch serving an in-memory map of url -> html.
export function fakeFetch(pages) {
  const calls = [];
  const impl = async (url) => {
    const u = String(url);
    calls.push(u);
    const page = pages[u];
    if (page === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    if (typeof page === 'object') {
      return new Response(page.body ?? '', { status: page.status ?? 200, headers: { 'content-type': 'text/html', ...(page.headers || {}) } });
    }
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  impl.calls = calls;
  return impl;
}

export const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
export const filler = 'Welcome to our family run venue serving the local community with warm hospitality every single day of the week. '.repeat(3);
export const fetchOpts = (pages) => ({ fetchImpl: fakeFetch(pages), allowPrivate: true });
