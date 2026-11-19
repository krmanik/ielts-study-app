// Service worker of the phone screen (m.html): keeps the app on the phone so it opens with no connection.
//
//  ielts-shell   the app itself and the text of every test, stored when the app is first opened and
//                brought up to date when the page asks ({type: 'refresh'}) and the Mac is in reach
//  ielts-media   recordings and pictures, saved test by test from the page (js/m/offline.js)
//
// What is stored is answered from the phone; everything else goes to the network. Progress (/api/…)
// is never answered from here.
const SHELL = 'ielts-shell-v1', MEDIA = 'ielts-media-v1';
const BASE = new URL('./', self.location).href;                 // …/cbt/
const PAGE = BASE + 'm.html';
const STATIC = ['m.html', 'css/cbt.css', 'css/m.css', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png',
  'icons/icon-512.png', 'data/index.json', 'data/learn.json'];
const OPTIONAL = ['media/m/manifest.json'];                     // sizes of the smaller recordings, if they were made
const ENTRY = 'js/m/main.js';
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** A file the app needs. A request lost on the way ("Failed to fetch") is asked for again, twice, before
 * giving up: the app is about 80 files fetched at once, and one lost request would otherwise fail the
 * whole install. A real answer (404, 500) is not retried. */
async function get(url) {
  let r;
  for (let tries = 0; ; tries++) {
    try { r = await fetch(url, { cache: 'no-cache' }); break; } catch (e) {
      if (tries >= 2) throw e;
      await wait(tries ? 1500 : 500);
    }
  }
  if (r.status !== 200 || r.redirected) throw Object.assign(new Error(`${url}: ${r.status}`), { status: r.status });
  return r;
}

/**
 * Every file the app needs, url -> Response: the fixed list, the scripts found by following imports from
 * the entry script, and each test in the index. Throws if a required file cannot be had, so that a
 * half-fetched app is never stored.
 */
async function collect() {
  const out = new Map();
  const need = async (rel) => out.set(BASE + rel, await get(BASE + rel));
  const walk = async (url, required) => {
    if (out.has(url)) return;
    out.set(url, null);
    let r;
    try { r = await get(url); } catch (e) {
      // "404": the pattern found something that is no file (an import written in a comment) - leave it out.
      // Anything else (no connection, the server in trouble) ends the refresh: carrying on would store the
      // app without this script, and the screens that import it would then fail when opened
      if (required || e.status !== 404) throw e;
      out.delete(url);
      return;
    }
    out.set(url, r);
    const src = await r.clone().text();
    await Promise.all([...src.matchAll(IMPORT)].map((m) => walk(new URL(m[2], url).href, false)));
  };
  await Promise.all([...STATIC.map(need), walk(BASE + ENTRY, true)]);
  await Promise.all(OPTIONAL.map((rel) => need(rel).catch(() => {})));
  const index = await out.get(BASE + 'data/index.json').clone().json();
  await Promise.all(index.books.flatMap((b) => b.tests.map((t) => need(`data/t/${t.id}.json`))));
  return out;
}

const version = (r) => `${r.headers.get('ETag')}|${r.headers.get('Last-Modified')}|${r.headers.get('Content-Length')}`;

/** Store what collect() found. Returns true if anything was new or changed. */
async function store(files) {
  const c = await caches.open(SHELL);
  let updated = false;
  for (const [url, r] of files) {
    const old = await c.match(url);
    if (old && version(old) === version(r)) continue;
    await c.put(url, r);
    updated = true;
  }
  for (const req of await c.keys()) if (!files.has(req.url)) await c.delete(req);
  return updated;
}

self.addEventListener('install', (e) => e.waitUntil((async () => {
  await store(await collect());
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('ielts-') && name !== SHELL && name !== MEDIA) await caches.delete(name);
  await self.clients.claim();
})()));

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'refresh') return;
  e.waitUntil((async () => {
    let updated = false;
    try { updated = await store(await collect()); } catch { /* the Mac is out of reach: keep what is stored */ }
    for (const c of await self.clients.matchAll()) c.postMessage({ type: 'refreshed', updated });
  })());
});

/** Part of a stored file, for the audio player (it asks for byte ranges and will not seek without them). */
async function ranged(req, res) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m || (!m[1] && !m[2])) return res;
  const blob = await res.blob(), size = blob.size;
  const start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
  const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

async function answer(e, req, url) {
  const key = url.origin + url.pathname;
  const hit = await caches.match(key);
  if (hit) return req.headers.has('range') ? ranged(req, hit) : hit;
  try {
    let r;
    try { r = await fetch(req); } catch (err) {
      // one request lost on a poor connection must not break the screen that needs the file: ask once more
      if (req.mode === 'navigate' || req.headers.has('range')) throw err;
      await wait(400);
      r = await fetch(req.url, { cache: 'no-cache' });
    }
    // a script, style sheet or test that was not stored yet: keep it for next time
    if (r.status === 200 && !r.redirected && key.startsWith(BASE) && /\.(js|css|json)$/.test(url.pathname)) {
      const copy = r.clone();
      e.waitUntil(caches.open(SHELL).then((c) => c.put(key, copy)).catch(() => {}));
    }
    return r;
  } catch (err) {
    if (req.mode === 'navigate') return (await caches.match(PAGE)) || Response.error();
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/m') return;
  e.respondWith(answer(e, req, url));
});
