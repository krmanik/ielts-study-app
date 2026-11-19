import { $, $$, esc, SKILL, fmtClock, fmtDateTime, wordCount, toast, pageImg, modal } from '../util.js';
import { getAttempt, save, saveResult, getMock } from '../store.js';
import { loadTest, testInfo, testName } from '../data.js';
import { TYPE_LABEL, typeOf, fmtBand, overall } from '../mark.js';
import { startTest, mockNext, continueMock, attemptBand, FULL, latestBands } from '../actions.js';
import { getRec } from '../rec.js';
import { scopeText } from './home.js';
import { mountBandGuide } from '../bandguide.js';
import { icon } from '../icons.js';

const WCRIT = {
  1: [['TA', 'Task Achievement', 'Covers the key features, gives a clear overview, accurate data'], ['CC', 'Coherence & Cohesion', 'Logical organisation, paragraphs, linking words used naturally'], ['LR', 'Lexical Resource', 'Range and accuracy of vocabulary, spelling'], ['GRA', 'Grammatical Range & Accuracy', 'Mix of complex structures, few errors']],
  2: [['TR', 'Task Response', 'Answers every part of the question, clear position, developed ideas'], ['CC', 'Coherence & Cohesion', 'Logical organisation, paragraphs, linking words used naturally'], ['LR', 'Lexical Resource', 'Range and accuracy of vocabulary, spelling'], ['GRA', 'Grammatical Range & Accuracy', 'Mix of complex structures, few errors']],
};
const SCRIT = [['FC', 'Fluency & Coherence', 'Speaks at length without long pauses; ideas connected'], ['LR', 'Lexical Resource', 'Flexible vocabulary, paraphrase, idiomatic language'], ['GRA', 'Grammatical Range & Accuracy', 'Range of structures, mostly error-free sentences'], ['P', 'Pronunciation', 'Easy to understand, natural stress and intonation']];
const half = (x) => Math.round(x * 2) / 2;

export async function render(page, id) {
  const a = getAttempt(id);
  if (!a) { page.innerHTML = `<div class="card"><h2>Result not found</h2><a href="#/">Home</a></div>`; return; }
  if (!a.finished) { location.hash = `#/x/${id}`; return; }
  const T = await loadTest(a.test);
  const info = testInfo(a.test);
  const head = `<a class="back" href="#/t/${a.test}">${icon('arrow-left')} ${esc(testName(info))}</a>
    ${mockBanner(a)}
    <h1 style="margin-bottom:2px">${SKILL[a.skill]} results</h1>
    <p class="muted" style="margin-top:0">${esc(testName(info))} · ${scopeText(a)} · ${a.mode} mode · ${fmtDateTime(a.finished)} · time ${fmtClock(a.elapsed)}${a.skill === 'R' && a.limit ? ` of ${fmtClock(a.limit)} allowed` : ''}</p>`;
  if (a.skill === 'L' || a.skill === 'R') return renderLR(page, a, T, head);
  if (a.skill === 'W') return renderW(page, a, T, head);
  return renderS(page, a, T, head);
}

function mockBanner(a) {
  if (!a.mock) return '';
  const m = getMock(a.mock);
  const nx = mockNext(a.mock);
  if (!m) return '';
  if (nx) return `<div class="card next-card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between">
    <div><b>Full mock test</b> — next: <b>${SKILL[nx]}</b>${nx === 'R' ? ' (60 minutes)' : nx === 'W' ? ' (60 minutes)' : ''}. Take a short break if you need one.</div>
    <button class="btn" id="mock-next">Start ${SKILL[nx]} ${icon('play')}</button></div></div>`;
  return `<div class="card" style="margin-bottom:16px"><b>Full mock test complete.</b> <a href="#/mock/${m.id}">See the combined result ${icon('arrow-right')}</a></div>`;
}

function bindMock(page, a) {
  $('#mock-next', page)?.addEventListener('click', () => continueMock(a.mock));
}

// ---------------------------------------------------------------- Listening / Reading
function renderLR(page, a, T, head) {
  const r = a.result;
  const parts = T[a.skill].parts.filter((p) => a.parts.includes(p.n));
  const partial = a.parts.length < FULL[a.skill].length;
  const key = T.key[a.skill];
  const rows = [];
  parts.forEach((p) => p.groups.forEach((g) => {
    for (let q = g.from; q <= g.to; q++) rows.push({ q, part: p.n, type: typeOf(g) });
  }));
  const wrong = rows.filter((x) => !r.right[x.q]).length;
  const types = Object.entries(r.byType).sort((x, y) => x[1][0] / x[1][1] - y[1][0] / y[1][1]);
  page.innerHTML = `${head}
    <div class="grid2">
      <div class="card"><div class="score-hero">
        <div class="big-band"><div><b>${fmtBand(r.band)}</b><small>${partial ? 'est. band*' : 'band'}</small></div></div>
        <div><div style="font-size:30px;font-weight:800">${r.score} / ${r.total}</div>
        <p class="muted" style="margin:2px 0 10px">${wrong ? `${wrong} to review` : 'Perfect score!'}${partial ? '<br>*Estimated by scaling this part to 40 questions.' : ''}</p>
        <div class="row"><a class="btn primary" href="#/review/${a.id}">Review answers${a.skill === 'L' ? ' + transcript' : ''}</a>
        <button class="btn" id="retry">Try again</button></div></div>
      </div></div>
      <div class="card"><h3>By ${a.skill === 'L' ? 'part' : 'passage'}</h3><div class="bars">
        ${Object.entries(r.byPart).map(([n, [s, t]]) => bar(`${a.skill === 'L' ? 'Part' : 'Passage'} ${n}`, s, t)).join('')}
      </div>
      <h3 style="margin-top:16px">By question type</h3><div class="bars">
        ${types.map(([k, [s, t]]) => bar(TYPE_LABEL[k] || k, s, t)).join('')}
      </div></div>
    </div>
    <div class="section-title"><h2>What your band means</h2><span class="muted">pick a band to see the correct answers it takes</span></div>
    <div class="card" id="band-guide"></div>
    <div class="section-title"><h2>Answers</h2><label class="row muted" style="font-size:14px"><input type="checkbox" id="only-wrong"> Show only mistakes</label></div>
    <div class="card" style="overflow-x:auto"><table class="ans-table"><thead><tr><th>Q</th><th>Your answer</th><th>Correct answer</th><th></th><th>Type</th></tr></thead><tbody>
    ${rows.map((x) => `<tr class="${r.right[x.q] ? 'right' : 'wrong'}"><td><b>${x.q}</b></td><td>${esc(a.answers[x.q] || '—')}</td>
      <td>${esc(key[x.q]?.show || '')}</td><td>${r.right[x.q] ? `<span class="ok">${icon('check')}</span>` : `<span class="no">${icon('x')}</span>`}</td><td class="muted" style="font-size:13px">${esc(TYPE_LABEL[x.type] || x.type)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="font-size:13px">Marking accepts the alternatives printed in the book's answer key (e.g. words in brackets are optional). Spelling must be correct, as in the real test.</p>`;
  mountBandGuide($('#band-guide', page), a.skill, r);
  $('#only-wrong', page).onchange = (e) => $$('.ans-table tr.right', page).forEach((tr) => (tr.hidden = e.target.checked));
  $('#retry', page).onclick = () => startTest(a.test, a.skill, a.parts, a.mode);
  bindMock(page, a);
}

const bar = (label, s, t) => `<div class="bar-row"><span>${esc(label)}</span><div class="bar"><i style="width:${(s / t) * 100}%"></i></div><b>${s}/${t}</b></div>`;

// ---------------------------------------------------------------- Writing
function renderW(page, a, T, head) {
  const tasks = T.W.tasks.filter((t) => a.parts.includes(t.n));
  a.self ||= { crit: {} };
  page.innerHTML = `${head}
    <div class="card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between">
      <div><b>Score yourself</b> on each criterion after reading the sample answer and examiner comments. Your writing band is estimated from these (Task 2 counts double).</div>
      <div class="big-band" style="width:86px;height:86px"><div><b id="wband">${fmtBand(a.self.band)}</b><small>self</small></div></div></div></div>
    ${tasks.map((t) => `
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Task ${t.n}</h2>
        <span class="pill ${wordCount(a.essays[t.n]) >= (t.n === 1 ? 150 : 250) ? 'good' : 'warn'}">${wordCount(a.essays[t.n])} words</span></div>
      <p class="muted">${esc(t.text.filter((x) => !/^(You should spend|Write at least|WRITING)/.test(x)).join(' '))}</p>
      <div class="grid2">
        <div><h3>Your answer</h3><div class="essay">${esc(a.essays[t.n] || '(no answer)')}</div>
          <div class="row" style="margin-top:10px"><button class="btn small" data-ai="${t.n}">Copy for AI feedback</button>
          <span class="muted" style="font-size:12.5px">Paste into Claude or another assistant for a detailed review.</span></div></div>
        <div><h3>Score yourself</h3><div class="criteria">${WCRIT[t.n].map(([k, l, d]) => crit(`w${t.n}-${k}`, l, d, a.self.crit[t.n]?.[k])).join('')}</div></div>
      </div>
      ${t.samplePages.length ? `<h3 style="margin-top:16px">Sample answer and examiner comments from the book</h3>
      <div class="page-thumbs">${t.samplePages.map((p) => `<img src="pages/${T.book}/${p}.jpg" data-zoom="${p}" alt="Sample answer page">`).join('')}</div>` : ''}
    </div>`).join('')}
    <div class="row"><button class="btn" id="retry">Write again</button></div>`;
  page.addEventListener('input', (e) => {
    const k = e.target.dataset.crit;
    if (!k) return;
    const [tn, c] = k.slice(1).split('-');
    (a.self.crit[tn] ||= {})[c] = +e.target.value;
    e.target.closest('.crit').querySelector('output').textContent = fmtBand(+e.target.value);
    a.self.band = writingBand(a, tasks);
    $('#wband', page).textContent = fmtBand(a.self.band);
    save();
  });
  page.addEventListener('change', (e) => { if (e.target.dataset.crit) saveResult(a, 'self-assessment'); });
  page.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) modal(`<div class="lightbox">${pageImg(T.book, +z.dataset.zoom)}</div><div class="actions"><button class="btn primary" data-close="ok">Close</button></div>`, { wide: true });
    const ai = e.target.closest('[data-ai]');
    if (ai) {
      const t = tasks.find((x) => x.n === +ai.dataset.ai);
      const prompt = `Act as an experienced IELTS examiner. Assess my IELTS Academic Writing Task ${t.n} response using the four official criteria (${t.n === 1 ? 'Task Achievement' : 'Task Response'}, Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy). Give a band for each criterion and an overall band, quote my mistakes with corrections, and give me the 3 most useful things to improve.${t.n === 1 ? '\n\n(The task includes a chart/diagram I cannot paste; judge whether my overview and key features seem complete.)' : ''}\n\nTASK:\n${t.text.join('\n')}\n\nMY ANSWER (${wordCount(a.essays[t.n])} words):\n${a.essays[t.n] || ''}`;
      navigator.clipboard.writeText(prompt).then(() => toast('Copied — paste it into your AI assistant'), () => toast('Could not copy'));
    }
  });
  $('#retry', page).onclick = () => startTest(a.test, 'W', a.parts, a.mode);
  bindMock(page, a);
}

function writingBand(a, tasks) {
  const tb = {};
  for (const t of tasks) {
    const c = a.self.crit[t.n] || {};
    const vals = WCRIT[t.n].map(([k]) => c[k]).filter((v) => v != null);
    if (vals.length === 4) tb[t.n] = vals.reduce((x, y) => x + y, 0) / 4;
  }
  if (tasks.length === 2) return tb[1] != null && tb[2] != null ? half((tb[1] + 2 * tb[2]) / 3) : null;
  return tb[tasks[0].n] != null ? half(tb[tasks[0].n]) : null;
}

const crit = (id, label, desc, val) => `<div class="crit"><div><b>${label}</b><br><small class="muted">${desc}</small></div>
  <output>${val != null ? fmtBand(val) : '–'}</output>
  <input type="range" min="3" max="9" step="0.5" value="${val ?? 6}" data-crit="${id}" aria-label="${label}"></div>`;

// ---------------------------------------------------------------- Speaking
async function renderS(page, a, T, head) {
  a.self ||= { crit: {} };
  page.innerHTML = `${head}
    <div class="grid2">
      <div class="card"><h3>Your recordings</h3><div id="recs" class="stack"><p class="muted">Loading…</p></div>
        <p class="muted" style="font-size:13px">Tip: listen once for fluency, once for grammar mistakes. Note words you were missing.</p></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Score yourself</h3>
        <div class="big-band" style="width:80px;height:80px"><div><b id="sband">${fmtBand(a.self.band)}</b><small>self</small></div></div></div>
        <div class="criteria" style="margin-top:10px">${SCRIT.map(([k, l, d]) => crit(`s-${k}`, l, d, a.self.crit[k])).join('')}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Questions from the book</h3>${(T.S.parts || []).map((p) => `<h4>Part ${p.n}</h4>${p.items.map((i) => i.q ? `<p>• ${esc(i.q)}</p>` : i.topic ? `<p><b>${esc(i.topic)}</b></p>` : `<p>${esc(i.t || '')}</p>`).join('')}`).join('')}</div>`;
  const box = $('#recs', page);
  const urls = [];
  const items = [];
  for (const r of a.recs || []) {
    const rec = await getRec(r.id).catch(() => null);
    if (!rec) continue;
    const u = URL.createObjectURL(rec.blob); urls.push(u);
    items.push(`<div><b>Part ${r.part}</b> <span class="muted">${fmtClock(r.dur)}</span><br><audio controls src="${u}" style="width:100%"></audio></div>`);
  }
  box.innerHTML = items.join('') || '<p class="muted">No recordings were saved.</p>';
  page.addEventListener('input', (e) => {
    const k = e.target.dataset.crit;
    if (!k) return;
    a.self.crit[k.slice(2)] = +e.target.value;
    e.target.closest('.crit').querySelector('output').textContent = fmtBand(+e.target.value);
    const vals = SCRIT.map(([c]) => a.self.crit[c]).filter((v) => v != null);
    a.self.band = vals.length === 4 ? half(vals.reduce((x, y) => x + y, 0) / 4) : null;
    $('#sband', page).textContent = fmtBand(a.self.band);
    save();
  });
  page.addEventListener('change', (e) => { if (e.target.dataset.crit) saveResult(a, 'self-assessment'); });
  return () => urls.forEach(URL.revokeObjectURL);
}

// ---------------------------------------------------------------- mock summary
export async function renderMock(page, id) {
  const m = getMock(id);
  if (!m) { page.innerHTML = '<div class="card">Mock test not found.</div>'; return; }
  const info = testInfo(m.test);
  const atts = Object.fromEntries(Object.entries(m.ids).map(([s, aid]) => [s, getAttempt(aid)]));
  const bands = ['L', 'R', 'W'].map((s) => attemptBand(atts[s]));
  const sp = latestBands().S?.band ?? null;
  page.innerHTML = `<a class="back" href="#/t/${m.test}">${icon('arrow-left')} ${esc(testName(info))}</a><h1>Full mock test</h1>
    <div class="card"><div class="bands">${['L', 'R', 'W'].map((s, i) => `<div class="band-box"><b>${fmtBand(bands[i])}</b><small>${SKILL[s]}</small>${atts[s] ? `<br><a href="#/r/${atts[s].id}" style="font-size:12px">details</a>` : ''}</div>`).join('')}
      <div class="band-box"><b>${fmtBand(sp)}</b><small>Speaking</small><br><a href="#/t/${m.test}" style="font-size:12px">${sp == null ? 'take it' : 'latest'}</a></div>
      <div class="band-box overall"><b>${fmtBand(overall(bands.concat([sp])))}</b><small>Overall</small></div></div>
    <p class="muted" style="margin-bottom:0">Writing and Speaking use your self-assessment (Speaking: your latest result).</p></div>`;
}
