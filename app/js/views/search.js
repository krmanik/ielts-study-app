import { $, esc, debounce } from '../util.js';
import { label, sectionForPage, MOD } from '../data.js';
import { setChrome } from '../chrome.js';

let INDEX = null;
async function loadIndex() {
  return (INDEX ||= fetch('data/search.json').then((r) => r.json()));
}
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'");

export async function render(view, { query }) {
  setChrome({ crumbs: '<b>Search the book</b>' });
  view.innerHTML = `
    <h1>Search the book</h1>
    <p class="muted" style="margin-top:-4px">Full-text search over all 398 pages (text recognised from the scan, so the odd word may be misspelt).</p>
    <input type="search" id="q" placeholder="e.g. paraphrase, Task 2 introduction, NOT GIVEN…" value="${esc(query.q || '')}" autofocus style="font-size:17px;padding:10px 14px">
    <div id="res" style="margin-top:16px"><p class="muted">Loading index…</p></div>`;
  const idx = await loadIndex();
  const res = $('#res', view);
  const run = () => {
    const q = $('#q', view).value.trim();
    history.replaceState(null, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (q.length < 2) { res.innerHTML = '<p class="muted">Type at least 2 characters.</p>'; return; }
    const terms = norm(q).split(/\s+/).filter(Boolean);
    const hits = [];
    for (const [p, lines] of idx) {
      const text = norm(lines.map((l) => l[0]).join(' '));
      if (!terms.every((t) => text.includes(t))) continue;
      const phrase = norm(q);
      const matchLines = lines.filter((l) => terms.some((t) => norm(l[0]).includes(t)));
      const score = (text.includes(phrase) ? 10 : 0) + matchLines.length;
      hits.push({ p, lines: matchLines.slice(0, 3), score });
    }
    hits.sort((a, b) => b.score - a.score || a.p - b.p);
    const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    res.innerHTML = hits.length ? `<p class="muted">${hits.length} page${hits.length > 1 ? 's' : ''}</p>` + hits.slice(0, 80).map((h) => {
      const s = sectionForPage(h.p);
      const l0 = h.lines[0];
      return `<a class="card flat" style="display:block;margin-bottom:8px;color:inherit;text-decoration:none" href="#/page/${h.p}?hl=${l0[1]},${l0[2]},${l0[3]},${l0[4]}">
        <div class="row between"><b>Page ${esc(label(h.p))}</b><small>${s ? `${MOD[s.module].title}${s.unitN ? ' ' + s.unitN : ''} · ${esc(s.title)}` : ''}</small></div>
        <div class="snippet" style="font-size:14px">${h.lines.map((l) => esc(l[0]).replace(re, '<mark>$1</mark>')).join(' … ')}</div></a>`;
    }).join('') : '<p class="muted">No results.</p>';
  };
  $('#q', view).addEventListener('input', debounce(run, 250));
  run();
}
