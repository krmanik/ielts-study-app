// Full screen: hides the browser's tabs, address bar and other windows so only the test is on screen.
// Any button with [data-fs] toggles it (see fsButton); the "Start tests in full screen" setting enters it on the first click.
import { settings } from './store.js';

const doc = document, el = doc.documentElement;
export const fsSupported = !!(el.requestFullscreen || el.webkitRequestFullscreen);
export const isFs = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);

export async function enterFs() {
  if (!fsSupported || isFs()) return;
  try {
    await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
    // Chrome: Esc is sent to the page first, so it can close a dialog without leaving full screen (see onKey)
    navigator.keyboard?.lock?.(['Escape']).catch(() => {});
  } catch (e) { console.warn('full screen refused', e); }
}
export function exitFs() {
  if (!isFs()) return;
  navigator.keyboard?.unlock?.();
  (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
}
export const toggleFs = () => (isFs() ? exitFs() : enterFs());

const ICON = {
  enter: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  exit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const inner = () => (isFs()
  ? `${ICON.exit} <span class="lbl">Exit full screen</span>`
  : `${ICON.enter} <span class="lbl">Full screen</span>`);
const title = () => (isFs() ? 'Leave full screen' : 'Full screen — hides the browser tabs and toolbars');

/** Markup for a full-screen toggle (empty where the browser cannot do it, e.g. iPhone). */
export function fsButton(cls = 'tbtn') {
  return fsSupported ? `<button type="button" class="${cls}" data-fs title="${title()}">${inner()}</button>` : '';
}

/** In a test: go full screen on the first click, if the setting asks for it. Returns a function that stops listening. */
export function autoFs(root) {
  let done = false;
  const go = (e) => {
    if (done || isFs() || !settings().fullscreen || e.target.closest?.('[data-fs], .fs-opt')) return;
    done = true;
    enterFs();
  };
  root.addEventListener('pointerdown', go);
  return () => root.removeEventListener('pointerdown', go);
}

function sync() {
  doc.body.classList.toggle('is-fs', isFs());
  doc.querySelectorAll('[data-fs]').forEach((b) => { b.innerHTML = inner(); b.title = title(); });
}
doc.addEventListener('click', (e) => { if (e.target.closest?.('[data-fs]')) toggleFs(); });
doc.addEventListener('fullscreenchange', sync);
doc.addEventListener('webkitfullscreenchange', sync);
// with Esc locked (Chrome) the page decides: a dialog closes first, otherwise Esc leaves full screen as usual
doc.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isFs() && !e.defaultPrevented && doc.querySelector('#modal')?.hidden !== false) exitFs();
});
