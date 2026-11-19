import { $, esc, uid, toast, confirmBox, fmtDate } from '../util.js';
import { S, save } from '../store.js';
import { label } from '../data.js';
import { setChrome, crumbs } from '../chrome.js';
import { icon } from '../../cbt/js/icons.js';

// Leitner boxes: review intervals in days for box 0..5
const INTERVAL = [0, 1, 3, 7, 14, 30];
export const dueCards = () => S().vocab.filter((v) => (v.due || 0) <= Date.now());

export function render(view) {
  setChrome({ crumbs: '<b>Vocabulary</b>', actions: `<a class="btn sm primary" href="#/vocab/review">Review (${dueCards().length} due)</a>` });
  let filter = '';
  const draw = () => {
    const st = S();
    const list = st.vocab.filter((v) => !filter || (v.word + ' ' + v.meaning + ' ' + v.example).toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => b.ts - a.ts);
    $('#vlist', view).innerHTML = list.length ? `<table class="t"><thead><tr><th>Word / phrase</th><th>Meaning</th><th>Example</th><th>Box</th><th></th></tr></thead><tbody>
      ${list.map((v) => `<tr><td><b>${esc(v.word)}</b>${v.page != null ? ` <a href="#/page/${v.page}"><small>p. ${esc(label(v.page))}</small></a>` : ''}</td>
        <td>${esc(v.meaning)}</td><td><small>${esc(v.example)}</small></td><td><span class="pill">${v.box || 0}/5</span></td>
        <td><button class="btn sm ghost" data-del="${v.id}" title="Delete" aria-label="Delete">${icon('trash-2')}</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${st.vocab.length ? 'No matches.' : 'No words yet. Add words here or from the <b>Notes</b> panel while reading.'}</div>`;
  };
  view.innerHTML = `
    <h1>Vocabulary</h1>
    <p class="muted" style="margin-top:-4px">Collect useful words and phrases (Lexical Resource is 25% of Writing and Speaking). Review them with flashcards — words you know come back less often.</p>
    <form class="card row" id="add" style="margin-bottom:16px">
      <input type="text" name="word" placeholder="Word or phrase" required style="flex:1 1 160px">
      <input type="text" name="meaning" placeholder="Meaning" style="flex:2 1 200px">
      <input type="text" name="example" placeholder="Example sentence (optional)" style="flex:2 1 220px">
      <button class="btn primary">Add</button>
    </form>
    <div class="row" style="margin-bottom:10px"><input type="search" id="vf" placeholder="Filter…" style="max-width:280px"></div>
    <div class="card" id="vlist"></div>`;
  $('#add', view).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    S().vocab.push({ id: uid(), word: f.get('word').trim(), meaning: f.get('meaning').trim(), example: f.get('example').trim(), page: null, box: 0, due: Date.now(), ts: Date.now() });
    save(); e.target.reset(); e.target.word.focus(); draw();
  });
  $('#vf', view).addEventListener('input', (e) => { filter = e.target.value; draw(); });
  view.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d && await confirmBox('Delete this word?', 'Delete')) {
      const st = S(); st.vocab = st.vocab.filter((v) => v.id !== d.dataset.del); save(); draw();
    }
  });
  draw();
}

export function renderReview(view) {
  setChrome({ crumbs: crumbs('<a href="#/vocab">Vocabulary</a>', 'Review') });
  const queue = dueCards().sort(() => Math.random() - 0.5);
  let i = 0, shown = false, known = 0;
  const draw = () => {
    if (!queue.length) { view.innerHTML = `<div class="empty"><h2>Nothing due</h2><p>Add words or come back later.</p><a class="btn" href="#/vocab">Back to vocabulary</a></div>`; return; }
    if (i >= queue.length) {
      view.innerHTML = `<div class="empty"><h2>Review done</h2><p>You knew ${known} of ${queue.length}.</p><a class="btn primary" href="#/vocab">Back to vocabulary</a></div>`; return;
    }
    const v = queue[i];
    view.innerHTML = `
      <div style="max-width:560px;margin:0 auto">
        <div class="row between"><small>${i + 1} / ${queue.length}</small><small>Box ${v.box || 0}/5</small></div>
        <div class="card flash" id="card" style="margin:10px 0">
          <div>${esc(v.word)}${shown ? `<div class="back">${esc(v.meaning) || '<span class="muted">(no meaning saved)</span>'}${v.example ? `<div class="muted" style="font-size:15px;margin-top:8px"><i>${esc(v.example)}</i></div>` : ''}</div>` : '<div class="back muted">Click or press Space to reveal</div>'}</div>
        </div>
        ${shown ? `<div class="row" style="justify-content:center"><button class="btn lg" data-r="0">${icon('x')} Didn't know <kbd>1</kbd></button><button class="btn lg ok" data-r="1">${icon('check')} Knew it <kbd>2</kbd></button></div>` : ''}
      </div>`;
  };
  const answer = (ok) => {
    const v = queue[i];
    v.box = ok ? Math.min(5, (v.box || 0) + 1) : 0;
    v.due = Date.now() + INTERVAL[v.box] * 864e5 - 36e5; // an hour of slack
    if (ok) known++;
    save(); i++; shown = false; draw();
  };
  view.addEventListener('click', (e) => {
    const r = e.target.closest('[data-r]');
    if (r) return answer(r.dataset.r === '1');
    if (e.target.closest('#card')) { shown = true; draw(); }
  });
  const onKey = (e) => {
    if (e.code === 'Space') { e.preventDefault(); if (!shown) { shown = true; draw(); } }
    if (shown && e.key === '1') answer(false);
    if (shown && e.key === '2') answer(true);
  };
  document.addEventListener('keydown', onKey);
  draw();
  return () => document.removeEventListener('keydown', onKey);
}
