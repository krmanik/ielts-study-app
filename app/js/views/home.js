import { esc, fmtMins, dayKey, pct, fmtDate } from '../util.js';
import { S, settings, todaySeconds, streak, isDone } from '../store.js';
import { MOD, studySections, UNITS, relevant, label, BOOK, testsInOrder } from '../data.js';
import { setChrome } from '../chrome.js';
import { bandFmt, overall } from '../grade.js';
import { dueCards } from './vocab.js';
import { icon } from '../../cbt/js/icons.js';

export function latestBands() {
  const out = { listening: null, reading: null, writing: null, speaking: null };
  const at = [...S().attempts].filter((a) => a.band != null).sort((a, b) => a.finishedAt - b.finishedAt);
  for (const a of at) out[a.part] = a.band;
  return out;
}

export function render(view) {
  setChrome({ crumbs: '<b>Today</b>' });
  const st = S(), set = settings();
  const secs = studySections();
  const next = secs.find((s) => !isDone(s.id));
  const done = secs.filter((s) => isDone(s.id)).length;
  const today = todaySeconds(), goal = (set.dailyGoal || 30) * 60;
  const days = set.examDate ? Math.ceil((new Date(set.examDate) - new Date(dayKey())) / 864e5) : null;
  const remaining = secs.length - done;
  const testsList = testsInOrder().filter((t) => set.module === 'both' || (set.module === 'gt' ? true : t.kind === 'academic'));
  const testsDone = testsList.filter((t) => st.attempts.some((a) => a.test === t.id)).length;
  const lb = latestBands(), ov = overall(Object.values(lb));
  const last = st.lastPos;
  const due = dueCards().length;

  const perDay = days > 0 ? Math.ceil(remaining / days) : null;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const modules = ['start', 'listening', 'reading', 'writing', 'speaking'].map((m) => {
    const list = secs.filter((s) => s.module === m);
    const d = list.filter((s) => isDone(s.id)).length;
    return `<a class="row" href="#/learn?m=${m}" style="color:inherit;text-decoration:none;margin-bottom:12px">
      <span class="mod-dot" style="--c:${MOD[m].color}"></span><span style="width:90px">${MOD[m].title}</span>
      <div class="bar grow" style="--c:${MOD[m].color}"><span style="width:${pct(d, list.length)}%"></span></div>
      <small style="width:54px;text-align:right">${d}/${list.length}</small></a>`;
  }).join('');

  view.innerHTML = `
  <div class="stack">
    <div class="card hero">
      <div class="row between">
        <div>
          <h1>${greet}.</h1>
          <p class="muted" style="margin:0">${days != null
            ? (days > 0 ? `<b style="color:var(--text)">${days} days</b> until your exam on ${esc(fmtDate(set.examDate))}.` : days === 0 ? '<b>Exam day — good luck!</b>' : 'Your exam date has passed — set a new one in Settings.')
            : `Set your exam date in <a href="#/settings">Settings</a> to get a daily plan.`}
            ${perDay ? ` Aim for about <b style="color:var(--text)">${perDay} section${perDay > 1 ? 's' : ''} a day</b>.` : ''}</p>
        </div>
        <div class="row">
          <div class="ring" style="--p:${Math.min(100, pct(today, goal))}"><div>${Math.round(today / 60)}<small>of ${set.dailyGoal} min</small></div></div>
          <div><div class="stat">${streak()}<small> day streak</small></div><small>${fmtMins(Object.values(st.activity).reduce((a, b) => a + b, 0))} studied in total</small></div>
        </div>
      </div>
    </div>

    <div class="grid g2">
      <div class="card">
        <h2>Up next</h2>
        ${next ? `
          <p style="margin:0 0 4px"><span class="pill" style="background:color-mix(in srgb, ${MOD[next.module].color} 15%, transparent);color:${MOD[next.module].color}">${MOD[next.module].title}${next.unitN ? ' · Unit ' + next.unitN : ''}</span></p>
          <h3 style="margin:8px 0 2px">${esc(next.title)}</h3>
          <p class="muted" style="margin:0 0 14px">${esc(next.unitTitle)} · pages ${label(next.start)}${next.end > next.start ? '–' + label(next.end) : ''}${next.tracks?.length ? ` · ${next.tracks.length} audio track${next.tracks.length > 1 ? 's' : ''}` : ''}</p>
          <a class="btn primary lg" href="#/s/${next.id}">Start this section ${icon('arrow-right')}</a>`
          : `<p>You've finished every section on your study path. Now focus on <a href="#/tests">practice tests</a>.</p>`}
        ${last && last.route && (!next || !last.route.endsWith(next.id)) ? `<hr><div class="row between"><div><small>Resume where you left off</small><div><b>${esc(last.title)}</b> <small>· p. ${esc(label(last.page ?? 0))}</small></div></div><a class="btn" href="#${esc(last.route)}?y=resume">Resume</a></div>` : ''}
      </div>

      <div class="card">
        <h2>Study path progress</h2>
        <p class="muted" style="margin-top:-4px">${done} of ${secs.length} sections complete (${pct(done, secs.length)}%)</p>
        ${modules}
        <a class="row" href="#/tests" style="color:inherit;text-decoration:none">
          <span class="mod-dot" style="--c:var(--tests)"></span><span style="width:90px">Tests</span>
          <div class="bar grow" style="--c:var(--tests)"><span style="width:${pct(testsDone, testsList.length)}%"></span></div>
          <small style="width:54px;text-align:right">${testsDone}/${testsList.length}</small></a>
      </div>
    </div>

    <div class="grid g4">
      ${['listening', 'reading', 'writing', 'speaking'].map((p) => `
        <a class="card flat" href="#/tests" style="color:inherit;text-decoration:none;border-top:4px solid ${MOD[p].color}">
          <small>${MOD[p].title} band (latest)</small><div class="stat">${bandFmt(lb[p])}</div></a>`).join('')}
    </div>
    <div class="grid g2">
      <div class="card">
        <div class="row between"><h2 style="margin:0">Estimated overall band</h2><span class="band">${bandFmt(ov)}</span></div>
        <p class="muted" style="margin-bottom:0">${ov == null ? 'Complete at least one Listening, Reading, Writing and Speaking attempt in <a href="#/tests">Practice tests</a> to see an overall estimate.' : `Target: ${bandFmt(Number(set.targetBand))}. ${ov >= set.targetBand ? 'You are at or above target — keep it steady.' : `About ${bandFmt(set.targetBand - ov)} bands to go.`}`}</p>
      </div>
      <div class="card">
        <h2>Quick practice</h2>
        <div class="row">
          <a class="btn" href="#/vocab/review">Review words ${due ? `<span class="pill acc">${due} due</span>` : ''}</a>
          <a class="btn" href="#/mistakes">Mistake log</a>
          <a class="btn" href="#/audio">Listen to a track</a>
          <a class="btn" href="#/search">Search the book</a>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Study activity</h2>
      ${heatmap(st.activity)}
      <small>Each square is a day; darker = more minutes studied. Time counts while this app is open and you're active.</small>
    </div>
  </div>`;
}

function heatmap(act) {
  const weeks = 20, cells = [];
  const d = new Date(); d.setDate(d.getDate() - d.getDay() - (weeks - 1) * 7);
  for (let i = 0; i < weeks * 7; i++) {
    const k = dayKey(d), m = (act[k] || 0) / 60;
    const l = m === 0 ? 0 : m < 10 ? 1 : m < 25 ? 2 : m < 50 ? 3 : 4;
    cells.push(`<span data-l="${l}" title="${k}: ${Math.round(m)} min"></span>`);
    d.setDate(d.getDate() + 1);
  }
  return `<div class="heat">${cells.join('')}</div>`;
}
