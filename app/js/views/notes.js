import { esc, fmtDate, confirmBox } from '../util.js';
import { S, save } from '../store.js';
import { byId, label, TEST } from '../data.js';
import { setChrome } from '../chrome.js';
import { icon } from '../../cbt/js/icons.js';

export function render(view) {
  setChrome({ crumbs: '<b>Notes &amp; bookmarks</b>' });
  const draw = () => {
    const st = S();
    const notes = Object.entries(st.notes);
    const where = (k) => {
      if (k.startsWith('p')) return { title: `Page ${label(Number(k.slice(1)))}`, href: `#/page/${k.slice(1)}` };
      if (byId[k]) return { title: byId[k].title, href: `#/s/${k}` };
      const [tid, part] = k.split('/');
      if (TEST[tid]) return { title: `${TEST[tid].title} · ${part}`, href: `#/test/${tid}/study/${part}` };
      return { title: k, href: '#/' };
    };
    view.innerHTML = `
      <h1>Notes &amp; bookmarks</h1>
      <div class="grid g2">
        <div class="card"><h2>Bookmarks</h2>
          ${st.bookmarks.length ? `<ul class="list-plain">${[...st.bookmarks].sort((a, b) => a.page - b.page).map((b) => `
            <li class="row between"><a href="#/page/${b.page}"><b>p. ${esc(label(b.page))}</b> <small>${esc(b.label || '')}</small></a>
            <button class="btn sm ghost" data-unmark="${b.page}" aria-label="Remove bookmark">${icon('x')}</button></li>`).join('')}</ul>`
            : `<p class="muted">Use ${icon('bookmark')} in the reader toolbar to bookmark a page.</p>`}
        </div>
        <div class="card"><h2>Notes</h2>
          ${notes.length ? `<ul class="list-plain">${notes.map(([k, v]) => { const w = where(k); return `
            <li><div class="row between"><a href="${w.href}"><b>${esc(w.title)}</b></a><button class="btn sm ghost" data-delnote="${esc(k)}" aria-label="Delete note">${icon('trash-2')}</button></div>
            <div style="white-space:pre-wrap;font-size:14px">${esc(v)}</div></li>`; }).join('')}</ul>`
            : '<p class="muted">Open <b>Notes</b> in the reader toolbar to write notes for a section or page.</p>'}
        </div>
      </div>`;
  };
  view.addEventListener('click', async (e) => {
    const st = S();
    const u = e.target.closest('[data-unmark]');
    if (u) { st.bookmarks = st.bookmarks.filter((b) => b.page !== Number(u.dataset.unmark)); save(); draw(); }
    const d = e.target.closest('[data-delnote]');
    if (d && await confirmBox('Delete this note?', 'Delete')) { delete st.notes[d.dataset.delnote]; save(); draw(); }
  });
  draw();
}
