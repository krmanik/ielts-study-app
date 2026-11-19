// Speaking test simulator: the browser's voice reads the examiner's questions, your answers are recorded.
import { $, esc, fmtClock, toast, confirmBox, SKILL, uid } from './util.js';
import { save, saveResult, settings, setSetting, addActivity } from './store.js';
import { loadTest, testName, testInfo } from './data.js';
import { startRecording, putRec, say } from './rec.js';
import { fsButton, autoFs } from './fullscreen.js';
import { icon } from './icons.js';

const OPENING = [
  'Good morning. My name is Sarah and I will be your examiner. Can you tell me your full name, please?',
  'And where are you from?',
];
const P2_INTRO = "Now, I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish.";
const P3_INTRO = "We've been talking about a topic from Part 2. I'd like to discuss with you one or two more general questions related to this.";

export async function renderSpeaking(app, att, { review }) {
  if (att.finished) { location.hash = `#/r/${att.id}`; return; }
  const T = await loadTest(att.test);
  const info = testInfo(att.test);
  const parts = (T.S.parts || []).filter((p) => att.parts.includes(p.n));
  document.body.classList.add('exam-mode');
  let rec = null, recStart = 0, timer = null, stepIdx = 0, phase = 'intro', prepLeft = 60, speakLeft = 120;
  let showText = att.mode === 'practice';
  let voice = settings().examinerVoice !== false;

  // flatten into steps
  const steps = [];
  parts.forEach((p) => {
    if (p.n === 1) {
      steps.push({ part: 1, kind: 'q', text: OPENING[0] }, { part: 1, kind: 'q', text: OPENING[1] });
      steps.push({ part: 1, kind: 'say', text: "Now, in this first part, I'd like to ask you some questions about yourself." });
      let topic = '';
      p.items.forEach((it) => {
        if (it.topic) topic = it.topic;
        if (it.q) steps.push({ part: 1, kind: 'q', text: it.q.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim(), topic });
      });
    }
    if (p.n === 2) steps.push({ part: 2, kind: 'cue', cue: p.items });
    if (p.n === 3) {
      steps.push({ part: 3, kind: 'say', text: P3_INTRO });
      let topic = '';
      p.items.forEach((it) => {
        if (it.topic) topic = it.topic;
        if (it.q) steps.push({ part: 3, kind: 'q', text: it.q.trim(), topic });
      });
    }
  });

  app.innerHTML = `<div class="exam" data-contrast="${esc(settings().contrast || '')}" style="--exam-size:${settings().textSize || 16}px">
    <header class="x-head"><span class="mark">IELTS</span><span class="who">${esc(testName(info))} · Speaking</span>
      <div class="x-timer" id="x-timer"></div>
      <div class="x-tools">${fsButton()}<button class="tbtn" data-act="exit">${icon('x')} <span class="lbl">Exit</span></button></div></header>
    <div class="x-banner" id="x-banner"></div>
    <div class="x-main"><div class="x-pane"><div class="spanel" id="sp"></div></div></div>
    <footer class="x-foot" id="x-foot"></footer></div>`;
  const root = $('.exam', app), sp = $('#sp', root);
  autoFs(root);

  draw();

  function draw() {
    const s = steps[stepIdx];
    const partN = phase === 'intro' ? null : s?.part;
    $('#x-banner', root).innerHTML = phase === 'intro' ? '<b>Speaking</b><span class="sub">11–14 minutes · three parts</span>'
      : `<b>Part ${partN}</b><span class="sub">${{ 1: 'Introduction and interview (4–5 minutes)', 2: 'Individual long turn (3–4 minutes)', 3: 'Two-way discussion (4–5 minutes)' }[partN]}</span>`;
    $('#x-foot', root).innerHTML = `<div class="x-parts">${parts.map((p) => `<div class="x-part${p.n === partN ? ' active' : ''}"><span class="pl">Part ${p.n}</span></div>`).join('')}</div>
      <div class="x-nav">${phase !== 'intro' ? `<button class="submit" data-act="finish">Finish</button>` : ''}</div>`;
    if (phase === 'intro') {
      sp.innerHTML = `<h1>IELTS Speaking</h1>
        <p>A recorded examiner voice asks the questions from <b>${esc(testName(info))}</b>. Answer out loud — your answers are recorded so you can listen back and score yourself.</p>
        <ul><li>Part 1: short questions about familiar topics. Answer in 2–3 sentences.</li>
        <li>Part 2: you get a task card, <b>1 minute</b> to prepare, then speak for up to <b>2 minutes</b>.</li>
        <li>Part 3: a discussion with longer, more abstract questions.</li></ul>
        <div class="stack">
          <label class="row"><input type="checkbox" id="voice" ${voice ? 'checked' : ''}> The examiner reads the questions aloud</label>
          <label class="row"><input type="checkbox" id="showtext" ${showText ? 'checked' : ''}> Show the question text (turn off for exam conditions)</label>
        </div>
        <p class="muted">Your browser will ask for permission to use the microphone. Recordings stay on this computer.</p>
        <div class="row" style="margin-top:18px"><button class="btn primary big" id="go">Start speaking test</button></div>`;
      $('#voice', sp).onchange = (e) => { voice = e.target.checked; setSetting('examinerVoice', voice); };
      $('#showtext', sp).onchange = (e) => (showText = e.target.checked);
      $('#go', sp).onclick = begin;
      return;
    }
    if (!s) return;
    if (s.kind === 'cue') return drawCue(s);
    const total = steps.filter((x) => x.part === s.part && x.kind === 'q').length;
    const idx = steps.slice(0, stepIdx + 1).filter((x) => x.part === s.part && x.kind === 'q').length;
    sp.innerHTML = `
      ${s.topic ? `<p class="muted" style="margin:0 0 6px">Topic: <b>${esc(s.topic)}</b></p>` : ''}
      <div class="examiner"><div class="avatar">EX</div><div>
        <div class="say">${showText || s.kind === 'say' ? esc(s.text) : '<span class="muted">Listen to the examiner…</span>'}</div>
        <div class="row" style="margin-top:10px"><button class="btn small" data-act="repeat">${icon('repeat')} Repeat question</button>
        ${!showText && s.kind === 'q' ? `<button class="btn small ghost" data-act="reveal">Show text</button>` : ''}</div></div></div>
      ${recBlock()}
      <div class="row" style="margin-top:18px">
        <button class="btn primary big" data-act="next">${nextLabel()}</button>
        ${s.kind === 'q' ? `<span class="muted">Question ${idx} of ${total} in Part ${s.part}</span>` : ''}
      </div>`;
    if (voice && !s.spoken) { s.spoken = true; say(s.text); }
  }

  function drawCue(s) {
    sp.innerHTML = `<div class="examiner"><div class="avatar">EX</div><div class="say" style="font-weight:400">${esc(P2_INTRO)}</div></div>
      <div class="cue">${s.cue.map((c) => `<div class="${c.b ? 'cue-b' : ''}">${esc(c.t || c.q || c.topic || '')}</div>`).join('')}</div>
      ${phase === 'prep' ? `<div class="row"><span class="big-clock" id="clock">${fmtClock(prepLeft)}</span><span class="muted">preparation time</span></div>
        <textarea id="notes" rows="5" style="width:100%;margin-top:10px" placeholder="Notes (optional)">${esc(att.notes2 || '')}</textarea>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-act="speak">Start speaking now</button></div>`
      : `${recBlock()}<div class="row"><span class="big-clock" id="clock">${fmtClock(speakLeft)}</span><span class="muted">speaking time left — the examiner will stop you at 2 minutes</span></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" data-act="next">I've finished</button></div>`}`;
    $('#notes', sp)?.addEventListener('input', (e) => { att.notes2 = e.target.value; save(); });
    if (phase === 'prep' && voice && !s.spoken) { s.spoken = true; say(P2_INTRO); }
  }

  const recBlock = () => `<div class="row rec-row"><span class="rec-dot ${rec ? 'on' : ''}"></span><span>${rec ? `Recording · <b id="rect">${fmtClock((Date.now() - recStart) / 1000)}</b>` : 'Not recording'}</span></div>`;
  const nextLabel = () => {
    const s = steps[stepIdx], n = steps[stepIdx + 1];
    if (!n) return 'Finish test';
    if (n.part !== s.part) return `Go to Part ${n.part} ${icon('arrow-right')}`;
    return `Next question ${icon('arrow-right')}`;
  };

  async function begin() {
    try {
      phase = 'run';
      att.started = att.started || Date.now(); att.phase = 'run'; save(true);
      await startPartRecording();
      draw();
      timer = setInterval(tick, 1000);
    } catch (e) {
      phase = 'intro';
      toast('Microphone not available: ' + e.message, 5000);
    }
  }

  async function startPartRecording() {
    rec = await startRecording();
    recStart = Date.now();
  }
  async function stopPartRecording(part) {
    if (!rec) return;
    const blob = await rec.stop();
    const dur = (Date.now() - recStart) / 1000;
    rec = null;
    const id = uid();
    await putRec({ id, attempt: att.id, part, blob, dur, ts: Date.now() });
    att.recs.push({ id, part, dur });
    save(true);
  }

  let ticks = 0;
  function tick() {
    if (++ticks % 15 === 0) addActivity(15);
    att.elapsed = (att.elapsed || 0) + 1;
    const r = $('#rect', sp); if (r) r.textContent = fmtClock((Date.now() - recStart) / 1000);
    $('#x-timer', root).innerHTML = `${icon('timer')} ${fmtClock(att.elapsed)}`;
    const s = steps[stepIdx];
    if (s?.kind === 'cue') {
      if (phase === 'prep') { prepLeft--; $('#clock', sp).textContent = fmtClock(prepLeft); if (prepLeft <= 0) startLongTurn(); }
      else if (phase === 'speak') {
        speakLeft--; const c = $('#clock', sp); if (c) c.textContent = fmtClock(speakLeft);
        if (speakLeft <= 0) { if (voice) say('Thank you.'); next(); }
      }
    }
  }

  async function startLongTurn() {
    phase = 'speak';
    if (voice) await say("All right? Remember you have one to two minutes for this. Don't worry if I stop you. I'll tell you when the time is up. Can you start speaking now, please?");
    await startPartRecording();
    draw();
  }

  async function next() {
    const s = steps[stepIdx], n = steps[stepIdx + 1];
    speechSynthesis?.cancel?.();
    if (!n) return finish();
    if (n.part !== s.part) {
      await stopPartRecording(s.part);
      stepIdx++;
      if (n.kind === 'cue') { phase = 'prep'; prepLeft = 60; speakLeft = 120; draw(); return; }
      phase = 'run';
      await startPartRecording();
      draw();
      return;
    }
    stepIdx++;
    draw();
  }

  async function finish() {
    if (phase !== 'intro' && !(await confirmBox('Finish the speaking test?', 'Finish', 'Continue'))) return;
    clearInterval(timer);
    speechSynthesis?.cancel?.();
    await stopPartRecording(steps[stepIdx]?.part || 1);
    att.finished = Date.now(); att.phase = 'done';
    att.result = { recs: att.recs.length };
    saveResult(att);
    location.hash = `#/r/${att.id}`;
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    const s = steps[stepIdx];
    if (a === 'next') next();
    if (a === 'repeat' && s?.text) say(s.text);
    if (a === 'reveal') { showText = true; draw(); }
    if (a === 'speak') startLongTurn();
    if (a === 'finish') finish();
    if (a === 'exit') {
      if (phase !== 'intro' && !(await confirmBox('Leave the speaking test? Recordings made so far are kept, but this attempt will restart.', 'Leave', 'Stay'))) return;
      cleanup();
      location.hash = `#/t/${att.test}`;
    }
  });

  function cleanup() {
    clearInterval(timer);
    speechSynthesis?.cancel?.();
    if (rec) rec.stop();
  }
  return cleanup;
}
