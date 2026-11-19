import { esc, pct, fmtTime } from '../util.js';
import { isDone, setDone, S, settings } from '../store.js';
import { MOD, UNITS, byId, relevant, label, studySections, TRACK } from '../data.js';
import { setChrome, crumbs } from '../chrome.js';
import { isListened } from '../player.js';
import { icon } from '../../cbt/js/icons.js';

const ORDER = ['start', 'listening', 'reading', 'writing', 'speaking'];

export function render(view, { query }) {
  const secs = studySections();
  const next = secs.find((s) => !isDone(s.id));
  let mod = query.m || sessionStorage.getItem('learn-mod') || next?.module || 'start';
  setChrome({ crumbs: '<b>Study path</b>' });

  const draw = () => {
    sessionStorage.setItem('learn-mod', mod);
    const units = UNITS.filter((u) => u.module === mod);
    const tabs = ORDER.map((m) => {
      const list = secs.filter((s) => s.module === m);
      const d = list.filter((s) => isDone(s.id)).length;
      return `<button class="${m === mod ? 'on' : ''}" data-mod="${m}">${MOD[m].title} <small style="opacity:.75">${d}/${list.length}</small></button>`;
    }).join('');
    view.innerHTML = `
      <div class="row between" style="margin-bottom:16px">
        <div><h1 style="margin:0">Study path</h1><p class="muted" style="margin:4px 0 0">One module at a time. Each unit has three short sections — tick them off as you go.</p></div>
      </div>
      <div class="seg" style="margin-bottom:18px;flex-wrap:wrap">${tabs}</div>
      <div class="card module" style="--c:${MOD[mod].color}">
        ${units.map((u) => unitRow(u, next)).join('')}
      </div>
      ${settings().module !== 'both' ? `<p class="muted" style="font-size:13px">Showing the <b>${settings().module === 'ac' ? 'Academic' : 'General Training'}</b> path — units for the other module are dimmed. Change this in <a href="#/settings">Settings</a>.</p>` : ''}`;
  };
  view.onclick = (e) => {
    const b = e.target.closest('[data-mod]');
    if (b) { mod = b.dataset.mod; draw(); }
  };
  draw();
}

function unitRow(u, next) {
  const rel = relevant(u);
  const d = u.sections.filter((s) => isDone(s.id)).length;
  const all = d === u.sections.length;
  const isNext = next && next.unit === u.id;
  const tracks = new Set(u.sections.flatMap((s) => s.tracks));
  return `<a class="unit-row ${all ? 'done' : ''} ${rel ? '' : 'dim'}" href="#/unit/${u.id}" style="--c:${MOD[u.module].color}">
    <span class="unit-num">${all ? icon('check') : u.n || 'i'}</span>
    <div class="grow"><b>${esc(u.title)}</b>
      <div><small>${u.sections.length} section${u.sections.length > 1 ? 's' : ''} · pages ${label(u.sections[0].start)}–${label(u.sections.at(-1).end)}${tracks.size ? ` · ${tracks.size} audio` : ''}</small>
      ${u.only ? `<span class="pill" style="margin-left:6px">${u.only === 'ac' ? 'Academic only' : 'General Training only'}</span>` : ''}
      ${isNext ? '<span class="pill acc" style="margin-left:6px">Up next</span>' : ''}</div></div>
    <div style="width:110px" class="bar"><span style="width:${pct(d, u.sections.length)}%"></span></div>
    <small style="width:34px;text-align:right">${d}/${u.sections.length}</small>
  </a>`;
}

export function renderUnit(view, { params: [id] }) {
  const u = byId[id];
  if (!u) { view.innerHTML = '<div class="empty">Unit not found</div>'; return; }
  const c = MOD[u.module].color;
  setChrome({ crumbs: crumbs('<a href="#/learn">Study path</a>', `<a href="#/learn?m=${u.module}">${MOD[u.module].title}</a>`, esc(u.title)) });

  const draw = () => {
    const d = u.sections.filter((s) => isDone(s.id)).length;
    const first = u.sections.find((s) => !isDone(s.id)) || u.sections[0];
    view.innerHTML = `
      <div class="card module" style="--c:${c};margin-bottom:16px">
        <div class="row between">
          <div><small style="color:${c};font-weight:600">${MOD[u.module].title}${u.n ? ' · Unit ' + u.n : ''}</small><h1 style="margin:4px 0">${esc(u.title)}</h1>
          <small>${d} of ${u.sections.length} sections done</small></div>
          <a class="btn primary lg" href="#/s/${first.id}">${d === 0 ? 'Start unit' : d === u.sections.length ? 'Review unit' : 'Continue'} ${icon('arrow-right')}</a>
        </div>
        ${!relevant(u) ? `<p class="notice" style="margin-bottom:0">This unit is for ${u.only === 'ac' ? 'the Academic' : 'the General Training'} module. You can still study it.</p>` : ''}
      </div>
      <ul class="sec-list">
        ${u.sections.map((s, i) => `
          <li class="sec-item">
            <button class="check ${isDone(s.id) ? 'on' : ''}" data-done="${s.id}" title="Mark as done" aria-label="Mark as done">${icon('check')}</button>
            <a class="title" href="#/s/${s.id}">${u.n ? `${i + 1}. ` : ''}${esc(s.title)}</a>
            ${s.tracks.map((n) => `<span class="track-chip ${isListened(n) ? 'done' : ''}" title="${esc(TRACK[n].title)} (${fmtTime(TRACK[n].dur)})">${icon('play')} ${n}</span>`).join(' ')}
            <small>p. ${label(s.start)}${s.end > s.start ? '–' + label(s.end) : ''}</small>
          </li>`).join('')}
      </ul>
      <div class="row" style="margin-top:14px">
        ${u.key ? `<a class="btn" href="#/page/${u.key.page}?y=${u.key.y}">Answer key for this unit</a>` : ''}
        ${u.script ? `<a class="btn" href="#/page/${u.script.page}?y=${u.script.y}">Recording scripts</a>` : ''}
        ${u.module === 'speaking' ? `<span class="notice info" style="padding:6px 10px">Speaking units mention DVD videos — those aren't in the audio folder, so skip video-only exercises or use the sample answers in the key.</span>` : ''}
      </div>`;
  };
  view.onclick = (e) => {
    const b = e.target.closest('[data-done]');
    if (b) { setDone(b.dataset.done, !isDone(b.dataset.done)); draw(); }
  };
  draw();
}
