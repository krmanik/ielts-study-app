import { esc, fmtDate } from '../util.js';
import { S, save } from '../store.js';
import { TEST, TRACK } from '../data.js';
import { setChrome } from '../chrome.js';
import { markPart, isRight } from '../grade.js';
import { icon } from '../../cbt/js/icons.js';

/** Wrong answers from all marked Listening/Reading attempts (latest attempt per test part only). */
function collect() {
  const latest = {};
  for (const a of S().attempts) {
    if (a.part !== 'listening' && a.part !== 'reading') continue;
    const k = a.test + a.part;
    if (!latest[k] || latest[k].finishedAt < a.finishedAt) latest[k] = a;
  }
  const out = [];
  for (const a of Object.values(latest)) {
    const t = TEST[a.test];
    const secs = a.part === 'listening' ? t.listening : t.reading;
    const rows = markPart(t.answers[a.part], a.answers);
    for (const r of rows) {
      const sec = secs.find((s) => !s.missing && r.q >= s.qs[0] && r.q <= s.qs[1]);
      if (!sec || isRight(r, a.overrides)) continue;
      out.push({ a, t, sec, r, key: `${a.id}:${r.q}` });
    }
  }
  return out;
}

export function render(view) {
  setChrome({ crumbs: '<b>Mistake log</b>' });
  let showFixed = false, part = 'all';
  const draw = () => {
    const st = S();
    st.fixed ||= {};
    const all = collect();
    const list = all.filter((m) => (showFixed || !st.fixed[m.key]) && (part === 'all' || m.a.part === part));
    view.innerHTML = `
      <h1>Mistake log</h1>
      <p class="muted" style="margin-top:-4px">Every question you got wrong in your latest Listening and Reading attempts. Work out <i>why</i> using the script or passage, then tick it off.</p>
      <div class="row" style="margin-bottom:14px">
        <div class="seg">${['all', 'listening', 'reading'].map((p) => `<button data-part="${p}" class="${part === p ? 'on' : ''}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
        <label class="row" style="gap:6px;font-size:14px"><input type="checkbox" id="sf" ${showFixed ? 'checked' : ''}> Show reviewed</label>
        <span class="muted" style="font-size:14px">${all.filter((m) => !st.fixed[m.key]).length} to review</span>
      </div>
      ${list.length ? `<div class="card" style="padding:0">${list.map((m) => `
        <div class="result-row" style="${st.fixed[m.key] ? 'opacity:.55' : ''}">
          <button class="check ${st.fixed[m.key] ? 'on' : ''}" data-fix="${m.key}" title="Mark reviewed" aria-label="Mark reviewed">${icon('check')}</button>
          <div class="grow"><b>${esc(m.t.title)} · ${m.a.part === 'listening' ? 'Section' : 'Passage'} ${m.sec.n} · Q${m.r.q}</b>
            <div><small>You wrote</small> ${m.r.user ? `<s>${esc(m.r.user)}</s>` : '<span class="muted">(blank)</span>'} · <small>Answer</small> <b>${esc(m.r.key)}</b></div></div>
          <a class="btn sm" href="#/page/${m.sec.start}">Question</a>
          ${m.sec.script ? `<a class="btn sm" href="#/page/${m.sec.script.page}?y=${m.sec.script.y}">Script</a>` : ''}
          ${m.sec.key ? `<a class="btn sm" href="#/page/${m.sec.key.page}?y=${m.sec.key.y}">Key</a>` : ''}
        </div>`).join('')}</div>`
        : `<div class="empty">${all.length ? 'All reviewed — nice work.' : 'No mistakes yet. Take a timed Listening or Reading test and wrong answers will collect here.'}</div>`}`;
  };
  view.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fix]');
    if (f) { const st = S(); st.fixed ||= {}; if (st.fixed[f.dataset.fix]) delete st.fixed[f.dataset.fix]; else st.fixed[f.dataset.fix] = Date.now(); save(); draw(); }
    const p = e.target.closest('[data-part]');
    if (p) { part = p.dataset.part; draw(); }
  });
  view.addEventListener('change', (e) => { if (e.target.id === 'sf') { showFixed = e.target.checked; draw(); } });
  draw();
}
