// Renders runs of book pages (pre-rendered JPEGs) with clickable audio badges and highlights.
import { esc } from './util.js';
import { BOOK, label, pageTracks, TRACK } from './data.js';
import { onPlayer, play, state as playerState } from './player.js';
import { icon } from '../cbt/js/icons.js';

const pad = (p) => String(p).padStart(3, '0');
export const pageSrc = (p) => `pages/p${pad(p)}.jpg`;

/** HTML for a list of page indices. opts: { hot: bool, marks: {page: y} } */
export function pagesHTML(list, opts = {}) {
  const hot = opts.hot !== false;
  let prev = null, out = '';
  for (const p of list) {
    if (prev != null && p === BOOK.missing.after + 1 && prev === BOOK.missing.after) {
      out += `<div class="gap-note notice">${icon('triangle-alert')} ${esc(BOOK.missing.note)}</div>`;
    }
    const hs = hot ? (pageTracks[p] || []).map((t) =>
      `<button class="hot" data-track="${t.n}" style="left:${t.x * 100}%;top:${t.y * 100}%" title="Play track ${t.n}: ${esc(TRACK[t.n].title)}"></button>`).join('') : '';
    const mark = opts.marks?.[p] != null ? `<div class="mark" style="top:${opts.marks[p] * 100}%"></div>` : '';
    out += `<div class="page" data-page="${p}"><img loading="lazy" src="${pageSrc(p)}" alt="Book page ${esc(label(p))}" width="1391" height="1817">
      <span class="plabel">p. ${esc(label(p))}</span>${hs}${mark}</div>`;
    prev = p;
  }
  return `<div class="pages">${out}</div>`;
}

/**
 * Wire up a scroll container holding pagesHTML output.
 * opts: { onPage(p) } — called with the page most in view.
 * Returns cleanup fn.
 */
export function mountPages(scroller, opts = {}) {
  const onClick = (e) => {
    const b = e.target.closest('.hot');
    if (b) { e.preventDefault(); play(Number(b.dataset.track)); }
  };
  scroller.addEventListener('click', onClick);
  const sync = (st) => {
    scroller.querySelectorAll('.hot').forEach((h) => h.classList.toggle('playing', st.playing && Number(h.dataset.track) === st.n));
  };
  sync(playerState());
  const off = onPlayer(sync);

  let io = null;
  if (opts.onPage) {
    const vis = new Map();
    io = new IntersectionObserver((ents) => {
      ents.forEach((en) => vis.set(Number(en.target.dataset.page), en.intersectionRatio));
      let best = null, br = 0;
      vis.forEach((r, p) => { if (r > br) { br = r; best = p; } });
      if (best != null) opts.onPage(best);
    }, { root: scroller.matches('.reader-main, .sp-body') ? scroller : null, threshold: [0, 0.25, 0.5, 0.75, 1] });
    scroller.querySelectorAll('.page').forEach((el) => io.observe(el));
  }
  return () => { scroller.removeEventListener('click', onClick); off(); io?.disconnect(); };
}

/** Scroll so that vertical fraction y of page p is near the top of the scroller. */
export function scrollToPage(scroller, p, y = 0, smooth = false) {
  const el = scroller.querySelector(`.page[data-page="${p}"]`);
  if (!el) return;
  const go = () => {
    const behavior = smooth ? 'smooth' : 'instant';
    // on narrow screens the reader scrolls with the window instead of its own container
    const own = scroller.scrollHeight > scroller.clientHeight + 4 && getComputedStyle(scroller).overflowY !== 'visible';
    if (own) {
      const bar = scroller.querySelector('.reader-bar')?.offsetHeight || 0;
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + el.offsetHeight * y - bar - 8;
      scroller.scrollTo({ top: Math.max(0, top), behavior });
    } else {
      const top = el.getBoundingClientRect().top + window.scrollY + el.offsetHeight * y - 70;
      window.scrollTo({ top: Math.max(0, top), behavior });
    }
  };
  go();
  // images above may not have laid out yet; re-align once they have
  setTimeout(go, 120);
}

/** Highlight a box on a page: {page, x, y, w, h} in page fractions. */
export function highlight(scroller, b) {
  const el = scroller.querySelector(`.page[data-page="${b.page}"]`);
  if (!el) return;
  const d = document.createElement('div');
  d.className = 'hl';
  Object.assign(d.style, { left: (b.x - 0.005) * 100 + '%', top: (b.y - 0.003) * 100 + '%', width: (b.w + 0.01) * 100 + '%', height: (b.h + 0.006) * 100 + '%' });
  el.appendChild(d);
}
