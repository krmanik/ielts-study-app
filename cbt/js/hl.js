// Text highlighting + notes, like the computer-delivered IELTS: select text, then right-click (or use the
// pop-up that appears) and choose Highlight or Note; right-click a highlight to clear it or all of them.
// Highlights are stored as character offsets inside a "zone" element ([data-hz]), so they survive reloads.
import { esc, modal } from './util.js';

const SKIP = '.no-hl, input, textarea, button, select';

function nodes(zone) {
  const out = [];
  const w = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
  return out;
}

function offsetOf(zone, container, off) {
  const list = nodes(zone);
  if (container.nodeType === 3) {
    let t = 0;
    for (const n of list) { if (n === container) return t + off; t += n.length; }
    // the point is inside a skipped element (e.g. a button): fall back to its boundary
    off = [...container.parentNode.childNodes].indexOf(container);
    container = container.parentNode;
  }
  const r = document.createRange();
  r.setStart(zone, 0);
  r.setEnd(container, off);
  let t = 0;
  for (const n of list) {
    if (r.comparePoint(n, n.length) === 0) t += n.length;
    else break;
  }
  return t;
}

function wrap(zone, start, end, idx, note) {
  let pos = 0;
  for (const n of nodes(zone)) {
    const a = pos, b = pos + n.length;
    pos = b;
    if (b <= start || a >= end) continue;
    let node = n;
    const s = Math.max(start, a) - a, e = Math.min(end, b) - a;
    if (e < node.length) node.splitText(e);
    if (s > 0) node = node.splitText(s);
    if (!node.textContent.trim()) continue;
    const m = document.createElement('mark');
    m.className = 'hl' + (note ? ' has-note' : '');
    m.dataset.i = idx;
    if (note) m.title = note;
    node.parentNode.insertBefore(m, node);
    m.appendChild(node);
  }
}

export function clearMarks(zone) {
  zone.querySelectorAll('mark.hl').forEach((m) => {
    m.replaceWith(...m.childNodes);
  });
  zone.normalize();
}

export function paint(zone, ranges = []) {
  clearMarks(zone);
  ranges.forEach(([s, e, note], i) => wrap(zone, s, e, i, note));
}

/**
 * Enable highlighting under `root`. `get(zoneId)` returns the stored ranges, `set(zoneId, ranges)` saves them.
 * Returns a cleanup function.
 */
export function enableHighlighting(root, { get, set }) {
  let pop = null;
  const hide = () => { pop?.remove(); pop = null; };
  const show = (rect, html, onClick) => {
    hide();
    pop = document.createElement('div');
    pop.className = 'hl-pop no-hl';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    const x = Math.min(innerWidth - pop.offsetWidth - 8, Math.max(8, rect.left + rect.width / 2 - pop.offsetWidth / 2));
    const y = rect.top > 60 ? rect.top - pop.offsetHeight - 8 : rect.bottom + 8;
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) { onClick(b.dataset.a); hide(); } });
  };

  const save = (zone, ranges) => {
    ranges.sort((a, b) => a[0] - b[0]);
    set(zone.dataset.hz, ranges);
    paint(zone, ranges);
  };

  /** Offer Highlight / Note for the current selection. `at` = where to put the menu (defaults to the selection). */
  const offer = (at) => {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return false;
      const r = sel.getRangeAt(0);
      const zone = (r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentElement : r.commonAncestorContainer).closest('[data-hz]');
      if (!zone || !root.contains(zone)) return false;
      const s = offsetOf(zone, r.startContainer, r.startOffset), en = offsetOf(zone, r.endContainer, r.endOffset);
      if (en - s < 1) return false;
      show(at || r.getBoundingClientRect(), `<button data-a="hl">Highlight</button><button data-a="note">Note…</button>`, async (a) => {
        let ranges = (get(zone.dataset.hz) || []).filter(([a0, b0]) => b0 <= s || a0 >= en); // replace overlaps
        let note = '';
        if (a === 'note') {
          note = await askNote('');
          if (note == null) return;
        }
        ranges.push(note ? [s, en, note] : [s, en]);
        sel.removeAllRanges();
        save(zone, ranges);
      });
      return true;
  };
  const onUp = (e) => {
    if (e.target.closest('.hl-pop') || e.button === 2) return;
    setTimeout(() => offer(), 0);
  };
  const markMenu = (m) => {
    const zone = m.closest('[data-hz]');
    const i = +m.dataset.i;
    const ranges = get(zone.dataset.hz) || [];
    const cur = ranges[i];
    if (!cur) return;
    show(m.getBoundingClientRect(), `${cur[2] ? `<span class="note-text">${esc(cur[2])}</span>` : ''}<button data-a="note">${cur[2] ? 'Edit note' : 'Add note'}</button><button data-a="rm">Clear</button><button data-a="all">Clear all</button>`, async (a) => {
      if (a === 'rm') ranges.splice(i, 1);
      if (a === 'all') ranges.length = 0;
      if (a === 'note') {
        const n = await askNote(cur[2] || '');
        if (n == null) return;
        cur[2] = n || undefined;
        if (!n) cur.length = 2;
      }
      save(zone, ranges);
    });
  };
  // right-click, as in the test: on a selection -> Highlight / Note; on a highlight -> Clear / Clear all
  const onContext = (e) => {
    if (e.target.closest('input, textarea')) return;
    const at = { left: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 };
    const m = e.target.closest('mark.hl');
    if (getSelection().isCollapsed && m && root.contains(m)) { e.preventDefault(); markMenu(m); return; }
    if (offer(at)) e.preventDefault();
  };
  const onClick = (e) => {
    const m = e.target.closest('mark.hl');
    if (!m || !root.contains(m) || !getSelection().isCollapsed) return;
    markMenu(m);
  };
  const onDown = (e) => { if (!e.target.closest('.hl-pop') && e.button !== 2) hide(); };
  root.addEventListener('mouseup', onUp);
  root.addEventListener('touchend', onUp);
  root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', onContext);
  document.addEventListener('mousedown', onDown);
  const onScroll = () => hide();
  root.addEventListener('scroll', onScroll, true);
  return () => {
    hide();
    root.removeEventListener('mouseup', onUp);
    root.removeEventListener('touchend', onUp);
    root.removeEventListener('click', onClick);
    root.removeEventListener('contextmenu', onContext);
    root.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('mousedown', onDown);
  };
}

async function askNote(value) {
  let text = value;
  const r = await modal(`<h2>Note</h2><textarea id="note-in" rows="4" style="width:100%">${esc(value)}</textarea>
    <div class="actions"><button class="btn" data-close="">Cancel</button><button class="btn primary" data-close="ok">Save note</button></div>`,
  { onMount: (d) => { const t = d.querySelector('textarea'); t.focus(); t.addEventListener('input', () => (text = t.value)); } });
  return r === 'ok' ? text.trim() : null;
}
