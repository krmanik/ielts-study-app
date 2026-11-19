import { $, esc, SKILL, fmtMins, dayKey } from '../util.js';
import { books, allTests, testInfo, testName } from '../data.js';
import { S, settings, setSetting, finishedAttempts } from '../store.js';
import { latestBands, testStatus, suggestion, startTest, FULL, examPlan, REST_DAYS } from '../actions.js';
import { fmtBand } from '../mark.js';
import { icon } from '../icons.js';

const PART_WORD = { L: 'Part', R: 'Passage', W: 'Task', S: 'Part' };

export function render(page) {
  const b = latestBands();
  const sug = suggestion();
  const st = settings();
  const done = finishedAttempts();
  const week = weekSeconds();

  let next = '';
  if (sug?.kind === 'continue') {
    const a = sug.attempt, t = testInfo(a.test);
    next = `<div class="card next-card"><small class="muted">Continue where you left off</small>
      <h2 style="margin:6px 0 4px">${esc(testName(t))} · ${SKILL[a.skill]}</h2>
      <p class="muted">${scopeText(a)} · ${a.mode === 'exam' ? 'exam mode' : 'practice'} · ${Object.keys(a.answers).length ? `${Object.keys(a.answers).length} answers so far` : 'just started'}</p>
      <div class="row"><a class="btn big" href="#/x/${a.id}">Continue ${icon('arrow-right')}</a></div></div>`;
  } else if (sug) {
    const t = sug.test, s = sug.skill;
    next = `<div class="card next-card"><small class="muted">Suggested next step</small>
      <h2 style="margin:6px 0 4px">${esc(testName(t))} · ${SKILL[s]}</h2>
      <p class="muted">${s === 'L' ? 'About 30 minutes. Start with one part if you prefer a short session.' : s === 'R' ? '60 minutes for 3 passages — or one passage in 20 minutes.' : s === 'W' ? 'Task 1 (20 min) and Task 2 (40 min).' : 'About 12 minutes with the examiner voice.'}</p>
      <div class="row"><button class="btn big" data-start="${t.id}|${s}|full">Start full ${SKILL[s]}</button>
      ${s !== 'S' ? `<button class="btn big ghost" style="color:#fff;border-color:rgba(255,255,255,.5);background:transparent" data-start="${t.id}|${s}|1">Just ${PART_WORD[s]} 1</button>` : ''}</div></div>`;
  } else {
    next = `<div class="card next-card"><h2>All tests attempted</h2><p class="muted">Review your mistakes or retake a test to track improvement.</p></div>`;
  }

  page.innerHTML = `
    <div class="hero">
      ${next}
      <div class="card">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">Your latest bands</h3><a href="#/progress">Progress ${icon('arrow-right')}</a></div>
        <div class="bands" style="margin-top:12px">
          ${['L', 'R', 'W', 'S'].map((s) => `<div class="band-box"><b>${fmtBand(b[s]?.band)}</b><small>${SKILL[s]}</small></div>`).join('')}
          <div class="band-box overall"><b>${fmtBand(b.overall)}</b><small>Overall</small></div>
        </div>
        <p class="muted" style="margin:12px 0 0;font-size:13px">Target ${fmtBand(st.target)} · ${done.length} section${done.length === 1 ? '' : 's'} completed · ${fmtMins(week)} this week</p>
        ${b.overall == null ? `<p class="muted" style="font-size:13px;margin:6px 0 0">The overall band appears once you have a result in all four skills. Writing and Speaking are self-assessed.</p>` : ''}
      </div>
    </div>
    <div id="exam-card">${examCard()}</div>
    <div class="section-title"><h2>Cambridge IELTS ${books()[0].id}–${books().at(-1).id} · Academic</h2><span class="muted">${allTests().length} tests</span></div>
    ${library()}`;
  page.addEventListener('click', onStart);
  page.addEventListener('change', (e) => {
    if (e.target.id !== 'plan-goal') return;
    setSetting('planTests', +e.target.value);
    $('#exam-card', page).innerHTML = examCard();
    $('#plan-goal', page)?.focus();
  });
  // the countdown ticks every second
  const tick = setInterval(() => {
    const el = $('#countdown', page);
    if (el) el.innerHTML = countdown();
  }, 1000);
  return () => clearInterval(tick);
}

// ---------------------------------------------------------------- exam countdown and plan
const longDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function countdown() {
  const exam = new Date(settings().examDate + 'T00:00');
  let s = Math.max(0, Math.floor((exam - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return [[d, 'days'], [h, 'hours'], [m, 'min'], [s, 'sec']].map(([v, l]) => `<div class="cd-box"><b>${String(v).padStart(2, '0')}</b><small>${l}</small></div>`).join('');
}

function examCard() {
  const p = examPlan();
  if (!p) return `<div class="card exam-plan empty"><span>${icon('calendar')} <b>When is your exam?</b> Set the date to see a countdown and how many tests to finish before it.</span><a class="btn small" href="#/settings">Set exam date</a></div>`;
  if (p.daysToExam < 0) return `<div class="card exam-plan empty"><span>Your exam date (${longDate(p.exam)}) has passed.</span><a class="btn small" href="#/settings">Set a new date</a></div>`;
  const total = allTests().length;
  const done = p.sectionsGoal - p.sectionsLeft;
  const goalSel = `<select id="plan-goal" aria-label="Tests to finish before the exam"><option value="0">all ${total} tests</option>${[2, 4, 6, 8, 12, 16, 20, 24, 32].filter((n) => n < total).map((n) => `<option value="${n}"${p.goal === n ? ' selected' : ''}>${n} tests</option>`).join('')}</select>`;
  let pace;
  if (!p.sectionsLeft) pace = `<p class="plan-pace good">${icon('circle-check')} Goal reached — everything in your plan is done. Review your mistakes or raise the goal.</p>`;
  else if (!p.studyDays) pace = `<p class="plan-pace">The plan ended on ${longDate(p.deadline)}. Use the last ${p.daysToExam === 0 ? 'hours' : 'days'} to rest and review your mistakes — not for new tests.</p>`;
  else {
    const perDay = p.sectionsLeft / p.studyDays, perWeek = Math.round(perDay * 7), minDay = Math.round(p.minutesLeft / p.studyDays);
    const days = `<b>${plural(p.studyDays, 'study day')}</b> left`;
    if (perWeek < 1) pace = `<p class="plan-pace">${days} for ${plural(p.sectionsLeft, 'section')} — plenty of time.</p>`;
    else if (perDay < 1) pace = `<p class="plan-pace">${days} → about <b>${perWeek}</b> ${perWeek > 1 ? 'sections' : 'section'} a week (≈ ${fmtMins(minDay * 7 * 60)}).</p>`;
    else pace = `<p class="plan-pace">${days} → about <b>${perDay >= 10 ? Math.round(perDay) : +perDay.toFixed(1)}</b> ${perDay === 1 ? 'section' : 'sections'} a day (≈ ${fmtMins(minDay * 60)}).</p>
      ${minDay > 180 ? `<p class="plan-warn">${icon('triangle-alert')} That is more than 3 hours every day. Choose fewer tests above so the plan is one you can keep.</p>` : ''}`;
  }
  return `<div class="card exam-plan">
    <div class="cd">
      <small class="muted">${p.daysToExam === 0 ? 'Exam day' : 'Time to your exam'}</small>
      <div class="cd-boxes" id="countdown" role="timer" aria-label="${plural(p.daysToExam, 'day')} to your exam">${countdown()}</div>
      <small class="muted">${p.daysToExam === 0 ? 'Good luck today!' : longDate(p.exam)} · <a href="#/settings">change</a></small>
    </div>
    <div class="plan">
      <h3>Finish ${goalSel} by ${longDate(p.deadline)} <span class="muted" style="font-weight:400">— ${REST_DAYS} days before the exam</span></h3>
      <div class="plan-nums">
        <div><b>${p.testsLeft}</b><small>${p.testsLeft === 1 ? 'test' : 'tests'} left<br>${p.testsDone} of ${p.goal} done</small></div>
        <div><b>${p.sectionsLeft}</b><small>${p.sectionsLeft === 1 ? 'section' : 'sections'} left<br>${done} of ${p.sectionsGoal} done</small></div>
        <div class="plan-skills">${['L', 'R', 'W', 'S'].map((s) => `<span><b>${p.left[s]}</b> ${SKILL[s]}</span>`).join('')}</div>
      </div>
      <div class="bar" role="img" aria-label="${done} of ${p.sectionsGoal} sections done"><i style="width:${(done / p.sectionsGoal) * 100}%"></i></div>
      ${pace}
      <p class="muted" style="font-size:12.5px;margin:6px 0 0">${p.goal} tests = ${p.goal} each of Listening, Reading, Writing and Speaking. A section counts when every part of it is finished, in exam or practice mode — in one sitting or one part at a time.</p>
    </div>
  </div>`;
}

export function renderLibrary(page) {
  page.innerHTML = `<div class="section-title" style="margin-top:0"><h1 style="margin:0">All tests</h1><span class="muted">Pick a test, then choose a skill</span></div>${library()}`;
}

function library() {
  return `<div class="stack">${books().map((b) => `
    <div class="card book">
      <div class="book-head"><div class="book-cover">${b.id}</div><div><h3>${esc(b.name)}</h3><small class="muted">Academic · 4 tests${b.id === '12' ? ' (printed as Tests 5–8)' : ''}</small></div></div>
      <div class="tests">${b.tests.map((t) => {
        const st = testStatus(t.id);
        return `<a class="test-cell" href="#/t/${t.id}"><b>${esc(t.label)}</b>
          <div class="skills">${['L', 'R', 'W', 'S'].map((s) => `<span class="sk${st[s] ? ' done' : ''}" title="${SKILL[s]}${st[s]?.band != null ? ' · band ' + fmtBand(st[s].band) : ''}">${st[s]?.band != null ? fmtBand(st[s].band) : s}</span>`).join('')}</div>
          <small class="muted titles">${esc((t.titles || []).filter(Boolean).slice(0, 1).join(''))}</small></a>`;
      }).join('')}</div>
    </div>`).join('')}</div>`;
}

function onStart(e) {
  const b = e.target.closest('[data-start]');
  if (!b) return;
  const [test, skill, which] = b.dataset.start.split('|');
  startTest(test, skill, which === 'full' ? FULL[skill] : [+which], which === 'full' && skill !== 'S' ? 'exam' : 'practice');
}

function scopeText(a) {
  if (a.parts.length === FULL[a.skill].length) return `Full ${SKILL[a.skill]}`;
  return a.parts.map((p) => `${PART_WORD[a.skill]} ${p}`).join(', ');
}
export { scopeText };

function weekSeconds() {
  const act = S().activity;
  let t = 0;
  const d = new Date();
  for (let i = 0; i < 7; i++) { t += act[dayKey(d)] || 0; d.setDate(d.getDate() - 1); }
  return t;
}
