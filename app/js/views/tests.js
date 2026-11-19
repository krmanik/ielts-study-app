import { esc, fmtDateTime, fmtTime } from '../util.js';
import { S, settings } from '../store.js';
import { BOOK, TEST, MOD, label, pages, testsInOrder, TRACK } from '../data.js';
import { setChrome, crumbs } from '../chrome.js';
import { bandFmt, overall } from '../grade.js';
import { readerShell } from './reader.js';
import { play } from '../player.js';
import { icon } from '../../cbt/js/icons.js';

export const PARTS = {
  listening: { title: 'Listening', mins: 30, desc: '4 sections · 40 questions · audio plays once' },
  reading: { title: 'Reading', mins: 60, desc: '3 passages · 40 questions' },
  writing: { title: 'Writing', mins: 60, desc: 'Task 1 (150+ words) · Task 2 (250+ words)' },
  speaking: { title: 'Speaking', mins: 14, desc: 'Part 1 · Part 2 long turn · Part 3 discussion' },
};
export const partsOf = (t) => (t.kind === 'gt' ? ['reading', 'writing'] : ['listening', 'reading', 'writing', 'speaking']);
export const attemptsFor = (tid, part) => S().attempts.filter((a) => a.test === tid && (!part || a.part === part)).sort((a, b) => b.finishedAt - a.finishedAt);

export function render(view) {
  setChrome({ crumbs: '<b>Practice tests</b>' });
  const m = settings().module;
  const list = testsInOrder().filter((t) => m === 'both' || t.kind === 'academic' || m === 'gt');
  view.innerHTML = `
    <h1>Practice tests</h1>
    <p class="muted" style="margin-top:-4px">Eight full Academic tests and two General Training Reading &amp; Writing tests. Take a part as a <b>timed exam</b> (auto-marked, with band score) or open it in <b>study mode</b> with the answers and script beside it.</p>
    <div class="grid g3">
      ${list.map((t) => {
        const bands = partsOf(t).map((p) => [p, attemptsFor(t.id, p)[0]?.band]);
        const ov = t.kind === 'academic' ? overall(bands.map((b) => b[1])) : null;
        const any = bands.some((b) => b[1] != null);
        return `<a class="card" href="#/test/${t.id}" style="color:inherit;text-decoration:none">
          <div class="row between"><h2 style="margin:0">${esc(t.title)}</h2>${ov != null ? `<span class="pill acc">Band ${bandFmt(ov)}</span>` : any ? '<span class="pill warn">In progress</span>' : ''}</div>
          <small>${t.kind === 'gt' ? 'General Training · Reading & Writing' : 'Academic · all four skills'} · from p. ${label(t.start)}</small>
          <div class="row" style="margin-top:12px;gap:6px">${bands.map(([p, b]) => `<span class="pill ${b != null ? 'ok' : ''}" title="${PARTS[p].title}">${PARTS[p].title[0]} ${b != null ? bandFmt(b) : '–'}</span>`).join('')}</div>
        </a>`;
      }).join('')}
    </div>
    ${history()}`;
}

function history() {
  const at = [...S().attempts].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 30);
  if (!at.length) return '';
  return `<div class="card" style="margin-top:18px"><h2>Recent attempts</h2>
    <table class="t"><thead><tr><th>When</th><th>Test</th><th>Part</th><th>Score</th><th>Band</th><th></th></tr></thead><tbody>
    ${at.map((a) => `<tr><td>${fmtDateTime(a.finishedAt)}</td><td>${esc(TEST[a.test]?.title || a.test)}</td><td>${PARTS[a.part].title}</td>
      <td>${a.raw != null ? `${a.raw}/40` : a.words ? a.words.join(' + ') + ' words' : '–'}</td><td><b>${bandFmt(a.band)}</b></td>
      <td><a href="#/attempt/${a.id}">Review</a></td></tr>`).join('')}
    </tbody></table></div>`;
}

export function renderTest(view, { params: [id] }) {
  const t = TEST[id];
  if (!t) { view.innerHTML = '<div class="empty">Test not found</div>'; return; }
  setChrome({ crumbs: crumbs('<a href="#/tests">Practice tests</a>', esc(t.title)) });
  const parts = partsOf(t);
  const bands = parts.map((p) => attemptsFor(id, p)[0]?.band);
  const ov = t.kind === 'academic' ? overall(bands) : null;
  const card = (p) => {
    const at = attemptsFor(id, p);
    const draft = S().drafts[`${id}/${p}`];
    const pagesTxt = p === 'listening' ? `${label(t.listening[0].start)}–${label(t.listening[3].end)}`
      : p === 'reading' ? `${label(t.reading[0].start)}–${label(t.reading[2].end)}`
      : `${label(t[p].start)}${t[p].end > t[p].start ? '–' + label(t[p].end) : ''}`;
    return `<div class="card" style="border-top:4px solid ${MOD[p].color}">
      <div class="row between"><h2 style="margin:0">${PARTS[p].title}</h2><span class="pill">${PARTS[p].mins} min</span></div>
      <small>${PARTS[p].desc} · pages ${pagesTxt}</small>
      ${p === 'reading' && t.reading.some((r) => r.missing) ? `<p class="notice" style="margin:10px 0 0">Passage 2 (questions 14–26) is missing from this scan. You can still do Passages 1 and 3 — the score will be out of 27.</p>` : ''}
      <div class="row" style="margin-top:14px">
        <a class="btn primary" href="#/exam/${id}/${p}">${draft ? 'Resume timed test' : 'Start timed test'}</a>
        <a class="btn" href="#/test/${id}/study/${p}">Study mode</a>
      </div>
      ${at.length ? `<ul class="list-plain" style="margin-top:10px">${at.slice(0, 3).map((a) => `<li class="row between"><span><b>Band ${bandFmt(a.band)}</b> <small>${a.raw != null ? `· ${a.raw}/${a.max || 40}` : ''} · ${fmtDateTime(a.finishedAt)}</small></span><a href="#/attempt/${a.id}">Review</a></li>`).join('')}</ul>` : ''}
    </div>`;
  };
  view.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><h1 style="margin:0">${esc(t.title)}</h1><small>${t.kind === 'gt' ? 'General Training Reading & Writing — for Listening and Speaking use any Academic test (they are the same for both modules).' : 'Academic module'}</small></div>
      ${t.kind === 'academic' ? `<div style="text-align:right"><small>Overall (latest of each part)</small><div class="band">${bandFmt(ov)}</div></div>` : ''}
    </div>
    <div class="grid g2">${parts.map(card).join('')}</div>
    <p class="muted" style="font-size:13px;margin-top:16px">Timed tests save your answers as you go, so you can close the app and resume. Listening and Reading are marked against the book's answer key; Writing and Speaking use self-assessment against the four official criteria, with the book's model answers to compare.</p>`;
}

/** Study mode: the test pages with answer key + script panels, no timer. */
export function renderStudy(view, { params: [id, , part] }) {
  const t = TEST[id];
  const P = PARTS[part];
  setChrome({ wide: true, crumbs: crumbs('<a href="#/tests">Practice tests</a>', `<a href="#/test/${id}">${esc(t.title)}</a>`, `${P.title} · study mode`) });
  let list, keyAnchor, scriptAnchor, chips = '';
  if (part === 'listening') {
    list = pages(t.listening[0].start, t.listening[3].end);
    keyAnchor = t.listening[0].key; scriptAnchor = t.listening[0].script;
    chips = t.listening.map((s) => `<button class="track-chip" data-play="${s.track}" title="${esc(TRACK[s.track].title)} · ${fmtTime(TRACK[s.track].dur)}">${icon('play')} S${s.n}</button>`).join(' ');
  } else if (part === 'reading') {
    list = pages(t.reading[0].start, t.reading[2].end);
    keyAnchor = t.reading[0].key;
  } else {
    list = pages(t[part].start, t[part].end);
    keyAnchor = part === 'writing' ? t.writing.key || (t.keyStart && null) : null;
  }
  const r = readerShell(view, {
    list, title: `${t.title} ${P.title}`, start: { page: list[0], y: 0 }, keyAnchor, scriptAnchor,
    bar: `<span class="mod-dot" style="--c:${MOD[part].color}"></span><span class="title">${esc(t.title)} · ${P.title} <small>study mode</small></span>
      <span>${chips}</span>
      ${keyAnchor ? `<button class="btn sm" data-panel="key">${part === 'writing' ? 'Model answers' : 'Answers'}</button>` : ''}
      ${scriptAnchor ? `<button class="btn sm" data-panel="script">Script</button>` : ''}
      <button class="btn sm" data-panel="notes">Notes</button>
      <a class="btn sm primary" href="#/exam/${id}/${part}">Take it timed</a>`,
    noteKey: () => ({ id: `${id}/${part}`, label: `${t.title} ${P.title}` }),
  });
  // listening: when a section track is played, point the script panel at that section
  return () => r.cleanup();
}
