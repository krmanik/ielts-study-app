// Keeping the tests on the phone. The app and the text of every test are stored by the service worker
// (../../sw.js) the first time the app is opened; recordings and pictures are large, so they are saved
// test by test from here, into the cache the service worker answers from.
import { loadTest, allTests, audioUrl, useAudioMap } from '../data.js';

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
/**
 * Can this page keep things for offline use? Needs HTTPS. On the Mac itself it stays off (the files are
 * always at hand, and a stored copy would hide edits to the app) unless the address ends in ?sw.
 */
export const offlineOK = 'serviceWorker' in navigator && 'caches' in window && window.isSecureContext
  && (!LOCAL || new URLSearchParams(location.search).has('sw'));
/** Opened from the home-screen icon rather than a browser tab. */
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const MEDIA = 'ielts-media-v1';
const INDEX = 'ielts-cbt.saved';     // test id -> bytes, the tests whose recordings and pictures are on this phone
let sizes = { audio: {}, tests: {} };
let appReady = false;
const subs = new Set();
export function onOffline(f) { subs.add(f); return () => subs.delete(f); }
const tell = () => subs.forEach((f) => f());

export async function initOffline() {
  try {
    const r = await fetch('media/m/manifest.json');
    if (r.ok) { sizes = await r.json(); useAudioMap(sizes.audio); }
  } catch { /* no smaller recordings were made: the originals are used */ }
  if (!offlineOK) return;
  try {
    // a first visit stores everything fresh; no need to look for an update straight after
    if (!navigator.serviceWorker.controller) localStorage.setItem('ielts-cbt.refresh', Date.now());
    await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.ready.then(() => { appReady = true; tell(); checkUpdate(); });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'refreshed' && e.data.updated) subs.forEach((f) => f('updated'));
    });
  } catch (e) { console.warn('offline storage not available', e); }
}

/** The app and all test text are stored on this phone. */
export const appSaved = () => appReady;

/** Ask the service worker to fetch a newer version of the app, if the Mac is in reach. At most hourly unless `force`. */
export async function checkUpdate(force = false) {
  if (!offlineOK) return;
  const last = +localStorage.getItem('ielts-cbt.refresh') || 0;
  if (!force && Date.now() - last < 3600e3) return;
  localStorage.setItem('ielts-cbt.refresh', Date.now());
  (await navigator.serviceWorker.ready).active?.postMessage({ type: 'refresh' });
}

const abs = (u) => new URL(u, document.baseURI).href;

/** The recordings and pictures one test needs: [{ url, kind: 'audio' | 'page' }]. */
export async function testFiles(id) {
  const T = await loadTest(id);
  const out = [], pages = new Set();
  for (const p of T.L.parts) if (p.audio) out.push({ url: abs(audioUrl(p.audio)), kind: 'audio' });
  for (const sk of ['L', 'R']) for (const p of T[sk].parts) for (const g of p.groups) for (const f of g.fig || []) pages.add(f.page);
  for (const t of T.W.tasks) {
    for (const f of t.fig || []) pages.add(f.page);
    for (const n of t.samplePages || []) pages.add(n);
  }
  for (const n of pages) out.push({ url: abs(`pages/${T.book}/${n}.jpg`), kind: 'page' });
  return out;
}

/** Download size of a test in bytes, or 0 when unknown. */
export const testBytes = (id) => sizes.tests?.[id] || 0;
export const fmtMB = (b) => (b ? `${b < 10e6 ? (b / 1e6).toFixed(1) : Math.round(b / 1e6)} MB` : '');

const readIndex = () => { try { return JSON.parse(localStorage.getItem(INDEX)) || {}; } catch { return {}; } };
const writeIndex = (ix) => { localStorage.setItem(INDEX, JSON.stringify(ix)); tell(); };
/** Ids of the tests saved on this phone. */
export const savedIds = () => new Set(Object.keys(readIndex()));
export const isSaved = (id) => id in readIndex();

/** Check one test against what is really stored (a phone may clear storage it thinks is unused). */
export async function verify(id) {
  if (!offlineOK || !isSaved(id)) return isSaved(id);
  const c = await caches.open(MEDIA);
  for (const f of await testFiles(id)) {
    if (!(await c.match(f.url))) { const ix = readIndex(); delete ix[id]; writeIndex(ix); return false; }
  }
  return true;
}

/** Save one test's recordings and pictures. `onProgress(done, total)`. */
export async function saveTest(id, onProgress) {
  const files = await testFiles(id);
  const c = await caches.open(MEDIA);
  let done = 0;
  for (const f of files) {
    if (!(await c.match(f.url))) {
      const r = await fetch(f.url, { cache: 'no-store' });
      if (r.status !== 200) throw new Error(r.status === 401 ? 'The Mac wants the phone code again' : `A file could not be fetched (${r.status})`);
      await c.put(f.url, r);
    }
    onProgress?.(++done, files.length);
  }
  const ix = readIndex();
  ix[id] = testBytes(id);
  writeIndex(ix);
  navigator.storage?.persist?.();       // ask the phone not to clear this when it runs short of space
}

export async function removeTest(id) {
  const c = await caches.open(MEDIA);
  for (const f of await testFiles(id)) await c.delete(f.url);
  const ix = readIndex(); delete ix[id]; writeIndex(ix);
}
export async function removeAll() {
  await caches.delete(MEDIA);
  writeIndex({});
}

/** Bytes this app keeps on the phone, or null where the browser will not say. */
export async function usage() {
  try { return (await navigator.storage.estimate()).usage ?? null; } catch { return null; }
}
export const allIds = () => allTests().map((t) => t.id);
