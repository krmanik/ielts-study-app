import { $, $$, esc, fmtTime, toast, uid, wordCount, debounce, confirmBox, fmtDateTime } from '../util.js';
import { S, save, settings, setSetting } from '../store.js';
import { TEST, MOD, label, pages, TRACK } from '../data.js';
import { setChrome, crumbs, setGuard, clearGuard } from '../chrome.js';
import { pagesHTML, mountPages, scrollToPage } from '../reader.js';
import { play, stop, current, onPlayer } from '../player.js';
import { markPart, scoreOf, isRight, band, bandFmt, CRITERIA, criteriaBand } from '../grade.js';
import { PARTS } from './tests.js';
import { putRec, allRecs, delRec } from '../db.js';
import { icon } from '../../cbt/js/icons.js';

const draftKey = (tid, part) => `${tid}/${part}`;

export async function render(view, { params: [tid, part] }) {
  const t = TEST[tid];
  if (!t) { view.innerHTML = '<div class="empty">Test not found</div>'; return; }
  const P = PARTS[part];
  const st = S();
  const dk = draftKey(tid, part);
  const draft = st.drafts[dk] ||= { answers: {}, texts: ['', ''], elapsed: 0, startedAt: Date.now(), sec: 0 };
  save();

  // ---- timer
  let running = true;
  const limit = P.mins * 60;
  const tick = setInterval(() => {
    if (!running || document.visibilityState !== 'visible') return;
    draft.elapsed++;
    if (draft.elapsed % 5 === 0) save();
    const el = $('#timer');
    if (el) {
      const left = limit - draft.elapsed;
      el.textContent = left >= 0 ? fmtTime(left) : '+' + fmtTime(-left);
      el.classList.toggle('low', left < 300);
      if (left === 0) toast(part === 'listening' ? "Time's up — check your answers and submit." : "Time's up! Finish your sentence and submit.", 5000);
    }
  }, 1000);
  setGuard(() => null); // answers are saved continuously, leaving is safe
  const actions = `<span class="timer" id="timer" title="Time remaining">${fmtTime(limit - draft.elapsed)}</span>
    <button class="btn sm" id="pause" title="Pause the timer">Pause</button>
    <button class="btn sm ghost" id="discard" title="Throw away this attempt">Discard</button>
    <button class="btn sm primary" id="submit">${part === 'writing' || part === 'speaking' ? 'Finish' : 'Submit answers'}</button>`;
  setChrome({ wide: true, crumbs: crumbs('<a href="#/tests">Practice tests</a>', `<a href="#/test/${tid}">${esc(t.title)}</a>`, `${P.title} — timed`), actions });

  const top = $('#top-actions');
  top.onclick = async (e) => {
    if (e.target.id === 'pause') {
      running = !running;
      e.target.textContent = running ? 'Pause' : 'Resume';
      if (!running && current()) stop();
    }
    if (e.target.id === 'discard' && await confirmBox('Discard this attempt and clear your answers?', 'Discard')) {
      delete st.drafts[dk]; save(); stop(); location.hash = `#/test/${tid}`;
    }
    if (e.target.id === 'submit') finish();
  };

  document.body.classList.add('focus'); // more room for pages + answer sheet; cleared on navigation
  let inner = () => {};
  if (part === 'listening' || part === 'reading') inner = qaExam(view, t, part, draft);
  if (part === 'writing') inner = writingExam(view, t, draft);
  if (part === 'speaking') inner = await speakingExam(view, t, draft);

  async function finish() {
    const st = S();
    if (part === 'listening' || part === 'reading') {
      const blanks = countBlanks(t, part, draft.answers);
      if (blanks && !(await confirmBox(`${blanks} question${blanks > 1 ? 's are' : ' is'} still blank. Submit anyway?`, 'Submit'))) return;
      const qs = activeQs(t, part);
      const rows = markPart(t.answers[part], draft.answers).filter((r) => qs.has(r.q));
      const raw = scoreOf(rows), max = qs.size;
      const a = { id: uid(), test: tid, part, kind: t.kind, answers: { ...draft.answers }, overrides: {}, raw, max,
        band: band(part, Math.round((raw * 40) / max), t.kind), elapsed: draft.elapsed, finishedAt: Date.now() };
      st.attempts.push(a);
      delete st.drafts[dk]; save(`Result: Official Guide ${tid} ${part} — ${raw}/${max}, band ${a.band}`); stop();
      location.hash = `#/attempt/${a.id}`;
    } else if (part === 'writing') {
      const words = draft.texts.map(wordCount);
      if (!words[0] && !words[1]) { toast('Write something first'); return; }
      const a = { id: uid(), test: tid, part, kind: t.kind, texts: [...draft.texts], words, crit: [[], []], band: null, elapsed: draft.elapsed, finishedAt: Date.now() };
      st.attempts.push(a); delete st.drafts[dk]; save(`Result: Official Guide ${tid} writing — ${words.join(' + ')} words`);
      location.hash = `#/attempt/${a.id}`;
    } else {
      const recs = (await allRecs()).filter((r) => r.draft === dk);
      if (!recs.length && !(await confirmBox('No recordings yet. Finish anyway?', 'Finish'))) return;
      const a = { id: uid(), test: tid, part, kind: t.kind, recs: recs.map((r) => r.id), crit: [], band: null, elapsed: draft.elapsed, finishedAt: Date.now() };
      for (const r of recs) { r.attempt = a.id; delete r.draft; await putRec(r); }
      st.attempts.push(a); delete st.drafts[dk]; save(`Result: Official Guide ${tid} speaking — ${recs.length} recording${recs.length === 1 ? '' : 's'}`);
      location.hash = `#/attempt/${a.id}`;
    }
  }

  return () => { clearInterval(tick); save(); inner?.(); clearGuard(); stop(); };
}

function activeQs(t, part) {
  const s = new Set();
  const secs = part === 'listening' ? t.listening : t.reading;
  for (const x of secs) if (!x.missing) for (let q = x.qs[0]; q <= x.qs[1]; q++) s.add(q);
  return s;
}
function countBlanks(t, part, ans) {
  let n = 0; for (const q of activeQs(t, part)) if (!(ans[q] || '').trim()) n++;
  return n;
}

// ---------------------------------------------------------------- listening / reading
function qaExam(view, t, part, draft) {
  const secs = part === 'listening' ? t.listening : t.reading;
  const unit = part === 'listening' ? 'Section' : 'Passage';
  const strictPref = () => settings().strictAudio;
  view.innerHTML = `
    <div class="exam">
      <div class="reader-main" id="rm">
        <div class="reader-bar">
          <div class="tabs" id="tabs">${secs.map((s, i) => `<button data-sec="${i}">${unit} ${s.n}</button>`).join('')}</div>
          <span class="grow"></span>
          ${part === 'listening' ? `
            <button class="btn sm primary" id="playsec">${icon('play')} Play section</button>
            <label class="row" style="gap:6px;font-size:13px" title="Exam audio plays each section once without pausing, then moves on automatically — like the real test"><input type="checkbox" id="strict" ${strictPref() ? 'checked' : ''}> Real-exam audio</label>` : ''}
          <button class="btn sm ghost" data-z="-">−</button><button class="btn sm ghost" data-z="+">+</button>
        </div>
        <div id="pg"></div>
      </div>
      <aside class="sheet" id="sheet">
        <div class="row between"><b>Answer sheet</b><small id="filled"></small></div>
        ${secs.map((s, i) => s.missing ? `<h3>${unit} ${s.n}</h3><p class="notice">Missing from the scan — skipped.</p>` : `
          <h3 data-h="${i}">${unit} ${s.n} <small style="text-transform:none;letter-spacing:0">· Q${s.qs[0]}–${s.qs[1]}</small></h3>
          ${Array.from({ length: s.qs[1] - s.qs[0] + 1 }, (_, k) => s.qs[0] + k).map((q) => `
            <div class="qrow"><b>${q}</b><input type="text" data-q="${q}" data-sec="${i}" value="${esc(draft.answers[q] || '')}" autocomplete="off" spellcheck="false"></div>`).join('')}`).join('')}
        <p class="muted" style="font-size:12px;margin-top:16px">Write answers exactly as you would on the answer sheet. Letters (A, B, C), TRUE/FALSE/NOT GIVEN and short words are marked automatically; answers that are probably right but worded differently are flagged for you to confirm.</p>
      </aside>
    </div>`;
  const rm = $('#rm', view), pg = $('#pg', view), sheet = $('#sheet', view);
  let off = () => {};
  const showSec = (i, scroll = true) => {
    const s = secs[i];
    draft.sec = i; save();
    $$('#tabs button', view).forEach((b) => b.classList.toggle('on', Number(b.dataset.sec) === i));
    off();
    pg.innerHTML = s.missing ? `<div class="pages"><div class="notice gap-note">This passage is missing from the scanned book.</div></div>` : pagesHTML(pages(s.start, s.end), { hot: false });
    off = mountPages(pg);
    rm.scrollTop = 0;
    if (scroll) sheet.querySelector(`[data-h="${i}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const updateFilled = () => {
    const tot = activeQs(t, part).size;
    const n = Object.entries(draft.answers).filter(([q, v]) => v.trim() && activeQs(t, part).has(Number(q))).length;
    $('#filled', view).textContent = `${n}/${tot} answered`;
  };
  showSec(draft.sec || 0, false);
  updateFilled();

  const saveSoon = debounce(save, 300);
  sheet.addEventListener('input', (e) => {
    const q = e.target.dataset.q; if (!q) return;
    draft.answers[q] = e.target.value; updateFilled(); saveSoon();
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.q) {
      e.preventDefault();
      const next = sheet.querySelector(`[data-q="${Number(e.target.dataset.q) + 1}"]`);
      next?.focus();
    }
  });
  sheet.addEventListener('focusin', (e) => {
    const i = e.target.dataset.sec;
    if (i != null && Number(i) !== draft.sec && part === 'reading') showSec(Number(i), false);
  });
  view.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-sec]');
    if (tab && tab.tagName === 'BUTTON') showSec(Number(tab.dataset.sec));
    const z = e.target.closest('[data-z]');
    if (z) {
      const v = Math.max(520, Math.min(1500, (settings().zoom || 860) + (z.dataset.z === '+' ? 120 : -120)));
      setSetting('zoom', v);
    }
    if (e.target.id === 'playsec') playSection(draft.sec);
  });
  view.addEventListener('change', (e) => { if (e.target.id === 'strict') setSetting('strictAudio', e.target.checked); });

  function playSection(i) {
    const s = secs[i];
    const strict = strictPref();
    play(s.track, {
      restart: true, strict,
      onEnded: strict ? () => {
        if (i + 1 < secs.length) {
          toast(`Section ${s.n} finished — Section ${s.n + 1} starts now`, 3500);
          showSec(i + 1);
          setTimeout(() => playSection(i + 1), 1500);
        } else toast('End of the Listening test. Check your answers, then submit.', 6000);
      } : null,
    });
    if (strict) showSec(i);
  }
  const offP = onPlayer((ps) => {
    const b = $('#playsec', view);
    if (!b) return;
    const playingThis = ps.n === secs[draft.sec]?.track && ps.playing;
    b.innerHTML = playingThis ? (ps.strict ? `${icon('circle')} Playing…` : `${icon('pause')} Pause`) : `${icon('play')} Play section`;
    b.disabled = playingThis && ps.strict;
  });
  return () => { off(); offP(); };
}

// ---------------------------------------------------------------- writing
function writingExam(view, t, draft) {
  const w = t.writing;
  view.innerHTML = `
    <div class="exam">
      <div class="reader-main" id="rm">${pagesHTML(pages(w.start, w.end), { hot: false })}</div>
      <div class="writing-pane">
        <div class="wbar"><div class="tabs" id="wt"><button data-t="0" class="on">Task 1</button><button data-t="1">Task 2</button></div>
          <span class="grow"></span><span id="wc" class="pill"></span></div>
        <textarea id="wtext" spellcheck="false" placeholder=""></textarea>
        <div class="wbar"><small id="whint"></small></div>
      </div>
    </div>`;
  let cur = 0;
  const ta = $('#wtext', view);
  const min = [150, 250];
  const hints = [
    t.kind === 'gt' ? 'Task 1 · spend about 20 minutes · at least 150 words. Write the letter and cover all three bullet points.'
      : 'Task 1 · spend about 20 minutes · at least 150 words. Summarise the main features and make comparisons.',
    'Task 2 · spend about 40 minutes · at least 250 words. Task 2 counts twice as much as Task 1.',
  ];
  const upd = () => {
    const n = wordCount(ta.value);
    const wc = $('#wc', view);
    wc.textContent = `${n} words`;
    wc.className = 'pill ' + (n >= min[cur] ? 'ok' : n > min[cur] * 0.7 ? 'warn' : '');
  };
  const show = (i) => {
    cur = i; ta.value = draft.texts[i] || '';
    ta.placeholder = i === 0 ? 'Write your Task 1 answer here…' : 'Write your Task 2 essay here…';
    $$('#wt button', view).forEach((b) => b.classList.toggle('on', Number(b.dataset.t) === i));
    $('#whint', view).textContent = hints[i];
    upd(); ta.focus();
  };
  $('#wt', view).addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) show(Number(b.dataset.t)); });
  ta.addEventListener('input', () => { draft.texts[cur] = ta.value; upd(); });
  ta.addEventListener('input', debounce(save, 500));
  const off = mountPages($('#rm', view));
  show(0);
  return off;
}

// ---------------------------------------------------------------- speaking
async function speakingExam(view, t, draft) {
  const sp = t.speaking;
  const dk = draftKey(t.id, 'speaking');
  view.innerHTML = `
    <div class="exam">
      <div class="reader-main" id="rm">${pagesHTML(pages(sp.start, sp.end), { hot: false })}</div>
      <aside class="sheet" style="width:420px">
        <b>Speaking recorder</b>
        <p class="muted" style="font-size:13px">Answer the examiner's questions on the page aloud. Recordings stay on this computer.</p>
        <div class="card flat" style="margin-bottom:10px"><div class="row between"><b>Part 1 · Introduction</b><small>4–5 min</small></div>
          <p style="font-size:13px;margin:6px 0 10px">Answer each question in 2–3 sentences.</p><button class="btn sm" data-rec="1">${icon('mic')} Record</button></div>
        <div class="card flat" style="margin-bottom:10px"><div class="row between"><b>Part 2 · Long turn</b><small>1 min prep + 2 min talk</small></div>
          <p style="font-size:13px;margin:6px 0 10px">Press start: you get 1 minute to make notes, then recording starts automatically and stops after 2 minutes.</p>
          <div id="p2"><button class="btn sm primary" data-p2>Start Part 2</button></div>
          <textarea id="p2notes" rows="4" placeholder="Notes for your talk…" style="margin-top:8px">${esc(draft.p2notes || '')}</textarea></div>
        <div class="card flat" style="margin-bottom:10px"><div class="row between"><b>Part 3 · Discussion</b><small>4–5 min</small></div>
          <p style="font-size:13px;margin:6px 0 10px">Give longer, reasoned answers with examples.</p><button class="btn sm" data-rec="3">${icon('mic')} Record</button></div>
        <div id="status" style="margin:8px 0"></div>
        <h3>Your recordings</h3><div id="recs"></div>
      </aside>
    </div>`;
  const offPages = mountPages($('#rm', view));
  let rec = null, chunks = [], recPart = null, recStart = 0, timerI = null, stream = null;

  async function drawRecs() {
    const list = (await allRecs()).filter((r) => r.draft === dk).sort((a, b) => a.ts - b.ts);
    $('#recs', view).innerHTML = list.length ? list.map((r) => `<div class="row" style="margin-bottom:8px"><small style="width:52px">Part ${r.sp}</small>
      <audio controls src="${URL.createObjectURL(r.blob)}" style="height:32px;flex:1"></audio><button class="icon-btn" data-del="${r.id}" title="Delete" aria-label="Delete recording">${icon('trash-2')}</button></div>`).join('')
      : '<p class="muted" style="font-size:13px">None yet.</p>';
  }
  async function startRec(part, maxSec) {
    if (rec) return;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('Microphone permission is needed to record'); return; }
    rec = new MediaRecorder(stream); chunks = []; recPart = part; recStart = Date.now();
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      await putRec({ id: uid(), draft: dk, test: t.id, sp: recPart, blob, dur: (Date.now() - recStart) / 1000, ts: Date.now() });
      rec = null; clearInterval(timerI); $('#status', view).innerHTML = ''; setRecButtons(); drawRecs();
    };
    rec.start();
    setRecButtons();
    timerI = setInterval(() => {
      const s = (Date.now() - recStart) / 1000;
      $('#status', view).innerHTML = `<span class="rec-dot"></span> Recording Part ${part} · ${fmtTime(s)}${maxSec ? ` / ${fmtTime(maxSec)}` : ''} <button class="btn sm" data-stop>Stop</button>`;
      if (maxSec && s >= maxSec) rec?.stop();
    }, 250);
  }
  function setRecButtons() {
    $$('[data-rec]', view).forEach((b) => { b.disabled = !!rec; });
  }
  view.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-rec]');
    if (r) startRec(Number(r.dataset.rec));
    if (e.target.closest('[data-stop]')) rec?.stop();
    const d = e.target.closest('[data-del]');
    if (d) { await delRec(d.dataset.del); drawRecs(); }
    if (e.target.closest('[data-p2]')) {
      if (rec) return;
      let left = 60;
      const box = $('#p2', view);
      box.innerHTML = `<b>Preparation: <span id="prep">1:00</span></b> <button class="btn sm" data-skipprep>Start talking now</button>`;
      $('#p2notes', view).focus();
      const iv = setInterval(() => {
        left--; const el = $('#prep', view); if (el) el.textContent = fmtTime(left);
        if (left <= 0) go();
      }, 1000);
      const go = () => { clearInterval(iv); box.innerHTML = '<button class="btn sm primary" data-p2>Start Part 2 again</button>'; startRec(2, 120); };
      box.onclick = (ev) => { if (ev.target.closest('[data-skipprep]')) go(); };
    }
  });
  $('#p2notes', view).addEventListener('input', debounce((e) => { draft.p2notes = e.target.value; save(); }, 400));
  drawRecs();
  return () => { offPages(); clearInterval(timerI); if (rec && rec.state === 'recording') rec.stop(); };
}

// ================================================================ attempt review
export async function renderAttempt(view, { params: [id] }) {
  const st = S();
  const a = st.attempts.find((x) => x.id === id);
  if (!a) { view.innerHTML = '<div class="empty">Attempt not found</div>'; return; }
  const t = TEST[a.test], P = PARTS[a.part];
  setChrome({ crumbs: crumbs('<a href="#/tests">Practice tests</a>', `<a href="#/test/${t.id}">${esc(t.title)}</a>`, `${P.title} result`),
    actions: `<a class="btn sm" href="#/exam/${t.id}/${a.part}">Retake</a><button class="btn sm ghost" id="del-attempt">Delete</button>` });
  $('#top-actions').onclick = async (e) => {
    if (e.target.id === 'del-attempt' && await confirmBox('Delete this attempt?', 'Delete')) {
      st.attempts.splice(st.attempts.indexOf(a), 1);
      if (a.recs) for (const r of a.recs) await delRec(r);
      save(); location.hash = `#/test/${t.id}`;
    }
  };
  if (a.part === 'listening' || a.part === 'reading') return qaReview(view, a, t);
  return selfReview(view, a, t);
}

function qaReview(view, a, t) {
  const secs = a.part === 'listening' ? t.listening : t.reading;
  const qs = activeQs(t, a.part);
  const rows = markPart(t.answers[a.part], a.answers).filter((r) => qs.has(r.q));
  let onlyWrong = false;
  const draw = () => {
    const raw = scoreOf(rows, a.overrides);
    a.raw = raw; a.band = band(a.part, Math.round((raw * 40) / a.max), t.kind); save();
    const checks = rows.filter((r) => r.mark === 'check' && !(r.q in a.overrides)).length;
    view.innerHTML = `
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card" style="border-top:4px solid ${MOD[a.part].color}">
          <small>${esc(t.title)} · ${P_TITLE(a.part)} · ${fmtDateTime(a.finishedAt)}</small>
          <div class="row" style="margin-top:8px;gap:24px">
            <div><small>Band</small><div class="band">${bandFmt(a.band)}</div></div>
            <div><small>Score</small><div class="stat">${raw}<small>/${a.max}</small></div></div>
            <div><small>Time</small><div class="stat" style="font-size:22px">${fmtTime(a.elapsed)}</div></div>
          </div>
          ${a.max < 40 ? `<p class="muted" style="font-size:13px;margin-bottom:0">Band estimated by scaling ${a.max} questions to 40.</p>` : ''}
        </div>
        <div class="card">
          <h3>By ${a.part === 'listening' ? 'section' : 'passage'}</h3>
          ${secs.filter((s) => !s.missing).map((s) => {
            const r = rows.filter((x) => x.q >= s.qs[0] && x.q <= s.qs[1]);
            const ok = scoreOf(r, a.overrides);
            return `<div class="row" style="margin-bottom:8px"><span style="width:90px">${a.part === 'listening' ? 'Section' : 'Passage'} ${s.n}</span>
              <div class="bar grow" style="--c:${MOD[a.part].color}"><span style="width:${(ok / r.length) * 100}%"></span></div><small style="width:44px;text-align:right">${ok}/${r.length}</small>
              ${s.key ? `<a class="btn sm" href="#/page/${s.key.page}?y=${s.key.y}" title="Answer key page">Key</a>` : ''}
              ${s.script ? `<a class="btn sm" href="#/page/${s.script.page}?y=${s.script.y}" title="Recording script">Script</a>` : ''}
              ${s.track ? `<button class="btn sm" data-play="${s.track}" title="Play this section again" aria-label="Play this section again">${icon('play')}</button>` : ''}</div>`;
          }).join('')}
        </div>
      </div>
      ${checks ? `<p class="notice" style="margin-bottom:12px">${checks} answer${checks > 1 ? 's are' : ' is'} marked <b style="color:var(--warn)">?</b> — probably correct but worded differently from the key. They count as correct; click to confirm or mark wrong.</p>` : ''}
      <div class="card">
        <div class="row between"><h2 style="margin:0">Answers</h2><label class="row" style="gap:6px;font-size:14px"><input type="checkbox" id="ow" ${onlyWrong ? 'checked' : ''}> Only show mistakes</label></div>
        <table class="t" style="margin-top:10px"><thead><tr><th style="width:40px">Q</th><th>Your answer</th><th>Answer key</th><th style="width:70px">Mark</th></tr></thead><tbody>
        ${rows.filter((r) => !onlyWrong || !isRight(r, a.overrides)).map((r) => {
          const ov = r.q in a.overrides;
          const right = isRight(r, a.overrides);
          const cls = ov ? (right ? 'ok' : 'bad') : r.mark === 'check' ? 'check' : right ? 'ok' : 'bad';
          return `<tr class="${!right ? 'wrong' : cls === 'check' ? 'check' : ''}"><td><b>${r.q}</b></td><td>${r.user ? esc(r.user) : '<span class="muted">—</span>'}</td><td>${esc(r.key)}</td>
            <td><button class="mark-btn ${cls}" data-q="${r.q}" title="Click to change">${cls === 'check' ? '?' : icon(right ? 'check' : 'x')}</button></td></tr>`;
        }).join('')}
        </tbody></table>
        <p class="muted" style="font-size:12px">Mistakes appear in your <a href="#/mistakes">Mistake log</a>. Bands use the standard IELTS conversion table; the real test adjusts it slightly per paper.</p>
      </div>`;
  };
  view.addEventListener('click', (e) => {
    const b = e.target.closest('.mark-btn');
    if (b) {
      const q = Number(b.dataset.q), r = rows.find((x) => x.q === q);
      a.overrides[q] = !isRight(r, a.overrides);
      save(); draw();
    }
    const p = e.target.closest('[data-play]');
    if (p) play(Number(p.dataset.play));
  });
  view.addEventListener('change', (e) => { if (e.target.id === 'ow') { onlyWrong = e.target.checked; draw(); } });
  draw();
}
const P_TITLE = (p) => PARTS[p].title;

async function selfReview(view, a, t) {
  const isW = a.part === 'writing';
  const crit = CRITERIA[a.part];
  const recs = isW ? [] : (await allRecs()).filter((r) => (a.recs || []).includes(r.id)).sort((x, y) => x.ts - y.ts);
  const opts = (v) => `<option value="">–</option>` + [9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3].map((b) => `<option ${Number(v) === b ? 'selected' : ''}>${b}</option>`).join('');
  const compute = () => {
    if (isW) {
      const b1 = criteriaBand(a.crit[0] || []), b2 = criteriaBand(a.crit[1] || []);
      // Task 2 is worth twice as much as Task 1
      a.band = b1 != null && b2 != null ? Math.round(((b1 + 2 * b2) / 3) * 2) / 2 : null;
    } else a.band = criteriaBand(a.crit || []);
    save();
    const el = $('#sb', view); if (el) el.textContent = bandFmt(a.band);
  };
  const critForm = (vals, task) => `<div class="grid g2" style="gap:8px">${crit.map((c, i) => `
    <label class="field" style="margin:0"><span>${c}</span><select data-task="${task}" data-c="${i}">${opts(vals?.[i])}</select></label>`).join('')}</div>`;
  view.innerHTML = `
    <div class="card" style="border-top:4px solid ${MOD[a.part].color};margin-bottom:16px">
      <div class="row between"><div><small>${esc(t.title)} · ${P_TITLE(a.part)} · ${fmtDateTime(a.finishedAt)} · ${fmtTime(a.elapsed)}</small>
        <h2 style="margin:4px 0 0">Self-assessment</h2></div>
        <div style="text-align:right"><small>Your band</small><div class="band" id="sb">${bandFmt(a.band)}</div></div></div>
      <p class="muted" style="margin-bottom:0">Compare your work with the ${isW ? 'model answers in the answer key' : 'Speaking skills units (esp. Unit 4.3, “Assessing yourself”)'}, then rate each criterion honestly. ${isW ? 'Task 2 counts double.' : ''}</p>
      ${isW && t.writing.key ? `<a class="btn sm" style="margin-top:10px" href="#/page/${t.writing.key.page}?y=${t.writing.key.y}">Open model answers</a>` : ''}
      ${!isW ? `<a class="btn sm" style="margin-top:10px" href="#/s/speaking-4-3">Open “Assessing yourself”</a>` : ''}
    </div>
    ${isW ? [0, 1].map((i) => `
      <div class="card" style="margin-bottom:16px">
        <div class="row between"><h3 style="margin:0">Task ${i + 1}</h3><span class="pill ${a.words[i] >= [150, 250][i] ? 'ok' : 'warn'}">${a.words[i]} words</span></div>
        <div style="white-space:pre-wrap;font:16px/1.7 Georgia,serif;margin:12px 0;padding:14px;background:var(--surface-2);border-radius:8px">${esc(a.texts[i]) || '<span class="muted">(empty)</span>'}</div>
        ${a.words[i] < [150, 250][i] ? `<p class="notice" style="margin-bottom:12px">Under ${[150, 250][i]} words — examiners lower Task ${i ? 'Response' : 'Achievement'} for short answers.</p>` : ''}
        ${critForm(a.crit[i], i)}
      </div>`).join('') : `
      <div class="card" style="margin-bottom:16px"><h3>Recordings</h3>
        ${recs.length ? recs.map((r) => `<div class="row" style="margin-bottom:8px"><small style="width:52px">Part ${r.sp}</small><audio controls src="${URL.createObjectURL(r.blob)}" style="flex:1"></audio><small>${fmtTime(r.dur)}</small></div>`).join('') : '<p class="muted">No recordings.</p>'}
        <hr>${critForm(a.crit, 0)}
      </div>`}`;
  view.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-c]'); if (!s) return;
    const v = s.value === '' ? null : Number(s.value);
    if (isW) { (a.crit[s.dataset.task] ||= [])[s.dataset.c] = v; } else { a.crit[s.dataset.c] = v; }
    compute();
  });
}
