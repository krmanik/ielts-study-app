// The test screen on a narrow display. The screen itself is ../exam.js, unchanged; while the window is
// narrower than 860px (the same width at which cbt.css stops putting the panes side by side) the two
// panes (text | questions) become one pane and a switch, and the layout follows the on-screen keyboard.
// On a wide window none of that applies and the screen is the Mac's. The display is kept awake either way.
import { $ } from '../util.js';

export function phoneExam(app) {
  const root = $('.exam', app);
  if (!root) return () => {};
  const main = $('.x-main', root);
  const tog = document.createElement('div');
  tog.className = 'm-toggle';
  tog.hidden = true;
  root.appendChild(tog);
  let pane = 'l', kind = '';
  const narrow = matchMedia('(max-width: 860px)');

  const apply = () => {
    const body = $('.x-body', main), left = $('#pane-l', main);
    const two = !!(narrow.matches && body && left && !body.classList.contains('single'));
    tog.hidden = !two;
    root.classList.toggle('m-two', two);
    if (!two) return;
    const k = $('.wpanel', main) ? 'W' : $('.script-pane', main) ? 'T' : 'R';
    // start on the text — except when looking back over answers, which starts from the questions
    if (k !== kind) { kind = k; pane = k === 'T' || $('.x-nav .submit.review', root) ? 'q' : 'l'; }
    root.dataset.pane = pane;
    const names = { R: ['Text', 'Questions'], W: ['Task', 'Write'], T: ['Script', 'Questions'] }[k];
    tog.innerHTML = `<button type="button" data-pane="l" class="${pane === 'l' ? 'on' : ''}">${names[0]}</button><button type="button" data-pane="q" class="${pane === 'q' ? 'on' : ''}">${names[1]}</button>`;
  };
  const show = (p) => { pane = p; apply(); };

  // the screen re-renders its main area on every change of part
  const mo = new MutationObserver(apply);
  mo.observe(main, { childList: true });
  apply();

  // before the screen's own handler runs: a question number or an arrow leads to the questions,
  // a tap on another part's tab to its text
  root.addEventListener('click', (e) => {
    const b = e.target.closest('.m-toggle [data-pane]');
    if (b) { show(b.dataset.pane); return; }
    if (!root.classList.contains('m-two')) return;
    if (e.target.closest('.num[data-q]') || (kind !== 'W' && e.target.closest('[data-act="prev"], [data-act="next"]'))) show('q');
    else if (e.target.closest('.x-part[data-part]:not(.active)') || (kind === 'W' && e.target.closest('[data-act="prev"], [data-act="next"]'))) show('l');
  }, true);

  // keep the header and the answer box in view while the keyboard is up
  const vv = window.visualViewport;
  const fit = () => {
    root.style.height = narrow.matches ? vv.height + 'px' : '';
    root.style.top = narrow.matches ? vv.offsetTop + 'px' : '';
    root.classList.toggle('kb', narrow.matches && vv.height < innerHeight - 140);
  };
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
  const resized = () => { apply(); if (vv) fit(); };
  narrow.addEventListener('change', resized);

  let lock = null;
  const awake = async () => {
    if (document.visibilityState !== 'visible') return;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* low battery, or not allowed */ }
  };
  awake();
  document.addEventListener('visibilitychange', awake);

  return () => {
    mo.disconnect();
    narrow.removeEventListener('change', resized);
    if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
    document.removeEventListener('visibilitychange', awake);
    lock?.release?.().catch(() => {});
  };
}
