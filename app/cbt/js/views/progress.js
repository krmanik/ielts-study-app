import { $, $$, esc, SKILL, fmtDate, fmtMins, dayKey, clamp } from '../util.js';
import { finishedAttempts, openAttempts, settings, S } from '../store.js';
import { loadTest, testInfo, testName, books } from '../data.js';
import { attemptBand, isFull } from '../actions.js';
import { TYPE_LABEL, fmtBand } from '../mark.js';
import { icon } from '../icons.js';

const SKILLS = ['L', 'R', 'W', 'S'];
const CAL_WEEKS = 26, BAR_WEEKS = 12;
const at = (k) => new Date(k + 'T00:00');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const shortDay = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function render(page) {
  const atts = finishedAttempts();
  const target = settings().target || 7;
  const types = {};
  atts.forEach((a) => Object.entries(a.result?.byType || {}).forEach(([k, [s, t]]) => {
    const key = `${a.skill}:${k}`;
    const b = types[key] || (types[key] = [0, 0]);
    b[0] += s; b[1] += t;
  }));
  const typeRows = Object.entries(types).sort((x, y) => x[1][0] / x[1][1] - y[1][0] / y[1][1]);
  const days = dayStats(atts);
  const totalSec = Object.values(S().activity).reduce((a, b) => a + b, 0);
  const active = Object.keys(days).filter((k) => isActive(days[k])).sort();
  const streak = streaks(active);

  page.innerHTML = `<h1>Progress</h1>
    <div class="grid4">
      ${stat(atts.length, `sections completed<br>${atts.filter((a) => isFull(a)).length} full · ${atts.filter((a) => !isFull(a)).length} single parts`)}
      ${stat(fmtMins(totalSec), 'time in tests')}
      ${stat(active.length, 'active days')}
      ${stat(streak.now, `day streak<br>best: ${plural(streak.best, 'day')}`)}
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card viz"><h3 class="viz-h">Study time each day <span class="muted">last ${CAL_WEEKS} weeks</span></h3>${calendar(days)}</div>
      <div class="card viz"><h3 class="viz-h">Sections finished each week <span class="muted">last ${BAR_WEEKS} weeks</span></h3>${weekBars(days)}</div>
    </div>
    <div class="section-title"><h2>Band over time</h2><span class="muted">dashed line = your target (${fmtBand(target)})</span></div>
    <div class="multiples">${SKILLS.map((s) => {
      const list = atts.filter((a) => a.skill === s && attemptBand(a) != null);
      return `<div class="card mini" data-skill="${s}"><h3><span>${SKILL[s]}</span><span class="muted" style="font-weight:400">${plural(list.length, 'result')}</span></h3>${chart(list, target)}${improvement(list)}</div>`;
    }).join('')}</div>
    <div class="section-title"><h2>Tests done</h2><span class="muted">every test and skill — the colour is your band</span></div>
    <div class="card viz">${coverage()}</div>
    <div class="section-title"><h2>Accuracy by question type</h2><span class="muted">weakest first — practise these</span></div>
    <div class="card">${typeRows.length ? `<div class="bars">${typeRows.map(([k, [s, t]]) => {
      const [sk, ty] = k.split(':');
      return `<div class="bar-row"><span>${SKILL[sk]} · ${esc(TYPE_LABEL[ty] || ty)}</span><div class="bar"><i style="width:${(s / t) * 100}%"></i></div><b>${Math.round((s / t) * 100)}%</b></div>`;
    }).join('')}</div>
      <table class="ans-table" style="margin-top:14px"><caption class="muted" style="text-align:left;font-size:13px;padding-bottom:4px">Table view</caption><thead><tr><th>Skill</th><th>Type</th><th>Correct</th><th>Total</th></tr></thead><tbody>
      ${typeRows.map(([k, [s, t]]) => { const [sk, ty] = k.split(':'); return `<tr><td>${SKILL[sk]}</td><td>${esc(TYPE_LABEL[ty] || ty)}</td><td>${s}</td><td>${t}</td></tr>`; }).join('')}</tbody></table>`
      : '<p class="muted">Finish a Listening or Reading section to see this.</p>'}</div>`;
  bindTips(page);
  bindViz(page);
  $$('.scroll-end', page).forEach((el) => (el.scrollLeft = el.scrollWidth));   // newest weeks are on the right
}

// ---------------------------------------------------------------- activity: days and weeks
/** 'YYYY-MM-DD' -> { sec: time in tests, exam: sections finished in exam mode, practice: … in practice mode } */
function dayStats(atts) {
  const days = {};
  const get = (k) => days[k] || (days[k] = { sec: 0, exam: 0, practice: 0 });
  Object.entries(S().activity).forEach(([k, sec]) => (get(k).sec = sec));
  atts.forEach((a) => get(dayKey(new Date(a.finished)))[a.mode === 'exam' ? 'exam' : 'practice']++);
  return days;
}
const isActive = (d) => !!d && (d.sec >= 300 || d.exam + d.practice > 0);   // 5 minutes or a finished section

function streaks(active) {
  let best = 0, run = 0, prev = null;
  for (const k of active) {
    run = prev && dayKey(addDays(at(prev), 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  const set = new Set(active);
  let d = at(dayKey()), now = 0;
  if (!set.has(dayKey(d))) d = addDays(d, -1);        // today still counts if you have not studied yet
  while (set.has(dayKey(d))) { now++; d = addDays(d, -1); }
  return { now, best };
}

const LEVELS = [[60, 4, '60+'], [30, 3, '30–59'], [15, 2, '15–29'], [1, 1, '1–14'], [0, 0, 'none']];
const level = (min) => LEVELS.find(([lo]) => min >= lo)[1];

function calendar(days) {
  const today = at(dayKey());
  const start = addDays(monday(today), -(CAL_WEEKS - 1) * 7);
  let cols = '', month = -1;
  const rows = [];
  for (let w = 0; w < CAL_WEEKS; w++) {
    const mon = addDays(start, w * 7);
    let col = `<span class="hm-m">${mon.getMonth() !== month ? mon.toLocaleDateString(undefined, { month: 'short' }) : ''}</span>`;
    month = mon.getMonth();
    for (let i = 0; i < 7; i++) {
      const d = addDays(mon, i), k = dayKey(d), st = days[k];
      if (d > today) { col += '<i class="hc off"></i>'; continue; }
      const min = Math.floor((st?.sec || 0) / 60), n = st ? st.exam + st.practice : 0;
      const when = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
      col += `<i class="hc l${level(min)}${k === dayKey() ? ' today' : ''}" data-tip="${min ? fmtMins(min * 60) : st?.sec ? 'Under 1 min' : 'No study'}\n${when}${n ? '\n' + plural(n, 'section') + ' finished' : ''}"></i>`;
      if (st && (st.sec >= 60 || n)) rows.push([d, min, n]);
    }
    cols += col;
  }
  return `<div class="hm-wrap scroll-end"><div class="hm" role="img" aria-label="Study minutes per day for the last ${CAL_WEEKS} weeks. The same numbers are in the table below.">
      <div class="hm-days"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
      <div class="hm-grid">${cols}</div></div></div>
    <div class="legend"><span class="muted">Minutes:</span>${[...LEVELS].reverse().map(([, l, txt]) => `<span><i class="hc l${l}"></i>${txt}</span>`).join('')}</div>
    ${tableView(['Day', 'Time', 'Sections finished'], rows.reverse().map(([d, min, n]) => [d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), fmtMins(min * 60), n]), 'No study time recorded yet.')}`;
}

function weekBars(days) {
  const first = addDays(monday(at(dayKey())), -(BAR_WEEKS - 1) * 7);
  const weeks = Array.from({ length: BAR_WEEKS }, (_, w) => {
    const mon = addDays(first, w * 7);
    const sum = { mon, exam: 0, practice: 0, sec: 0 };
    for (let i = 0; i < 7; i++) { const st = days[dayKey(addDays(mon, i))]; if (st) { sum.exam += st.exam; sum.practice += st.practice; sum.sec += st.sec; } }
    return sum;
  });
  const W = 520, H = 200, pl = 26, pr = 6, pt = 10, pb = 24;
  const max = Math.max(4, ...weeks.map((w) => w.exam + w.practice));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const band = (W - pl - pr) / BAR_WEEKS, bw = 20;
  const y = (v) => pt + (1 - v / top) * (H - pt - pb);
  // a column segment from value a up to b; only the top one of a column gets rounded corners
  const seg = (cls, x, a, b, round) => {
    const y0 = y(a) - (a ? 2 : 0), y1 = y(b);          // 2px gap between the two segments
    if (y0 - y1 < 1) return '';
    const r = round ? Math.min(4, y0 - y1) : 0;
    return `<path class="${cls}" d="M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y0}Z"/>`;
  };
  let grid = '';
  for (let v = 0; v <= top; v += step) grid += `<line class="${v ? 'grid-line' : 'base-line'}" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${pl - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  const cols = weeks.map((w, i) => {
    const x = pl + i * band + (band - bw) / 2, n = w.exam + w.practice;
    return `<g class="wk" data-tip="${plural(n, 'section')}\nWeek of ${shortDay(w.mon)}${n ? `\n${w.exam} test · ${w.practice} practice` : ''}${w.sec >= 60 ? '\n' + fmtMins(w.sec) + ' studied' : ''}">
      <rect class="hit" x="${pl + i * band}" y="${pt}" width="${band}" height="${H - pt - pb}"/>
      ${seg('s-a', x, 0, w.exam, !w.practice)}${seg('s-b', x, w.exam, n, true)}
      ${(BAR_WEEKS - 1 - i) % 2 === 0 ? `<text class="axis-label" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${shortDay(w.mon)}</text>` : ''}</g>`;
  }).join('');
  return `<div class="legend"><span><i class="sw s-a"></i>Test (exam mode)</span><span><i class="sw s-b"></i>Practice mode</span></div>
    <svg class="wk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sections finished per week, exam mode and practice mode. The same numbers are in the table below.">${grid}${cols}</svg>
    ${tableView(['Week of', 'Test (exam mode)', 'Practice', 'Time'], weeks.filter((w) => w.exam + w.practice || w.sec >= 60).reverse().map((w) => [shortDay(w.mon), w.exam, w.practice, fmtMins(w.sec)]), 'Nothing finished in these weeks yet.')}`;
}

const tableView = (heads, rows, empty) => `<details class="tv"><summary>Table view</summary>${rows.length
  ? `<table class="ans-table"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : `<p class="muted" style="margin:8px 0 0">${empty}</p>`}</details>`;

// ---------------------------------------------------------------- improvement
/** Change from the first result to the latest one, under each band chart. */
function improvement(list) {
  if (!list.length) return '';
  const bands = list.map(attemptBand), last = bands.at(-1), best = Math.max(...bands);
  if (bands.length < 2) return `<p class="delta">Latest <b>${fmtBand(last)}</b> · one more result shows your change</p>`;
  const d = last - bands[0];
  const arrow = `<i class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${icon(d > 0 ? 'trending-up' : d < 0 ? 'trending-down' : 'minus')}</i>`;
  return `<p class="delta">${arrow} <b>${d > 0 ? '+' : d < 0 ? '−' : ''}${d ? Math.abs(d).toFixed(1) : 'No change'}</b> ${d ? 'band ' : ''}since your first result · latest <b>${fmtBand(last)}</b> · best <b>${fmtBand(best)}</b></p>`;
}

// ---------------------------------------------------------------- tests done (every test × skill)
const bandLevel = (b) => (b >= 7.5 ? 4 : b >= 6.5 ? 3 : b >= 5.5 ? 2 : 1);

function coverage() {
  const cell = {};   // 'test|skill' -> the attempt to show: latest full one, else latest single part
  for (const a of finishedAttempts()) {
    const k = `${a.test}|${a.skill}`, cur = cell[k];
    if (!cur || isFull(a) || !isFull(cur)) cell[k] = a;
  }
  const open = new Set(openAttempts().map((a) => `${a.test}|${a.skill}`));
  const td = (b, t, s, first) => {
    const a = cell[`${t.id}|${s}`], name = `Book ${b.id} · ${t.label} · ${SKILL[s]}`;
    let cls = 'cc', txt = '', tip = `Not done yet\n${name}`;
    if (a) {
      const bd = attemptBand(a), part = !isFull(a);
      cls += bd == null ? ' ns' : ` l${bandLevel(bd)}`;
      txt = bd == null ? icon('check') : fmtBand(bd) + (part ? '*' : '');
      tip = `${bd == null ? 'Done — not scored yet' : `Band ${fmtBand(bd)}${part ? ' (estimate)' : ''}${a.result?.score != null ? ` · ${a.result.score}/${a.result.total}` : ''}`}\n${name}\n${part ? 'one part only' : 'full section'}, ${a.mode} mode\n${fmtDate(a.finished)}`;
    } else if (open.has(`${t.id}|${s}`)) { cls += ' open'; txt = '…'; tip = `In progress\n${name}`; }
    return `<td${first ? ' class="g"' : ''}><a class="${cls}" href="#/t/${t.id}" data-tip="${esc(tip)}" aria-label="${esc(tip.replace(/\n/g, ', '))}">${txt}</a></td>`;
  };
  const n = Math.max(...books().map((b) => b.tests.length));
  return `<div class="cov-wrap"><table class="cov">
    <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th colspan="4" class="g">Test ${i + 1}</th>`).join('')}</tr>
      <tr><th></th>${Array.from({ length: n }, () => SKILLS.map((s, i) => `<th${i ? '' : ' class="g"'} title="${SKILL[s]}">${s}</th>`).join('')).join('')}</tr></thead>
    <tbody>${books().map((b) => `<tr><th scope="row">Book ${esc(b.id)}${b.tests[0]?.label !== 'Test 1' ? ` <small class="muted">(${esc(b.tests[0].label.replace('Test ', 'Tests '))}–${esc(b.tests.at(-1).label.replace('Test ', ''))})</small>` : ''}</th>${b.tests.map((t) => SKILLS.map((s, i) => td(b, t, s, !i)).join('')).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="legend"><span class="muted">Band:</span><span><i class="hc l1"></i>below 5.5</span><span><i class="hc l2"></i>5.5–6</span><span><i class="hc l3"></i>6.5–7</span><span><i class="hc l4"></i>7.5 and up</span>
      <span><i class="hc l0"></i>not done</span><span class="muted">L R W S = Listening, Reading, Writing, Speaking · * = one part only, band estimated · ${icon('check')} = done, not scored yet</span></div>`;
}

/** One tooltip per .viz card for everything inside it that has [data-tip] (first line = the value). */
function bindViz(page) {
  $$('.viz', page).forEach((card) => {
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    card.append(tip);
    const show = (t) => {
      const [head, ...rest] = t.dataset.tip.split('\n');
      const b = document.createElement('b');
      b.textContent = head;
      tip.replaceChildren(b, ...rest.flatMap((line) => [document.createElement('br'), line]));
      tip.hidden = false;
      const cr = card.getBoundingClientRect(), r = t.getBoundingClientRect(), half = tip.offsetWidth / 2;
      tip.style.left = clamp(r.left - cr.left + r.width / 2, half + 4, Math.max(half + 4, cr.width - half - 4)) + 'px';
      tip.style.top = r.top - cr.top + 'px';
    };
    const over = (e) => { const t = e.target.closest?.('[data-tip]'); if (t) show(t); else tip.hidden = true; };
    card.addEventListener('pointerover', over);
    card.addEventListener('focusin', over);
    card.addEventListener('pointerleave', () => (tip.hidden = true));
    card.addEventListener('focusout', () => (tip.hidden = true));
  });
}

const stat = (v, l) => `<div class="card" style="padding:14px 16px"><div style="font-size:24px;font-weight:800">${v}</div><small class="muted">${l}</small></div>`;

function chart(list, target) {
  if (!list.length) return `<div class="empty-chart">No results yet</div>`;
  const W = 260, H = 130, pl = 24, pr = 8, pt = 8, pb = 18;
  const lo = 3, hi = 9;
  const x = (i) => pl + (list.length === 1 ? (W - pl - pr) / 2 : (i / (list.length - 1)) * (W - pl - pr));
  const y = (b) => pt + (1 - (b - lo) / (hi - lo)) * (H - pt - pb);
  const pts = list.map((a, i) => [x(i), y(attemptBand(a)), a]);
  const grid = [4, 5, 6, 7, 8, 9].map((b) => `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${y(b)}" y2="${y(b)}"/><text class="axis-label" x="${pl - 6}" y="${y(b) + 3}" text-anchor="end">${b}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Band scores over time">${grid}
    <line class="target" x1="${pl}" x2="${W - pr}" y1="${y(target)}" y2="${y(target)}"/>
    ${pts.length > 1 ? `<polyline class="series" points="${pts.map((p) => p[0] + ',' + p[1]).join(' ')}"/>` : ''}
    ${pts.map((p) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4"/>`).join('')}
    ${pts.map((p, i) => `<rect class="hit" x="${p[0] - 12}" y="${pt}" width="24" height="${H - pt - pb}" data-i="${i}"/>`).join('')}
    <text class="axis-label" x="${pl}" y="${H - 4}">${fmtDate(list[0].finished)}</text>
    ${list.length > 1 ? `<text class="axis-label" x="${W - pr}" y="${H - 4}" text-anchor="end">${fmtDate(list.at(-1).finished)}</text>` : ''}
  </svg><div class="tip" hidden></div>
  <script type="application/json">${JSON.stringify(list.map((a) => ({ b: attemptBand(a), d: fmtDate(a.finished), t: testName(testInfo(a.test)), full: isFull(a), id: a.id })))}</script>`;
}

function bindTips(page) {
  $$('.mini', page).forEach((card) => {
    const data = JSON.parse($('script', card)?.textContent || '[]');
    const tip = $('.tip', card), svg = $('svg', card);
    if (!svg) return;
    svg.addEventListener('pointermove', (e) => {
      const r = e.target.closest('.hit');
      if (!r) { tip.hidden = true; return; }
      const d = data[+r.dataset.i];
      const cr = card.getBoundingClientRect(), rr = r.getBoundingClientRect();
      tip.innerHTML = `<b>${fmtBand(d.b)}</b> · ${esc(d.t)}${d.full ? '' : ' (part)'}<br>${d.d}`;
      tip.style.left = rr.left - cr.left + rr.width / 2 + 'px';
      tip.style.top = rr.top - cr.top + 10 + 'px';
      tip.hidden = false;
    });
    svg.addEventListener('pointerleave', () => (tip.hidden = true));
    svg.addEventListener('click', (e) => { const r = e.target.closest('.hit'); if (r) location.hash = `#/r/${data[+r.dataset.i].id}`; });
  });
}

// ---------------------------------------------------------------- mistakes
export async function renderMistakes(page) {
  const atts = finishedAttempts().filter((a) => a.skill === 'L' || a.skill === 'R').reverse();
  page.innerHTML = `<h1>Mistakes</h1><p class="muted">Every wrong answer from your Listening and Reading attempts, newest first. Open the review to see the question in context${''}.</p><div id="mlist"><p class="muted">Loading…</p></div>`;
  const out = [];
  for (const a of atts) {
    const T = await loadTest(a.test);
    const wrong = Object.entries(a.result.right).filter(([, ok]) => !ok).map(([q]) => +q);
    if (!wrong.length) continue;
    const key = T.key[a.skill];
    out.push(`<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between">
      <b>${esc(testName(testInfo(a.test)))} · ${SKILL[a.skill]}</b><span class="muted">${fmtDate(a.finished)} · ${a.result.score}/${a.result.total}</span></div>
      <table class="ans-table" style="margin-top:8px"><tbody>${wrong.map((q) => `<tr class="wrong"><td style="width:40px"><b>${q}</b></td><td>${esc(a.answers[q] || '—')}</td><td class="ok">${esc(key[q]?.show || '')}</td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:8px"><a class="btn small" href="#/review/${a.id}">Review in test view</a></div></div>`);
  }
  $('#mlist', page).innerHTML = out.join('') || '<div class="card"><p class="muted" style="margin:0">No mistakes recorded yet.</p></div>';
}
