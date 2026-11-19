// Today: one thing to carry on with, one small next step per skill, and where you stand.
import { $, esc, fmtMins, dayKey, toast } from '../util.js';
import { testInfo, testName } from '../data.js';
import { S, settings, onChange, onSync, syncStatus, openAttempts, finishedAttempts } from '../store.js';
import { latestBands, startTest, FULL, examPlan } from '../actions.js';
import { fmtBand } from '../mark.js';
import { scopeText } from '../views/home.js';
import { offlineOK, standalone, appSaved, savedIds, isSaved, onOffline, saveTest, testBytes, fmtMB, allIds } from './offline.js';
import { skBadge, chevron, syncChip, nextPart, partLabel, partTime, SKILL, LOCAL, PART_WORD, STATIC, inReach } from './ui.js';
import { icon } from '../icons.js';

const SKILLS = ['L', 'R', 'W', 'S'];

export function render(page) {
  let busy = false;      // a download started from here is running
  const draw = () => {
    if (busy) return;
    const st = settings(), b = latestBands(), plan = examPlan();
    const open = openAttempts()[0];
    const done = finishedAttempts();
    // the skill left alone longest comes first
    const lastOf = (s) => done.filter((a) => a.skill === s).at(-1)?.finished || 0;
    const steps = SKILLS.map((s) => ({ s, next: nextPart(s) })).filter((x) => x.next);
    const first = [...steps].sort((x, y) => lastOf(x.s) - lastOf(y.s))[0];

    page.innerHTML = `
      <header class="m-top"><h1>Today</h1>${syncChip()}</header>
      <div class="m-cols"><div>
      ${plan && plan.daysToExam >= 0 ? `<a class="m-exam" href="#/more">
        <b>${plan.daysToExam}</b><span>${plan.daysToExam === 1 ? 'day' : 'days'} to your exam<small>${plan.exam.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · target ${fmtBand(st.target)}</small></span></a>`
    : `<a class="m-exam empty" href="#/more"><span>Set your exam date<small>to see the days left</small></span>${chevron}</a>`}

      ${open ? continueCard(open) : first ? nextCard(first) : `<div class="card m-hero"><h2>Every test is done</h2><p>Look through your mistakes, or take a test again.</p></div>`}

      ${steps.length ? `<h2 class="m-h">A small step in each skill</h2>
      <div class="m-list">${steps.map(({ s, next }) => stepRow(s, next)).join('')}</div>` : ''}
      </div><div>
      <h2 class="m-h">Where you stand</h2>
      <div class="card m-bands">
        ${SKILLS.map((s) => `<div><b>${fmtBand(b[s]?.band)}</b><small>${SKILL[s]}</small></div>`).join('')}
        <div class="all"><b>${fmtBand(b.overall)}</b><small>Overall</small></div>
      </div>
      <p class="m-note">${fmtMins(weekSeconds())} this week · ${done.length} finished${plan && plan.sectionsLeft ? ` · ${plan.sectionsLeft} sections left in your plan` : ''}</p>

      ${travelCard()}
      </div></div>`;
  };

  draw();
  const offs = [onChange(draw), onOffline(draw), onSync(() => { const c = $('.m-chip', page); if (c) c.outerHTML = syncChip(); })];

  page.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      const [test, skill, part] = go.dataset.go.split('|');
      if (skill === 'L' && !isSaved(test) && !inReach()) {
        toast(`This recording is not on your device yet. Save the test while ${STATIC ? 'you are online' : 'your Mac is in reach'}.`, 4000);
        location.hash = `#/t/${test}`;
        return;
      }
      startTest(test, skill, part ? [+part] : FULL[skill], skill === 'S' ? 'exam' : 'practice');
      return;
    }
    if (e.target.closest('[data-hide-travel]')) { localStorage.setItem('ielts-cbt.travel', 'hidden'); draw(); return; }
    const sv = e.target.closest('[data-save-next]');
    if (sv && !busy) {
      const ids = sv.dataset.saveNext.split(',');
      busy = true;
      try {
        for (let i = 0; i < ids.length; i++) {
          await saveTest(ids[i], (d, n) => { sv.disabled = true; sv.textContent = `Saving test ${i + 1} of ${ids.length} · ${Math.round((d / n) * 100)}%`; });
        }
        toast('Saved on this device');
      } catch (err) { toast(err.message, 4000); }
      busy = false;
      draw();
    }
  });
  return () => offs.forEach((f) => f());
}

function continueCard(a) {
  const t = testInfo(a.test), n = Object.keys(a.answers).length;
  return `<a class="card m-hero" href="#/x/${a.id}">
    <small>Carry on where you stopped</small>
    <h2>${SKILL[a.skill]} · ${esc(testName(t))}</h2>
    <p>${scopeText(a)} · ${a.mode === 'exam' ? 'exam mode' : 'practice'}${a.skill === 'W' ? '' : ` · ${n ? `${n} answered` : 'just started'}`}</p>
    <span class="go">Continue ${icon('arrow-right')}</span></a>`;
}

function nextCard({ s, next }) {
  const { t, part } = next;
  return `<button class="card m-hero" data-go="${t.id}|${s}|${part || ''}">
    <small>Next up · ${partTime(s, part)}</small>
    <h2>${SKILL[s]} · ${esc(testName(t))}</h2>
    <p>${esc(partLabel(s, t, part))}</p>
    <span class="go">Start ${icon('arrow-right')}</span></button>`;
}

function stepRow(s, { t, part }) {
  const need = s === 'L' && !LOCAL && !isSaved(t.id);
  return `<button class="m-row" data-go="${t.id}|${s}|${part || ''}">
    ${skBadge(s)}
    <span class="grow"><b>${SKILL[s]}${part ? ` · ${PART_WORD[s]} ${part}` : ''}</b><small>${esc(testName(t))}${s === 'R' && t.titles?.[part - 1] ? ' · ' + esc(t.titles[part - 1]) : ''}</small></span>
    <span class="meta">${need ? '<span class="pill warn">not saved</span>' : partTime(s, part)}</span>${chevron}</button>`;
}

/** What to do before leaving home: shown until it is all done or put away. */
function travelCard() {
  if (LOCAL || localStorage.getItem('ielts-cbt.travel') === 'hidden') return '';
  const tick = (ok, text, sub = '') => `<li class="${ok ? 'ok' : ''}"><i>${ok ? icon('check') : ''}</i><span>${text}${sub ? `<small>${sub}</small>` : ''}</span></li>`;
  if (!offlineOK) {
    return `<h2 class="m-h">Before you travel</h2><div class="card m-travel">
      <p>This address only works while your Mac is on and on the same Wi-Fi. To keep the tests on your device, open the <b>https</b> address shown in the window on your Mac instead.</p></div>`;
  }
  const saved = savedIds(), all = allIds();
  // the tests you will reach next, not yet on the device
  const want = [];
  for (const s of ['L', 'R', 'W']) { const n = nextPart(s); if (n && !saved.has(n.t.id) && !want.includes(n.t.id)) want.push(n.t.id); }
  for (const id of all) { if (want.length >= 3) break; if (!saved.has(id) && !want.includes(id)) want.push(id); }
  const size = want.reduce((x, id) => x + testBytes(id), 0);
  // a home-screen icon is a phone's and a tablet's way of keeping an app; a laptop keeps it in the browser
  const touch = matchMedia('(pointer: coarse)').matches;
  const ready = (standalone() || !touch) && appSaved() && saved.size > 0;
  return `<h2 class="m-h">Before you travel</h2><div class="card m-travel">
    <ul>
      ${!touch ? '' : tick(standalone(), 'Open the app from its home-screen icon', standalone() ? '' : 'Share → Add to Home Screen, then open the new icon and come back to this list. What you save in the browser tab does not carry over to the icon.')}
      ${tick(appSaved(), 'The app and all Reading and Writing text are on this device', appSaved() ? '' : 'Saving… keep this page open for a moment.')}
      ${tick(saved.size > 0, `Recordings and pictures: ${saved.size} of ${all.length} tests saved`, 'Listening needs the recording; some questions need a picture from the book.')}
    </ul>
    ${want.length && appSaved() ? `<button class="btn primary block" data-save-next="${want.join(',')}">Save the next ${want.length} test${want.length > 1 ? 's' : ''}${size ? ` · ${fmtMB(size)}` : ''}</button>` : ''}
    <div class="row between"><a href="#/tests">Choose tests to save</a>${ready ? '<button class="btn small ghost" data-hide-travel>Done — hide this</button>' : ''}</div>
  </div>`;
}

function weekSeconds() {
  const act = S().activity;
  let t = 0;
  const d = new Date();
  for (let i = 0; i < 7; i++) { t += act[dayKey(d)] || 0; d.setDate(d.getDate() - 1); }
  return t;
}
