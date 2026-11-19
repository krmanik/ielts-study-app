import { $, esc, isTyping, toast, debounce, fmtTime, uid } from '../util.js';
import { S, save, settings, setSetting, isDone, setDone, visit, setLastPos } from '../store.js';
import { BOOK, MOD, byId, label, pages, nextSection, sectionForPage, TRACK } from '../data.js';
import { pagesHTML, mountPages, scrollToPage, highlight } from '../reader.js';
import { setChrome, crumbs } from '../chrome.js';
import { play, isListened, onPlayer } from '../player.js';
import { icon } from '../../cbt/js/icons.js';

/**
 * Shared reader shell. cfg: { list, title, bar (extra html), footer, noteKey(page), onPage(page),
 *   start: {page, y}, hl: {page,x,y,w,h}, keyAnchor, scriptAnchor, marks }
 */
export function readerShell(view, cfg) {
  view.innerHTML = `
    <div class="reader">
      <div class="reader-main" id="rm">
        <div class="reader-bar">${cfg.bar}</div>
        ${pagesHTML(cfg.list, { marks: cfg.marks })}
        ${cfg.footer || ''}
      </div>
      <aside class="side-panel hidden" id="sp"></aside>
    </div>`;
  const rm = $('#rm', view), sp = $('#sp', view);
  let curPage = cfg.list[0];
  const offPages = mountPages(rm, {
    onPage: (p) => { if (p !== curPage) { curPage = p; cfg.onPage?.(p); updateBookmark(); } },
  });

  // ---- side panel (answer key / script / notes)
  let panel = null, panelOff = null;
  function openPanel(kind, anchor) {
    panelOff?.(); panelOff = null;
    if (panel === kind && !anchor) { closePanel(); return; }
    panel = kind;
    sp.classList.remove('hidden');
    view.querySelectorAll('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === kind));
    if (kind === 'notes') return drawNotes();
    const a = anchor || (kind === 'key' ? cfg.keyAnchor : cfg.scriptAnchor);
    if (!a) { sp.innerHTML = `<div class="sp-head"><b class="grow">Nothing to show</b><button class="icon-btn" data-sp="close" aria-label="Close">${icon('x')}</button></div>`; return; }
    let from = a.page, to = Math.min(BOOK.pages - 1, a.page + 2);
    const draw = (scroll) => {
      sp.innerHTML = `<div class="sp-head"><b class="grow">${kind === 'key' ? 'Answer key' : 'Recording script'}</b>
          <button class="btn sm" data-sp="prev" title="Show an earlier page">${icon('chevron-up')} Earlier</button>
          <button class="btn sm" data-sp="next" title="Show a later page">${icon('chevron-down')} Later</button>
          <a class="btn sm" href="#/page/${a.page}?y=${a.y}" title="Open in the full book">Open</a>
          <button class="icon-btn" data-sp="close" title="Close panel" aria-label="Close panel">${icon('x')}</button></div>
        <div class="sp-body">${pagesHTML(pages(from, to), { hot: false, marks: { [a.page]: a.y + 0.012 } })}</div>`;
      const body = $('.sp-body', sp);
      panelOff = mountPages(body);
      if (scroll) scrollToPage(body, a.page, a.y);
    };
    draw(true);
    sp.onclick = (e) => {
      const b = e.target.closest('[data-sp]'); if (!b) return;
      if (b.dataset.sp === 'close') closePanel();
      if (b.dataset.sp === 'prev' && from > 0) { from--; draw(false); scrollToPage($('.sp-body', sp), from, 0); }
      if (b.dataset.sp === 'next' && to < BOOK.pages - 1) { to++; draw(false); scrollToPage($('.sp-body', sp), to, 0); }
    };
  }
  function closePanel() {
    panelOff?.(); panelOff = null; panel = null;
    sp.classList.add('hidden'); sp.innerHTML = '';
    view.querySelectorAll('[data-panel]').forEach((b) => b.classList.remove('on'));
  }
  function drawNotes() {
    const key = cfg.noteKey(curPage);
    const st = S();
    sp.innerHTML = `<div class="sp-head"><b class="grow">Notes <small>· ${esc(key.label)}</small></b>
        <button class="icon-btn" data-sp="close" aria-label="Close">${icon('x')}</button></div>
      <div class="sp-body" style="display:flex;flex-direction:column;background:var(--surface)">
        <textarea id="note" placeholder="Write anything: tips, answers you got wrong, useful phrases… (saved automatically)">${esc(st.notes[key.id] || '')}</textarea>
        <form id="qv" style="padding:12px;border-top:1px solid var(--border)" class="row">
          <input type="text" name="word" placeholder="New word or phrase" style="flex:1 1 140px" required>
          <input type="text" name="meaning" placeholder="Meaning" style="flex:2 1 180px">
          <button class="btn primary sm">Add to vocabulary</button>
        </form>
      </div>`;
    const ta = $('#note', sp);
    ta.addEventListener('input', debounce(() => {
      if (ta.value.trim()) st.notes[key.id] = ta.value; else delete st.notes[key.id];
      save();
    }, 300));
    $('#qv', sp).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      st.vocab.push({ id: uid(), word: f.get('word').trim(), meaning: f.get('meaning').trim(), example: '', page: curPage, box: 0, due: Date.now(), ts: Date.now() });
      save(); e.target.reset(); toast('Added to vocabulary');
    });
    sp.onclick = (e) => { if (e.target.closest('[data-sp=close]')) closePanel(); };
  }

  // ---- bar actions
  function updateBookmark() {
    const b = view.querySelector('[data-act=bookmark]');
    if (b) b.classList.toggle('on', S().bookmarks.some((x) => x.page === curPage));
  }
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-panel], [data-play]');
    if (!b) return;
    if (b.dataset.panel) openPanel(b.dataset.panel);
    if (b.dataset.play) play(Number(b.dataset.play));
    const a = b.dataset.act;
    if (a === 'zoom-in' || a === 'zoom-out') {
      const z = Math.max(520, Math.min(1500, (settings().zoom || 860) + (a === 'zoom-in' ? 120 : -120)));
      setSetting('zoom', z);
      setTimeout(() => scrollToPage(rm, curPage, 0), 50);
    }
    if (a === 'focus') document.body.classList.toggle('focus');
    if (a === 'bookmark') {
      const st = S(), i = st.bookmarks.findIndex((x) => x.page === curPage);
      if (i >= 0) { st.bookmarks.splice(i, 1); toast('Bookmark removed'); }
      else { st.bookmarks.push({ page: curPage, label: cfg.title, ts: Date.now() }); toast(`Bookmarked page ${label(curPage)}`); }
      save(); updateBookmark();
    }
    cfg.onAction?.(a, b);
  });
  const onKey = (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') {
      const i = cfg.list.indexOf(curPage) + (k === 'j' ? 1 : -1);
      if (cfg.list[i] != null) scrollToPage(rm, cfg.list[i], 0, true);
    }
    if (k === 'f') document.body.classList.toggle('focus');
  };
  document.addEventListener('keydown', onKey);
  const onScript = (e) => { if (e.detail?.script) openPanel('script', e.detail.script); };
  window.addEventListener('open-script', onScript);

  // ---- initial position
  requestAnimationFrame(() => {
    if (cfg.start) scrollToPage(rm, cfg.start.page, cfg.start.y || 0);
    if (cfg.hl) setTimeout(() => highlight(rm, cfg.hl), 200);
  });
  return {
    rm, openPanel, get page() { return curPage; },
    cleanup() { offPages(); panelOff?.(); document.removeEventListener('keydown', onKey); window.removeEventListener('open-script', onScript); },
  };
}

const zoomBtns = `<button class="btn sm ghost" data-act="zoom-out" title="Smaller pages">−</button><button class="btn sm ghost" data-act="zoom-in" title="Bigger pages">+</button>`;
export const toolBtns = (hasKey, hasScript) => `
  ${hasKey ? `<button class="btn sm" data-panel="key" title="Show the answer key beside the pages">Answers</button>` : ''}
  ${hasScript ? `<button class="btn sm" data-panel="script" title="Show the recording script beside the pages">Script</button>` : ''}
  <button class="btn sm" data-panel="notes" title="Notes and quick vocabulary">Notes</button>
  <button class="btn sm" data-act="bookmark" title="Bookmark this page" aria-label="Bookmark this page">${icon('bookmark')}</button>
  ${zoomBtns}
  <button class="btn sm ghost" data-act="focus" title="Focus mode (F): hide the sidebar" aria-label="Focus mode">${icon('maximize-2')}</button>`;

// ================================================================ section reader
export function renderSection(view, { params: [id], query }) {
  const s = byId[id];
  if (!s || !s.start && s.start !== 0) { view.innerHTML = '<div class="empty">Section not found</div>'; return; }
  const u = byId[s.unit], c = MOD[s.module].color;
  const prev = nextSection(id, -1), next = nextSection(id, 1);
  visit(id);
  setChrome({
    wide: true,
    crumbs: crumbs('<a href="#/learn">Study path</a>', `<a href="#/unit/${u.id}">${esc(MOD[s.module].title)}${u.n ? ' ' + u.n : ''}</a>`, esc(s.title)),
    actions: `${prev ? `<a class="btn sm ghost" href="#/s/${prev.id}" title="Previous section">${icon('chevron-left')} Prev</a>` : ''}${next ? `<a class="btn sm ghost" href="#/s/${next.id}" title="Next section">Next ${icon('chevron-right')}</a>` : ''}`,
  });
  const list = pages(s.start, s.end);
  const trackChips = () => s.tracks.map((n) => `<button class="track-chip ${isListened(n) ? 'done' : ''}" data-play="${n}" title="${esc(TRACK[n].title)} · ${fmtTime(TRACK[n].dur)}">${icon('play')} ${n}</button>`).join('');
  const doneBtn = () => `<button class="btn sm ${isDone(id) ? 'ok' : ''}" data-act="done">${isDone(id) ? `${icon('check')} Done` : 'Mark done'}</button>`;
  const midPage = s.idx > 0 && s.y && s.y > 0.15;
  let start = { page: s.start, y: midPage ? s.y - 0.02 : 0 };
  if (query.y === 'resume' && S().lastPos?.route === `/s/${id}`) start = { page: S().lastPos.page, y: 0 };
  const marks = midPage ? { [s.start]: s.y - 0.01 } : {};
  // mark where the next section begins if it shares our last page
  if (next && next.start === s.end && next.y > 0.15 && next.unit === s.unit) marks[s.end] = next.y - 0.01;

  const r = readerShell(view, {
    list, title: s.title, marks, start,
    keyAnchor: s.key, scriptAnchor: s.script || (s.tracks[0] && TRACK[s.tracks[0]].script),
    bar: `<span class="mod-dot" style="--c:${c}"></span>
      <span class="title">${esc(s.title)} <small>· ${esc(u.title)}${u.n ? ` · ${s.idx + 1}/${u.sections.length}` : ''}</small></span>
      <span id="chips">${trackChips()}</span>
      ${toolBtns(!!s.key, !!(s.script || s.tracks.length))}
      <span id="donewrap">${doneBtn()}</span>`,
    footer: `<div style="max-width:var(--page-w,860px);margin:0 auto 40px;padding:0 12px">
      <div class="card row between">
        <div><b>${isDone(id) ? 'Section complete.' : 'Finished this section?'}</b><div><small>${next ? `Next: ${esc(next.title)}` : 'This is the last section on your path.'}</small></div></div>
        <div class="row">${s.key ? `<button class="btn" data-panel="key">Check answers</button>` : ''}
        <button class="btn primary" data-act="done-next">${next ? `Mark done &amp; continue ${icon('arrow-right')}` : 'Mark done'}</button></div>
      </div></div>`,
    noteKey: () => ({ id, label: s.title }),
    onPage: (p) => setLastPos({ route: `/s/${id}`, title: s.title, page: p }),
    onAction: (a) => {
      if (a === 'done') { setDone(id, !isDone(id)); $('#donewrap', view).innerHTML = doneBtn(); }
      if (a === 'done-next') { setDone(id, true); toast('Section complete'); location.hash = next ? `#/s/${next.id}` : `#/unit/${u.id}`; }
    },
  });
  setLastPos({ route: `/s/${id}`, title: s.title, page: start.page });
  const off = onPlayer(() => { const el = $('#chips', view); if (el) el.innerHTML = trackChips(); });
  return () => { r.cleanup(); off(); };
}

// ================================================================ whole book
export function renderBook(view, { params: [n], query }) {
  const p0 = n != null ? Math.min(BOOK.pages - 1, Number(n)) : (S().lastPos?.route === '/book' ? S().lastPos.page : 0);
  const secOf = (p) => sectionForPage(p);
  setChrome({ wide: true, crumbs: crumbs('<b>Whole book</b>') });
  const list = pages(0, BOOK.pages - 1);
  const hl = query.hl ? (([x, y, w, h]) => ({ page: p0, x, y, w, h }))(query.hl.split(',').map(Number)) : null;
  const y = query.y ? Number(query.y) : 0;
  const r = readerShell(view, {
    list, title: 'Whole book', start: { page: p0, y: hl ? Math.max(0, hl.y - 0.1) : y },
    hl, marks: query.y && !hl ? { [p0]: y + 0.015 } : {},
    bar: `<span class="title">Page <b id="cur-label">${esc(label(p0))}</b> <small id="cur-sec"></small></span>
      <form id="goto" class="row" style="gap:4px"><input type="text" name="p" placeholder="Go to page…" style="width:120px;padding:4px 8px"><button class="btn sm">Go</button></form>
      ${toolBtns(false, false)}`,
    noteKey: (p) => ({ id: 'p' + p, label: 'page ' + label(p) }),
    onPage: (p) => {
      $('#cur-label', view).textContent = label(p);
      const s = secOf(p);
      $('#cur-sec', view).innerHTML = s ? `· <a href="#/s/${s.id}">${esc(MOD[s.module].title)} ${s.unitN || ''} — ${esc(s.title)}</a>` : '';
      setLastPos({ route: '/book', title: 'Whole book', page: p });
    },
  });
  $('#goto', view).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = new FormData(e.target).get('p').trim();
    let idx = BOOK.labels.indexOf(v);
    if (idx < 0 && /^\d+$/.test(v)) {
      const num = Number(v);
      if (num >= 255 && num <= 258) { toast(BOOK.missing.note, 4000); return; }
      idx = BOOK.labels.findIndex((l) => Number(l) >= num);
    }
    if (idx >= 0) scrollToPage(r.rm, idx, 0, true); else toast('No such page');
  });
  return () => r.cleanup();
}
