import { esc, SKILL, fmtDateTime, fmtClock, confirmBox } from '../util.js';
import { loadTest, testInfo, testName } from '../data.js';
import { attemptsFor, deleteAttempt } from '../store.js';
import { startTest, startMock, attemptBand, FULL } from '../actions.js';
import { fmtBand } from '../mark.js';
import { scopeText } from './home.js';
import { icon } from '../icons.js';

export async function render(page, id) {
  const T = await loadTest(id);
  const info = testInfo(id);
  const draw = () => {
    const atts = attemptsFor(id);
    page.innerHTML = `<a class="back" href="#/tests">${icon('arrow-left')} All tests</a>
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <div><h1 style="margin:0">${esc(testName(info))}</h1>
      <p class="muted" style="margin:4px 0 0">Cambridge IELTS ${esc(T.book)} Academic</p></div>
      <button class="btn primary" data-mock="1" title="Listening, Reading and Writing back to back, in exam mode">${icon('play')} Full mock test (L + R + W)</button>
    </div>
    <div class="grid2" style="margin-top:18px">
      ${card('L', 'Listening', '4 parts · 40 questions · about 30 minutes',
        T.L.parts.map((p) => [p.n, `Part ${p.n}`, `Questions ${p.from}–${p.to}`]), atts, T)}
      ${card('R', 'Reading', '3 passages · 40 questions · 60 minutes',
        T.R.parts.map((p) => [p.n, `Passage ${p.n}`, p.title || `Questions ${p.from}–${p.to}`]), atts, T)}
      ${card('W', 'Writing', '2 tasks · 60 minutes',
        [[1, 'Task 1', 'Describe a visual · 20 min · 150 words'], [2, 'Task 2', 'Essay · 40 min · 250 words']], atts, T)}
      ${card('S', 'Speaking', '3 parts · 11–14 minutes · recorded',
        [], atts, T)}
    </div>
    ${atts.length ? `<div class="section-title"><h2>Your attempts</h2></div>
      <div class="card" style="overflow-x:auto"><table class="attempts"><thead><tr><th>Date</th><th>Skill</th><th>What</th><th>Mode</th><th>Result</th><th>Time</th><th></th></tr></thead><tbody>
      ${atts.map((a) => `<tr><td>${fmtDateTime(a.created)}</td><td>${SKILL[a.skill]}</td><td>${scopeText(a)}</td><td>${a.mode}</td>
        <td>${a.finished ? resultText(a) : '<span class="pill warn">in progress</span>'}</td><td>${fmtClock(a.elapsed)}</td>
        <td class="row" style="flex-wrap:nowrap;justify-content:flex-end">${a.finished ? `<a class="btn small" href="#/r/${a.id}">Results</a>` : `<a class="btn small primary" href="#/x/${a.id}">Continue</a>`}
        <button class="btn small ghost" data-del="${a.id}" title="Delete attempt" aria-label="Delete attempt">${icon('trash-2')}</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}`;
  };
  draw();
  page.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-go]');
    if (s) {
      const [skill, which, mode] = s.dataset.go.split('|');
      startTest(id, skill, which === 'full' ? FULL[skill] : [+which], mode);
    }
    if (e.target.closest('[data-mock]')) startMock(id);
    const d = e.target.closest('[data-del]');
    if (d && (await confirmBox('Delete this attempt and its answers?', 'Delete'))) { deleteAttempt(d.dataset.del); draw(); }
  });
}

function card(sk, title, sub, parts, atts, T) {
  const mine = atts.filter((a) => a.skill === sk && a.finished);
  const last = mine[0];
  const hasAudio = sk !== 'L' || T.L.parts.every((p) => p.audio);
  return `<div class="card skill-card">
    <h2><span class="ico">${sk}</span>${title}${last ? `<span class="pill good" style="margin-left:auto">last: ${resultText(last)}</span>` : ''}</h2>
    <p class="muted" style="margin-top:-4px">${sub}</p>
    <div class="row">
      ${sk === 'S' ? `<button class="btn primary" data-go="S|full|exam">Start speaking test</button>`
        : `<button class="btn primary" data-go="${sk}|full|exam" ${hasAudio ? '' : 'disabled'}>Exam mode</button>
           <button class="btn" data-go="${sk}|full|practice">Practice mode</button>`}
    </div>
    ${parts.length ? `<p class="muted" style="margin:14px 0 0;font-size:13px">${sk === 'W' ? 'Or one task:' : 'Short on time? Do one at a time:'}</p>
    <div class="parts">${parts.map(([n, l, s2]) => `<button class="btn small" data-go="${sk}|${n}|practice" title="${esc(s2)}">${esc(l)}${sk === 'R' ? ` <span class="muted" style="font-weight:400">· ${esc(trim(s2, 28))}</span>` : ''}</button>`).join('')}</div>` : ''}
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">${{ L: 'Exam mode plays each recording once, then gives you 2 minutes to check. Practice mode lets you pause and replay.', R: 'Exam mode ends automatically when the time is up — choose 60, 50 or 40 minutes on the start screen. Practice keeps the clock running if you go over.', W: 'Compare with the sample answer afterwards and score yourself on the 4 criteria.', S: 'The examiner voice asks the questions; your answers are recorded for you to review.' }[sk]}</p>
  </div>`;
}

const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function resultText(a) {
  if (a.skill === 'L' || a.skill === 'R') return `${a.result.score}/${a.result.total} · band ${fmtBand(a.result.band)}${a.parts.length < FULL[a.skill].length ? '*' : ''}`;
  const b = attemptBand(a);
  return b != null ? `band ${fmtBand(b)} (self)` : 'not scored yet';
}
