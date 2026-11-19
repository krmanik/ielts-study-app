// The Test Centre (cbt/) shown inside the Study Suite, so the sidebar stays. Route #/cbt/<path> keeps
// cbt/#/<path> in an iframe; the frame reports where it is (cbt/js/main.js, "embedded") and the address
// bar follows with replaceState, so the browser's back button steps through the Test Centre's own pages.
// While a test is running the sidebar and top bar are hidden: the test screen gets the whole window.
import { $, $$ } from './util.js';
import { setChrome } from './chrome.js';

export const CBT_RE = /^\/cbt(\/.*)?$/;
const frame = () => $('#cbt-frame');
const navKey = (path) => (path.startsWith('/learn') ? 'cbt-learn' : 'cbt');
const hashFor = (path) => '#/cbt' + (path === '/' ? '' : path);
let onRoute = null;
const baseTitle = document.title;

function mark(path) {
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey(path)));
}

/** Show the Test Centre at `path` (e.g. '/learn'). Reuses the frame if it is already open. */
export function show(view, path) {
  path = path || '/';
  mark(path);
  document.body.classList.add('cbt');
  const f = frame();
  if (f) {
    const w = f.contentWindow;
    // replace(), not hash =, so the move adds no extra history entry; absolute, since a relative URL would
    // be resolved against this page, not the frame's
    if (w && (w.location.hash.replace(/^#/, '') || '/') !== path) w.location.replace(w.location.href.split('#')[0] + '#' + path);
    return true;
  }
  setChrome({ crumbs: '<b>Test Centre</b>', wide: true });
  view.innerHTML = `<iframe id="cbt-frame" title="IELTS Test Centre" allow="fullscreen; microphone; autoplay" src="cbt/#${path}"></iframe>`;
  return false;
}

export function hide() {
  document.body.classList.remove('cbt', 'cbt-exam');
  document.title = baseTitle;
}

/** Listen for the frame's reports. `setHash(hash)` records the new address without routing again. */
export function init(setHash) {
  onRoute = setHash;
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'cbt-route' || e.source !== frame()?.contentWindow) return;
    const { path, exam, title } = e.data;
    document.body.classList.toggle('cbt-exam', !!exam);
    document.body.classList.remove('nav-open');
    mark(path);
    if (title) document.title = title;
    const h = hashFor(path);
    if (location.hash !== h) { history.replaceState(null, '', h); onRoute?.(h); }
  });
}
