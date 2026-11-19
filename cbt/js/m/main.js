// The phone screen of the Test Centre (../../m.html). Same tests, same progress and the same test screen
// as on the Mac; only the pages around it are laid out for a phone, and the app can be kept offline.
import { $, esc, toast } from '../util.js';
import { loadIndex } from '../data.js';
import { settings, onChange, initSync, onSync, syncStatus, STATIC } from '../store.js';
import { sendRecordings } from '../rec.js';
import { initOffline, onOffline } from './offline.js';
import { phoneExam } from './exam.js';
import { icon } from '../icons.js';

const ICON = { home: 'house', tests: 'file-text', learn: 'graduation-cap', progress: 'chart-line', more: 'ellipsis' };
const TABS = [['#/', 'home', 'Today'], ['#/tests', 'tests', 'Tests'], ['#/learn', 'learn', 'Learn'], ['#/progress', 'progress', 'Progress'], ['#/more', 'more', 'More']];

const ROUTES = [
  [/^\/?$/, () => import('./home.js'), 'render', 'home'],
  [/^\/tests$/, () => import('./tests.js'), 'renderList', 'tests'],
  [/^\/t\/([\w-]+)$/, () => import('./tests.js'), 'renderTest', 'tests'],
  [/^\/x\/(\w+)$/, () => import('../exam.js'), 'exam', null],
  [/^\/review\/(\w+)$/, () => import('../exam.js'), 'review', null],
  [/^\/r\/(\w+)$/, () => import('../views/results.js'), 'render', 'tests'],
  [/^\/mock\/(\w+)$/, () => import('../views/results.js'), 'renderMock', 'tests'],
  [/^\/learn$/, () => import('../views/learn.js'), 'render', 'learn'],
  [/^\/learn\/([\w-]+)$/, () => import('../views/learn.js'), 'renderSection', 'learn'],
  [/^\/learn\/([\w-]+)\/([\w-]+)$/, () => import('../views/learn.js'), 'renderItem', 'learn'],
  [/^\/progress$/, () => import('../views/progress.js'), 'render', 'progress'],
  [/^\/mistakes$/, () => import('../views/progress.js'), 'renderMistakes', 'more'],
  [/^\/(more|settings)$/, () => import('./more.js'), 'render', 'more'],
];

let cleanup = null;
let inTest = false;

function shell(active) {
  // the bar sits at the bottom on a phone and along the top on a wide screen (css/m.css)
  return `<nav class="m-tabs" aria-label="Sections"><a class="m-brand" href="#/"><i>IELTS</i><b>Test Centre</b></a>${TABS.map(([h, k, l]) => `<a href="${h}" class="${k === active ? 'active' : ''}"${k === active ? ' aria-current="page"' : ''}>
      ${icon(ICON[k])}${l}</a>`).join('')}</nav>
    <main class="page m-page" id="page"></main>`;
}

async function route() {
  try { cleanup?.(); } catch (e) { console.warn(e); }
  cleanup = null;
  inTest = false;
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
        inTest = true;
        const done = (await mod.renderExam(app, m[1], { review: fn === 'review' })) || null;
        const off = phoneExam(app);
        cleanup = () => { off(); done?.(); };
      } else {
        app.innerHTML = shell(nav);
        cleanup = (await mod[fn]($('#page'), ...m.slice(1))) || null;
        window.scrollTo(0, 0);
      }
    } catch (e) {
      console.error(e);
      app.innerHTML = shell('');
      $('#page').innerHTML = `<div class="card"><h2>Something went wrong</h2><pre style="white-space:pre-wrap">${esc(e.stack || e)}</pre><a href="#/">Back to Today</a></div>`;
    }
    return;
  }
  app.innerHTML = shell('');
  $('#page').innerHTML = `<div class="card"><h2>Page not found</h2><a href="#/">Back to Today</a></div>`;
}

function applyTheme() {
  const t = settings().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

async function boot() {
  applyTheme();
  onChange(applyTheme);
  await initOffline();
  try {
    await loadIndex();
  } catch (e) {
    $('#app').innerHTML = `<div class="page m-page"><div class="card"><h2>Couldn't load the tests</h2>
      <p>${STATIC ? 'There is no connection and the app has not been saved on this device yet. Open it once while you are online.'
    : 'Your Mac is out of reach and the app has not been saved on this device yet. Open it once while the Mac is on and on the same Wi-Fi.'}</p><pre>${esc(e)}</pre></div></div>`;
    return;
  }
  addEventListener('hashchange', route);
  route();
  // The copy on the Mac is merged in the background: the app must open at once even when the Mac is far away.
  let recsSent = 0;
  onSync(() => {
    if (syncStatus().online && Date.now() - recsSent > 60000) { recsSent = Date.now(); sendRecordings(); }
  });
  initSync();
  onOffline((what) => {
    if (what !== 'updated') return;
    if (inTest) toast('A newer version of the app is ready — it is used the next time you open the app.', 4000);
    else location.reload();
  });
}
boot();
