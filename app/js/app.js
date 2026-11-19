import { $, $$, esc, isTyping, toast } from './util.js';
import { loadData } from './data.js';
import { icon } from '../cbt/js/icons.js';
import { settings, addActivity, onChange, initSync } from './store.js';
import { initPlayer, state as playerState } from './player.js';
import { setChrome, takeGuard, clearGuard } from './chrome.js';
import * as cbt from './cbt.js';
import * as home from './views/home.js';
import * as learn from './views/learn.js';
import * as reader from './views/reader.js';
import * as tests from './views/tests.js';
import * as exam from './views/exam.js';
import * as audio from './views/audio.js';
import * as vocab from './views/vocab.js';
import * as mistakes from './views/mistakes.js';
import * as notes from './views/notes.js';
import * as search from './views/search.js';
import * as settingsView from './views/settings.js';

const ROUTES = [
  [/^\/?$/, home.render, 'home'],
  [/^\/learn$/, learn.render, 'learn'],
  [/^\/unit\/([\w-]+)$/, learn.renderUnit, 'learn'],
  [/^\/s\/([\w-]+)$/, reader.renderSection, 'learn'],
  [/^\/page\/(\d+)$/, reader.renderBook, 'book'],
  [/^\/book$/, reader.renderBook, 'book'],
  [/^\/tests$/, tests.render, 'tests'],
  [/^\/test\/(\w+)$/, tests.renderTest, 'tests'],
  [/^\/test\/(\w+)\/(study)\/(\w+)$/, tests.renderStudy, 'tests'],
  [/^\/exam\/(\w+)\/(listening|reading|writing|speaking)$/, exam.render, 'tests'],
  [/^\/attempt\/([\w]+)$/, exam.renderAttempt, 'tests'],
  [/^\/audio$/, audio.render, 'audio'],
  [/^\/vocab$/, vocab.render, 'vocab'],
  [/^\/vocab\/review$/, vocab.renderReview, 'vocab'],
  [/^\/mistakes$/, mistakes.render, 'mistakes'],
  [/^\/notes$/, notes.render, 'notes'],
  [/^\/search$/, search.render, 'search'],
  [/^\/settings$/, settingsView.render, 'settings'],
];

let cleanup = null;

let lastHash = location.hash;
async function route() {
  const guard = takeGuard();
  if (guard) {
    const msg = guard();
    if (msg && !confirm(msg)) { history.replaceState(null, '', lastHash || '#/'); return; }
    clearGuard();
  }
  lastHash = location.hash;
  const full = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const inCbt = path.match(cbt.CBT_RE);
  // the Test Centre frame stays open while moving between its pages
  if (inCbt && cbt.show($('#view'), inCbt[1])) { document.body.classList.remove('nav-open'); return; }
  cleanup?.(); cleanup = null;
  document.body.classList.remove('nav-open', 'focus');
  // fresh element per view so listeners attached by the previous view can't leak
  const old = $('#view'), view = old.cloneNode(false);
  old.replaceWith(view);
  if (inCbt) { cbt.show(view, inCbt[1]); cleanup = cbt.hide; return; }
  for (const [re, fn, nav] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    setChrome({});
    try {
      cleanup = (await fn(view, { params: m.slice(1), query })) || null;
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="card"><h2>Something went wrong</h2><pre style="white-space:pre-wrap">${esc(e.stack || e)}</pre></div>`;
    }
    if (!query.y && !query.q) window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = `<div class="empty"><h2>Page not found</h2><a href="#/">Go home</a></div>`;
}

function applyTheme() {
  const s = settings();
  const dark = s.theme === 'dark' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.darkPages = s.darkPages ? '1' : '0';
  document.documentElement.style.setProperty('--page-w', (s.zoom || 860) + 'px');
}

// Study-time tracking: counts 15s ticks while the tab is visible and you interacted in the last 2 minutes
// (or audio is playing).
let lastInput = Date.now();
['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) => addEventListener(ev, () => (lastInput = Date.now()), { passive: true, capture: true }));
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastInput < 120000 || playerState().playing) addActivity(15);
}, 15000);

async function boot() {
  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  await initSync();     // progress saved on disk, if it is newer than this browser's copy
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  onChange(applyTheme);
  try {
    await loadData();
  } catch (e) {
    $('#view').innerHTML = `<div class="card"><h2>Couldn't load the book data</h2>
      <p>Open this app through the included start script (it runs a small local web server), not by double-clicking <code>index.html</code>.</p>
      <pre>${esc(e)}</pre></div>`;
    return;
  }
  initPlayer();
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'toggle-nav') document.body.classList.toggle('nav-open');
    if (a.dataset.action === 'close-nav') document.body.classList.remove('nav-open');
  });
  document.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); location.hash = '#/search'; }
    if (e.key === '?') toast('Shortcuts: Space play/pause · ←/→ seek 5s · F focus mode · J/K next/prev page · / search', 5000);
  });
  $('#side-foot').innerHTML = `Press <kbd>?</kbd> for shortcuts`;
  cbt.init((h) => { lastHash = h; });
  window.addEventListener('hashchange', route);
  route();
}
boot();
