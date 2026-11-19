import { $, $$, esc } from './util.js';
import { loadIndex } from './data.js';
import { settings, onChange, initSync } from './store.js';
import { fsButton } from './fullscreen.js';
import { icon } from './icons.js';

const NAV = [
  ['#/', 'home', 'Home'],
  ['#/tests', 'tests', 'All tests'],
  ['#/learn', 'learn', 'Learn'],
  ['#/progress', 'progress', 'Progress'],
  ['#/mistakes', 'mistakes', 'Mistakes'],
  ['#/settings', 'settings', 'Settings'],
];

const ROUTES = [
  [/^\/?$/, () => import('./views/home.js'), 'render', 'home'],
  [/^\/tests$/, () => import('./views/home.js'), 'renderLibrary', 'tests'],
  [/^\/t\/([\w-]+)$/, () => import('./views/test.js'), 'render', 'tests'],
  [/^\/x\/(\w+)$/, () => import('./exam.js'), 'exam', null],
  [/^\/review\/(\w+)$/, () => import('./exam.js'), 'review', null],
  [/^\/r\/(\w+)$/, () => import('./views/results.js'), 'render', 'tests'],
  [/^\/mock\/(\w+)$/, () => import('./views/results.js'), 'renderMock', 'tests'],
  [/^\/learn$/, () => import('./views/learn.js'), 'render', 'learn'],
  [/^\/learn\/([\w-]+)$/, () => import('./views/learn.js'), 'renderSection', 'learn'],
  [/^\/learn\/([\w-]+)\/([\w-]+)$/, () => import('./views/learn.js'), 'renderItem', 'learn'],
  [/^\/progress$/, () => import('./views/progress.js'), 'render', 'progress'],
  [/^\/mistakes$/, () => import('./views/progress.js'), 'renderMistakes', 'mistakes'],
  [/^\/settings$/, () => import('./views/settings.js'), 'render', 'settings'],
];

let cleanup = null;

// Opened inside the Study Suite (../js/cbt.js): the suite's sidebar leads back, so no "Study Suite" link here,
// and the suite is told which page is showing and whether a test is running (it then hides its sidebar).
const EMBEDDED = (() => { try { return parent !== window && parent.location.origin === location.origin; } catch { return false; } })();
function report() {
  if (!EMBEDDED) return;
  parent.postMessage({ type: 'cbt-route', path: location.hash.replace(/^#/, '') || '/',
    exam: document.body.classList.contains('exam-mode'), title: document.title }, location.origin);
}
if (EMBEDDED) {
  document.documentElement.classList.add('embedded');
  new MutationObserver(report).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

function shell(active) {
  return `<header class="site-top"><div class="in">
      <a class="logo" href="#/"><span class="mark">IELTS</span><b>Test Centre</b></a>
      <nav class="site-nav">${NAV.map(([h, k, l]) => `<a href="${h}" class="${k === active ? 'active' : ''}">${l}</a>`).join('')}
        ${EMBEDDED ? '' : `<a href="../" title="Back to the Study Suite (Official Guide)">Study Suite ${icon('external-link')}</a>`}${fsButton('nav-fs')}</nav>
    </div></header><main class="page" id="page"></main>`;
}

async function route() {
  try { await show(); } finally { report(); }
}

async function show() {
  try { cleanup?.(); } catch (e) { console.warn(e); }
  cleanup = null;
  document.body.classList.remove('exam-mode');
  const path = location.hash.replace(/^#/, '') || '/';
  const app = $('#app');
  for (const [re, load, fn, nav] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    try {
      const mod = await load();
      if (fn === 'exam' || fn === 'review') {
        app.innerHTML = '';
        cleanup = (await mod.renderExam(app, m[1], { review: fn === 'review' })) || null;
      } else {
        app.innerHTML = shell(nav);
        cleanup = (await mod[fn]($('#page'), ...m.slice(1))) || null;
        window.scrollTo(0, 0);
      }
    } catch (e) {
      console.error(e);
      app.innerHTML = shell('') ;
      $('#page').innerHTML = `<div class="card"><h2>Something went wrong</h2><pre style="white-space:pre-wrap">${esc(e.stack || e)}</pre><a href="#/">Home</a></div>`;
    }
    return;
  }
  app.innerHTML = shell('');
  $('#page').innerHTML = `<div class="card"><h2>Page not found</h2><a href="#/">Go home</a></div>`;
}

function applyTheme() {
  const t = settings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

async function boot() {
  await initSync();     // progress saved on disk, if it is newer than this browser's copy
  applyTheme();
  onChange(applyTheme);
  try {
    await loadIndex();
  } catch (e) {
    $('#app').innerHTML = `<div class="page"><div class="card"><h2>Couldn't load the test data</h2>
      <p>Open the app through <b>Start IELTS Suite.command</b> (it runs a small local web server), then go to <code>http://localhost:8765/cbt/</code>.</p><pre>${esc(e)}</pre></div></div>`;
    return;
  }
  addEventListener('hashchange', route);
  route();
}
boot();
