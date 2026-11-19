// All tests, and one test: pick a part (or the whole section), save it for offline use, see earlier attempts.
import { $, esc, fmtDateTime, toast, confirmBox } from '../util.js';
import { books, loadTest, testInfo, testName } from '../data.js';
import { attemptsFor, deleteAttempt, syncStatus } from '../store.js';
import { startTest, FULL, partsDone, attemptBand, isFull } from '../actions.js';
import { fmtBand } from '../mark.js';
import { scopeText } from '../views/home.js';
import { resultText } from '../views/test.js';
import { offlineOK, isSaved, verify, saveTest, removeTest, testBytes, fmtMB, onOffline } from './offline.js';
import { skBadge, chevron, SKILL, LOCAL, PART_WORD, STATIC, inReach } from './ui.js';
import { icon } from '../icons.js';

const SKILLS = ['L', 'R', 'W', 'S'];

/** Best band of a skill of a test, and whether every part of it is done. */
function skillState(id, s) {
  const got = partsDone(id, s);
  const n = FULL[s].filter((p) => got[p]).length;
  if (!n) return { cls: '', text: s };
  const full = Object.values(got).filter(isFull).at(-1);
  const band = full ? attemptBand(full) : null;
  return { cls: n === FULL[s].length ? ' done' : ' part', text: band != null ? fmtBand(band) : n === FULL[s].length ? icon('check') : `${n}/${FULL[s].length}` };
}

export function renderList(page) {
  const draw = () => {
    page.innerHTML = `<header class="m-top"><h1>Tests</h1></header>
      <p class="m-note" style="margin-top:0">Cambridge IELTS ${books()[0].id}–${books().at(-1).id}, Academic. ${offlineOK ? '<span class="dl-dot on"></span> = recordings saved on this device.' : ''}</p>
      <div class="m-grid">${books().map((b) => `<section><h2 class="m-h">${esc(b.name)}</h2>
      <div class="m-list">${b.tests.map((t) => `<a class="m-row" href="#/t/${t.id}">
        <span class="grow"><b>${esc(t.label)}${offlineOK ? `<span class="dl-dot${isSaved(t.id) ? ' on' : ''}"></span>` : ''}</b><small>${esc((t.titles || []).filter(Boolean)[0] || '')}</small></span>
        <span class="m-sks">${SKILLS.map((s) => { const k = skillState(t.id, s); return `<i class="${k.cls}">${k.text}</i>`; }).join('')}</span>${chevron}</a>`).join('')}</div></section>`).join('')}</div>`;
  };
  draw();
  return onOffline(draw);
}

export async function renderTest(page, id) {
  const T = await loadTest(id);
  const info = testInfo(id);
  let saving = null;      // text shown while this test is being saved
  if (offlineOK) verify(id).then((ok) => { if (!ok) draw(); });

  const partRows = (s) => {
    if (s === 'S') return '';
    const got = partsDone(id, s);
    const list = s === 'W' ? T.W.tasks : T[s].parts;
    return list.map((p) => {
      const a = got[p.n];
      let res = '';
      if (a && (s === 'L' || s === 'R')) { const [x, y] = a.result.byPart?.[p.n] || [a.result.score, a.result.total]; res = `${x}/${y}`; }
      else if (a) res = 'done';
      const sub = s === 'R' ? (p.title || `Questions ${p.from}–${p.to}`) : s === 'L' ? `Questions ${p.from}–${p.to}` : p.n === 1 ? 'Describe a visual · 150 words' : 'Essay · 250 words';
      return `<button class="m-row" data-go="${s}|${p.n}|practice">
        <span class="grow"><b>${PART_WORD[s]} ${p.n}</b><small>${esc(sub)}</small></span>
        <span class="meta">${res ? `<span class="pill good">${res}</span>` : ''}</span>${chevron}</button>`;
    }).join('');
  };

  const draw = () => {
    const atts = attemptsFor(id);
    const saved = isSaved(id), size = testBytes(id);
    const noAudio = !saved && !inReach();
    page.innerHTML = `<a class="back" href="#/tests">${icon('chevron-left')} Tests</a>
      <header class="m-top"><h1>${esc(testName(info))}</h1></header>
      ${offlineOK ? `<div class="card m-save${saved ? ' on' : ''}">
        <span class="grow">${saving || (saved ? '<b>Saved on this device</b><small>Recordings and pictures work with no connection.</small>'
    : `<b>Not saved yet</b><small>Reading and Writing text is always on the device. Listening and book pictures need saving${size ? ` · ${fmtMB(size)}` : ''}.</small>`)}</span>
        ${saving ? '' : saved ? '<button class="btn small ghost" data-unsave>Remove</button>' : '<button class="btn small primary" data-save>Save</button>'}</div>` : ''}
      <div class="m-grid two">${SKILLS.map((s) => `<section class="m-skill">
        <h2 class="m-h">${skBadge(s)} ${SKILL[s]}</h2>
        ${s === 'L' && noAudio ? `<p class="m-note warn">The recordings are not on this device and ${STATIC ? 'there is no connection' : 'your Mac is out of reach'}.</p>` : ''}
        <div class="m-list">${partRows(s)}
          ${s === 'S' ? `<button class="m-row" data-go="S|full|exam"><span class="grow"><b>Speaking test</b><small>3 parts · about 12 minutes · recorded</small></span>${chevron}</button>`
    : `<div class="m-row two"><span class="grow"><b>All ${FULL[s].length} together</b><small>${{ L: 'about 30 min', R: 'up to 60 min', W: '60 min' }[s]}</small></span>
            <button class="btn small" data-go="${s}|full|exam">Exam</button><button class="btn small" data-go="${s}|full|practice">Practice</button></div>`}
        </div></section>`).join('')}</div>
      ${atts.length ? `<h2 class="m-h">Your attempts</h2><div class="m-list">${atts.map((a) => `<div class="m-row att">
          <a class="grow" href="#/${a.finished ? 'r' : 'x'}/${a.id}"><b>${SKILL[a.skill]} · ${scopeText(a)}</b>
          <small>${fmtDateTime(a.created)} · ${a.mode} · ${a.finished ? resultText(a) : a.started ? 'in progress' : 'not started'}</small></a>
          <button class="icon" data-del="${a.id}" aria-label="Delete this attempt">${icon('trash-2')}</button></div>`).join('')}</div>` : ''}`;
  };
  draw();

  page.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const [s, which, mode] = go.dataset.go.split('|');
      startTest(id, s, which === 'full' ? FULL[s] : [+which], mode);
      return;
    }
    if (e.target.closest('[data-save]') && !saving) {
      saving = '<b>Saving…</b>'; draw();
      try {
        await saveTest(id, (d, n) => { saving = `<b>Saving… ${Math.round((d / n) * 100)}%</b><small>${d} of ${n} files</small>`; draw(); });
        toast('Saved on this device');
      } catch (err) { toast(err.message, 4000); }
      saving = null; draw();
      return;
    }
    if (e.target.closest('[data-unsave]')) { await removeTest(id); draw(); return; }
    const d = e.target.closest('[data-del]');
    if (d && (await confirmBox('Delete this attempt and its answers?', 'Delete'))) { deleteAttempt(d.dataset.del); draw(); }
  });
}
