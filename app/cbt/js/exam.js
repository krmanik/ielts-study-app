// The test screen, modelled on computer-delivered IELTS: header with timer, part banner,
// split passage/question panes, question navigator in the footer.
import { $, $$, esc, fmtClock, wordCount, clamp, toast, modal, confirmBox, pageImg, SKILL, isTyping } from './util.js';
import { getAttempt, save, saveResult, settings, setSetting, addActivity, getMock } from './store.js';
import { loadTest, audioUrl, testName, testInfo } from './data.js';
import { partQuestionsHtml, bindQuestions, focusQuestion } from './qrender.js';
import { enableHighlighting, paint } from './hl.js';
import { markAnswers, band, typeOf } from './mark.js';
import { READING_MINUTES, readingLimit } from './actions.js';
import { fsButton, autoFs, enterFs, fsSupported } from './fullscreen.js';
import { mountBandGuide } from './bandguide.js';
import { passageHtml, scriptHtml } from './text.js';
import { icon } from './icons.js';

const CHECK_SECONDS = 120; // computer-delivered Listening: 2 minutes to check answers at the end

export async function renderExam(app, id, { review = false } = {}) {
  const att = getAttempt(id);
  if (!att) { app.innerHTML = `<div class="page"><div class="card"><h2>Test attempt not found</h2><a href="#/">Home</a></div></div>`; return; }
  if (att.finished && !review) { location.hash = `#/r/${id}`; return; }
  if (att.skill === 'S') { const m = await import('./speaking.js'); return m.renderSpeaking(app, att, { review }); }
  const T = await loadTest(att.test);
  const info = testInfo(att.test);
  const sk = att.skill;
  const st = settings();
  const parts = sk === 'W' ? T.W.tasks.filter((t) => att.parts.includes(t.n)) : T[sk].parts.filter((p) => att.parts.includes(p.n));
  const qsOf = (p) => { const a = []; for (let q = p.from; q <= p.to; q++) a.push(q); return a; };
  const allQs = sk === 'W' ? [] : parts.flatMap(qsOf);
  const groupsByFrom = {};
  if (sk !== 'W') parts.forEach((p) => p.groups.forEach((g) => (groupsByFrom[g.from] = g)));
  const key = sk === 'W' ? {} : T.key[sk];
  const marked = review && sk !== 'W' ? markAnswers(key, att.answers, allQs) : null;

  let view = clamp(att.view || 0, 0, parts.length - 1);
  let curQ = null;
  let timers = [];
  let audio = null;
  let hlOff = null;
  let unbindQ = null;
  let checkLeft = null;

  document.body.classList.add('exam-mode');
  app.innerHTML = `<div class="exam" data-contrast="${esc(st.contrast || '')}" style="--exam-size:${st.textSize || 16}px;--split:${st.split || 52}%">
    <header class="x-head">
      <span class="mark">IELTS</span>
      <span class="who">${esc(testName(info))} · ${SKILL[sk]}${att.mode === 'practice' ? ' · practice' : ''}${review ? ' · review' : ''}</span>
      <div class="x-timer" id="x-timer" title="Click to hide or show the time"></div>
      <div class="x-tools">
        ${review && sk !== 'W' ? `<button class="tbtn" data-act="bands" title="What each band means and the correct answers it takes">${icon('award')} <span class="lbl">Band scores</span></button>` : ''}
        <button class="tbtn" data-act="help" title="Help">? <span class="lbl">Help</span></button>
        <button class="tbtn" data-act="settings" title="Text size and colours">${icon('sliders-horizontal')} <span class="lbl">Settings</span></button>
        ${fsButton()}
        <button class="tbtn" data-act="exit" title="Leave the test">${icon('x')} <span class="lbl">${review ? 'Close' : 'Exit'}</span></button>
      </div>
    </header>
    <div class="x-banner" id="x-banner"></div>
    <div class="x-main" id="x-main"></div>
    <footer class="x-foot" id="x-foot"></footer>
  </div>`;
  const root = $('.exam', app);
  const main = $('#x-main', root);
  autoFs(root);

  // ---------------------------------------------------------------- persistence helpers
  const setAnswer = (q, v) => {
    if (v) att.answers[q] = v; else delete att.answers[q];
    save();
    updateNav();
  };
  const setCurrent = (q) => {
    curQ = q;
    $$('.q.current, .gapw.current', root).forEach((e) => e.classList.remove('current'));
    $(`#q-${q}`, root)?.classList.add('current');
    updateNav();
  };
  const toggleFlag = (q) => { if (att.flags[q]) delete att.flags[q]; else att.flags[q] = 1; save(); updateNav(); };

  // ---------------------------------------------------------------- phases
  if (review) renderRun();
  else if (att.phase === 'intro' || !att.started) renderIntro();
  else renderRun();

  function renderIntro() {
    $('#x-banner', root).innerHTML = `<b>${SKILL[sk]}</b><span class="sub">${esc(testName(info))}</span>`;
    $('#x-foot', root).innerHTML = '';
    const scope = sk === 'W' ? parts.map((p) => `Task ${p.n}`).join(' + ') : parts.length === T[sk].parts.length ? `all ${parts.length} parts, questions 1–40` : parts.map((p) => `Part ${p.n} (questions ${p.from}–${p.to})`).join(', ');
    const lim = att.limit ? fmtMinutes(att.limit) : null;
    const mins = READING_MINUTES.find((m) => readingLimit(m, parts.length) === att.limit);
    const lines = {
      L: [`You will hear ${parts.length === 4 ? 'four recordings' : 'the recording'}; answer the questions as you listen.`,
        att.mode === 'exam' ? 'Each recording plays <b>once only</b>. You cannot pause it.' : 'Practice mode: you can pause, rewind and replay.',
        att.mode === 'exam' ? `When the audio ends you have <b>2 minutes</b> to check your answers.` : 'Submit when you are ready.',
        'Spelling counts. Type answers in the boxes; click letters to choose options.'],
      R: [`${parts.length === 3 ? 'Three passages, 40 questions.' : 'One passage.'} Answer all the questions.`,
        lim ? (att.mode === 'exam' ? `You have <b>${lim}</b>. The test ends automatically when time is up.` : `Suggested time: <b>${lim}</b> (the clock keeps running if you go over).`) : '',
        'Select any text in the passage to <b>highlight</b> it or add a <b>note</b>.',
        'Use the numbers at the bottom of the screen to move between questions.'],
      W: [parts.length === 2 ? 'Two tasks. Task 2 is worth twice as much as Task 1.' : `Task ${parts[0].n} only.`,
        lim ? `${att.mode === 'exam' ? 'Time' : 'Suggested time'}: <b>${lim}</b>.` : '',
        'Spell-check is off, just like the real test. A word count is shown below your writing.',
        'Afterwards you can compare with the sample answers and score yourself.'],
    }[sk].filter(Boolean);
    main.innerHTML = `<div class="x-center"><div class="box">
      <h1 style="margin-bottom:4px">IELTS ${SKILL[sk]}</h1>
      <p class="muted" style="margin-top:0">${esc(testName(info))} — ${esc(scope)}</p>
      <h3>Instructions</h3>
      <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      ${sk === 'L' ? `<div class="row" style="margin:18px 0"><button class="btn" id="snd">${icon('play')} Play test sound</button><span class="muted">Check you can hear the audio clearly.</span></div>` : ''}
      ${sk === 'R' ? `<h3>Time limit</h3>
      <div class="seg" role="radiogroup" aria-label="Time limit">${READING_MINUTES.map((m) => `<label><input type="radio" name="rmin" value="${m}" ${m === mins ? 'checked' : ''}>
        <span><b>${fmtMinutes(readingLimit(m, parts.length))}</b><small>${m === 60 ? 'real exam' : m === 50 ? 'faster' : 'fastest'}</small></span></label>`).join('')}</div>
      <p class="muted" style="font-size:.88em;margin:6px 0 0">Less time trains you to read faster. The real test gives 60 minutes for three passages${parts.length < 3 ? ' — 20 minutes each' : ''}.</p>` : ''}
      ${fsSupported ? `<label class="row fs-opt" style="margin-top:18px"><input type="checkbox" id="fs-start" ${st.fullscreen ? 'checked' : ''}> <span>Full screen — hide the browser tabs and everything else <span class="muted">(Esc to leave)</span></span></label>` : ''}
      <div class="row" style="margin-top:22px"><button class="btn primary big" id="go">Start test</button>
      <button class="btn ghost" data-act="exit">Not now</button></div>
    </div></div>`;
    $('#fs-start', main)?.addEventListener('change', (e) => setSetting('fullscreen', e.target.checked));
    $('.seg', main)?.addEventListener('change', (e) => {
      att.limit = readingLimit(+e.target.value, parts.length);
      if (!att.mock) setSetting('readingMinutes', +e.target.value);   // remembered for the next Reading test
      save();
      renderIntro();
      $('.seg input:checked', main)?.focus();
    });
    $('#go', main).onclick = () => {
      if (settings().fullscreen) enterFs();
      att.started = att.started || Date.now();
      att.phase = 'run';
      save(true);
      renderRun(true);
    };
    $('#snd', main)?.addEventListener('click', (e) => {
      const p = parts[0];
      if (!p.audio) return toast('Audio file missing for this part');
      const a = new Audio(audioUrl(p.audio));
      a.currentTime = 0; a.play();
      e.target.disabled = true;
      setTimeout(() => { a.pause(); e.target.disabled = false; }, 5000);
    });
  }

  function renderRun(fresh = false) {
    if (sk === 'L') runListening(fresh);
    else if (sk === 'R') runReading();
    else runWriting();
    startClock();
  }

  // ---------------------------------------------------------------- LISTENING
  function runListening(fresh) {
    const p = parts[view];
    const strict = att.mode === 'exam' && !review;
    if (review) {
      main.innerHTML = `<div class="x-body" id="x-body">
        <div class="x-pane left" id="pane-l"><div class="script-pane" data-hz="s${p.n}">${scriptHtml(p)}</div></div>
        <div class="x-split" id="x-split"></div>
        <div class="x-pane" id="pane-q"><div class="qpanel">${partQuestionsHtml(p, T, ctx())}</div></div></div>`;
    } else {
      main.innerHTML = `<div class="x-body single" id="x-body"><div class="x-pane" id="pane-q"><div class="qpanel wide">${partQuestionsHtml(p, T, ctx())}</div></div></div>`;
    }
    $('#x-banner', root).innerHTML = `<b>Part ${p.n}</b><span class="sub">${checkLeft != null ? 'Check your answers.' : `Listen and answer questions ${p.from}–${p.to}.`}</span><div class="x-audio" id="x-audio"></div>`;
    afterPaneRender();
    if (!audio) setupAudio(strict, fresh);
    else drawAudio();
  }

  function setupAudio(strict, fresh) {
    audio = new Audio();
    audio.preload = 'auto';
    audio.volume = st.volume ?? 1;
    let partIdx = clamp(parts.findIndex((p) => p.n === att.audio.part), 0, parts.length - 1);
    const load = (i, t = 0) => {
      partIdx = i;
      const p = parts[i];
      if (!p.audio) { toast(`Audio missing for Part ${p.n}`); return; }
      audio.src = audioUrl(p.audio);
      audio.currentTime = 0;
      const seek = () => { if (t) audio.currentTime = t; };
      audio.addEventListener('loadedmetadata', seek, { once: true });
      att.audio.part = p.n; save();
    };
    audio.addEventListener('timeupdate', () => {
      att.audio.time = audio.currentTime;
      if (Math.floor(audio.currentTime) % 3 === 0) save();
      drawAudio();
    });
    audio.addEventListener('play', drawAudio);
    audio.addEventListener('pause', drawAudio);
    audio.addEventListener('ended', () => {
      if (!strict) { drawAudio(); return; }
      if (partIdx < parts.length - 1) {
        load(partIdx + 1);
        audio.play();
        switchPart(partIdx);   // the screen follows the recording, as in the real test
      } else {
        att.audio.done = true; save();
        startCheck();
      }
    });
    root._audio = audio;
    root._loadPart = load;
    root._partIdx = () => partIdx;
    if (review || att.mode === 'practice') load(review ? view : partIdx, review ? 0 : att.audio.time || 0);
    else if (att.audio.done) { startCheck(); return; }
    else {
      load(partIdx, att.audio.time || 0);
      if (fresh) audio.play().catch(() => {});
      else {
        // returning to an exam in progress: browsers need a click before audio can play
        main.insertAdjacentHTML('afterbegin', `<div class="resume-bar"><span>The recording is paused where you left it.</span><button class="btn primary" id="resume">${icon('play')} Continue listening</button></div>`);
        $('#resume', main).onclick = (e) => { audio.play(); e.target.closest('.resume-bar').remove(); };
      }
    }
    drawAudio();
  }

  function drawAudio() {
    const box = $('#x-audio', root);
    if (!box || !audio) return;
    const strict = att.mode === 'exam' && !review;
    const dur = audio.duration || 0, t = audio.currentTime || 0;
    const pIdx = root._partIdx ? root._partIdx() : 0;
    const pn = parts[pIdx]?.n;
    const pct = dur ? (t / dur) * 100 : 0;
    if (checkLeft != null && strict) { box.innerHTML = `<span class="live" style="--c:#999">Recording finished</span>`; return; }
    if (strict) {
      box.innerHTML = `${audio.paused ? '<span class="muted">Paused</span>' : `<span class="live">Part ${pn} playing</span>`}
        <div class="prog" aria-hidden="true"><i style="width:${pct}%"></i></div>
        <label title="Volume">${icon('volume-2')} <input type="range" min="0" max="1" step="0.05" value="${audio.volume}" data-act="vol"></label>`;
      return;
    }
    box.innerHTML = `<span class="muted">Part ${pn}</span>
      <button class="tbtn" data-act="back5" title="Back 5 seconds">${icon('rotate-ccw')}5</button>
      <button class="tbtn play" data-act="play">${icon(audio.paused ? 'play' : 'pause')}</button>
      <button class="tbtn" data-act="fwd5" title="Forward 5 seconds">5${icon('rotate-cw')}</button>
      <div class="prog seek" data-act="seek"><i style="width:${pct}%"></i></div>
      <span class="tnum">${fmtClock(t)} / ${fmtClock(dur)}</span>
      <select data-act="rate" title="Speed">${[0.75, 0.9, 1, 1.1, 1.25].map((r) => `<option value="${r}"${audio.playbackRate === r ? ' selected' : ''}>${r}×</option>`).join('')}</select>
      <label title="Volume">${icon('volume-2')} <input type="range" min="0" max="1" step="0.05" value="${audio.volume}" data-act="vol"></label>`;
  }

  function startCheck() {
    if (checkLeft != null) return;
    checkLeft = CHECK_SECONDS;
    att.phase = 'check';
    save();
    const ban = $('#x-banner .sub', root);
    if (ban) ban.textContent = 'The recording has finished. You have 2 minutes to check your answers.';
    toast('The recording has finished. You have 2 minutes to check your answers.', 5000);
    drawAudio();
  }

  // ---------------------------------------------------------------- READING
  function runReading() {
    const p = parts[view];
    main.innerHTML = `<div class="x-body" id="x-body">
      <div class="x-pane left text-pane" id="pane-l">
        <article class="passage" data-hz="p${p.n}">
          ${passageHtml(p)}
          <p class="orig no-hl"><button class="btn small ghost" data-act="pages">View original book pages</button></p>
        </article>
      </div>
      <div class="x-split" id="x-split"></div>
      <div class="x-pane" id="pane-q"><div class="qpanel">${partQuestionsHtml(p, T, ctx())}</div></div></div>`;
    $('#x-banner', root).innerHTML = `<b>Part ${p.n}</b><span class="sub">Read the text and answer questions ${p.from}–${p.to}.</span>`;
    afterPaneRender();
  }

  // ---------------------------------------------------------------- WRITING
  function runWriting() {
    const p = parts[view];
    const minW = p.n === 1 ? 150 : 250;
    main.innerHTML = `<div class="x-body" id="x-body">
      <div class="x-pane left text-pane" id="pane-l"><div class="wtask" data-hz="w${p.n}">
        ${p.text.filter((t) => !/^WRITING TASK/.test(t)).map((t) => /^(You should spend|Write at least)/.test(t) ? `<p class="muted-i">${esc(t)}</p>` : `<p class="prompt">${esc(t)}</p>`).join('')}
        ${(p.fig || []).map((f) => `<div class="wfig no-hl">${pageImg(T.book, f.page, f.box, T.ratio)}</div>`).join('')}
        <p class="orig no-hl"><button class="btn small ghost" data-act="pages">View original book page</button></p>
      </div></div>
      <div class="x-split" id="x-split"></div>
      <div class="x-pane" id="pane-q"><div class="wpanel">
        <textarea id="essay" spellcheck="false" autocorrect="off" autocapitalize="sentences" placeholder="Type your answer here" ${review ? 'readonly' : ''}>${esc(att.essays[p.n] || '')}</textarea>
        <div class="wcount"><span id="wc">Words: ${wordCount(att.essays[p.n])}</span><span class="muted">Minimum ${minW} words</span></div>
      </div></div></div>`;
    $('#x-banner', root).innerHTML = `<b>Part ${p.n}</b><span class="sub">You should spend about ${p.n === 1 ? 20 : 40} minutes on this task. Write at least ${minW} words.</span>`;
    const ta = $('#essay', main);
    ta.addEventListener('input', () => {
      att.essays[p.n] = ta.value;
      $('#wc', main).textContent = `Words: ${wordCount(ta.value)}`;
      save(); updateNav();
    });
    if (!review) setTimeout(() => ta.focus(), 50);
    afterPaneRender();
  }

  // ---------------------------------------------------------------- shared pane plumbing
  function ctx() {
    return { answers: att.answers, flags: att.flags, review, key, right: marked?.right || {} };
  }

  function afterPaneRender() {
    $$('[data-hz]', root).forEach((z) => paint(z, att.hl[z.dataset.hz]));
    const qp = $('#pane-q', root);
    unbindQ?.();
    unbindQ = sk !== 'W' && qp && !review ? bindQuestions(qp, { answers: att.answers, onAnswer: setAnswer, onFocus: setCurrent, onFlag: toggleFlag, groupsByFrom }) : null;
    // Enter in a gap moves to the next question
    qp?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[data-q]')) { e.preventDefault(); step(1); }
    });
    initSplit();
    updateNav();
    if (curQ && $(`#q-${curQ}`, root)) $(`#q-${curQ}`, root).classList.add('current');
  }

  function initSplit() {
    const sp = $('#x-split', root), body = $('#x-body', root);
    if (!sp) return;
    sp.onpointerdown = (e) => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      const r = body.getBoundingClientRect();
      const vertical = innerWidth <= 860;
      const move = (ev) => {
        const pct = vertical ? ((ev.clientY - r.top) / r.height) * 100 : ((ev.clientX - r.left) / r.width) * 100;
        root.style.setProperty('--split', clamp(pct, 25, 75) + '%');
      };
      const up = () => {
        sp.removeEventListener('pointermove', move);
        setSetting('split', parseFloat(root.style.getPropertyValue('--split')) || 52);
      };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up, { once: true });
    };
  }

  function switchPart(i, q) {
    if (i === view && q == null) return;
    if (i !== view) {
      view = i; att.view = i; save();
      if (sk === 'L') runListening(false);
      else if (sk === 'R') runReading();
      else runWriting();
      $('#pane-q', root)?.scrollTo(0, 0); $('#pane-l', root)?.scrollTo(0, 0);
      if (review && sk === 'L' && audio) { root._loadPart(i, 0); drawAudio(); }
      if (sk === 'L' && att.mode === 'practice' && audio && !review && root._partIdx() !== i) { audio.pause(); root._loadPart(i, 0); drawAudio(); }
    }
    if (q != null) { setCurrent(q); focusQuestion(root, q); }
  }

  function step(d) {
    if (sk === 'W') { const i = clamp(view + d, 0, parts.length - 1); switchPart(i); return; }
    const idx = curQ == null ? (d > 0 ? -1 : allQs.length) : allQs.indexOf(curQ);
    const nq = allQs[clamp(idx + d, 0, allQs.length - 1)];
    const pi = parts.findIndex((p) => nq >= p.from && nq <= p.to);
    switchPart(pi, nq);
  }

  // ---------------------------------------------------------------- footer navigator
  function updateNav() {
    const foot = $('#x-foot', root);
    if (!foot) return;
    let html = '<div class="x-parts">';
    parts.forEach((p, i) => {
      if (sk === 'W') {
        const wc = wordCount(att.essays[p.n]);
        html += `<div class="x-part${i === view ? ' active' : ''}" data-part="${i}"><span class="pl">Part ${p.n}</span><span class="cnt">${wc} words</span></div>`;
        return;
      }
      const qs = qsOf(p);
      const done = qs.filter((q) => att.answers[q]).length;
      if (i === view) {
        html += `<div class="x-part active" data-part="${i}"><span class="pl">Part ${p.n}</span><span class="nums">${qs.map((q) => {
          let c = 'num';
          if (review) c += marked.right[q] ? ' right' : ' wrong';
          else if (att.answers[q]) c += ' answered';
          if (att.flags[q]) c += ' flagged';
          if (q === curQ) c += ' cur';
          return `<button class="${c}" data-q="${q}" aria-label="Question ${q}">${q}</button>`;
        }).join('')}</span></div>`;
      } else {
        const lab = review ? `${qs.filter((q) => marked.right[q]).length} of ${qs.length} correct` : `${done} of ${qs.length}`;
        html += `<div class="x-part" data-part="${i}"><span class="pl">Part ${p.n}</span><span class="cnt">${lab}</span></div>`;
      }
    });
    html += '</div><div class="x-nav">';
    if (!review && sk !== 'W' && curQ) html += `<label class="review-chk"><input type="checkbox" data-act="flagcur" ${att.flags[curQ] ? 'checked' : ''}> Review</label>`;
    html += `<button data-act="prev" aria-label="Previous">${icon('arrow-left')}</button><button data-act="next" aria-label="Next">${icon('arrow-right')}</button>`;
    html += review ? `<button class="submit review" data-act="results">Results</button>` : `<button class="submit" data-act="submit">${icon('check')} Submit</button>`;
    html += '</div>';
    foot.innerHTML = html;
  }

  // ---------------------------------------------------------------- clock
  function startClock() {
    timers.forEach(clearInterval); timers = [];
    drawClock();
    if (review) return;
    let tick = 0;
    timers.push(setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (att.phase === 'run' || att.phase === 'check') {
        att.elapsed = (att.elapsed || 0) + 1;
        if (++tick % 15 === 0) addActivity(15);
        if (checkLeft != null) {
          checkLeft--;
          if (checkLeft <= 0) { finish(true); return; }
        }
        if (att.mode === 'exam' && att.limit && att.elapsed >= att.limit && sk !== 'L') { finish(true); return; }
        if (tick % 5 === 0) save();
        drawClock();
      }
    }, 1000));
  }

  function drawClock() {
    const el = $('#x-timer', root);
    if (!el) return;
    if (review) { el.innerHTML = `Review mode`; return; }
    if (el.dataset.hidden) { el.innerHTML = 'Show time'; el.className = 'x-timer'; return; }
    let txt, warn = '';
    if (sk === 'L' && checkLeft != null) {
      txt = `${fmtClock(checkLeft)} to check answers`; warn = checkLeft < 30 ? 'urgent' : 'warn';
    } else if (sk === 'L') {
      txt = att.mode === 'exam' ? 'Listening in progress' : `${fmtClock(att.elapsed)} elapsed`;
    } else if (att.limit) {
      const left = att.limit - att.elapsed;
      if (left >= 0) {
        const m = Math.ceil(left / 60);
        txt = left > 300 ? `${m} minutes left` : `${fmtClock(left)} left`;
        warn = left <= 60 ? 'urgent' : left <= 300 ? 'warn' : '';
        // the real clock flashes when 10 and 5 minutes remain
        if ((left <= 600 && left > 590) || (left <= 300 && left > 290)) warn += ' flash';
      } else {
        txt = `${fmtClock(-left)} over time`; warn = 'warn';
      }
    } else txt = `${fmtClock(att.elapsed)} elapsed`;
    el.className = 'x-timer' + (warn ? ' ' + warn : '');
    el.innerHTML = `${icon('timer')} ${txt}`;
  }

  // ---------------------------------------------------------------- finish
  async function finish(auto = false) {
    if (att.finished) return;
    if (!auto) {
      let msg = 'Submit your answers and finish this test?';
      if (sk !== 'W') {
        const blank = allQs.filter((q) => !att.answers[q]).length;
        if (blank) msg = `You have ${blank} unanswered question${blank > 1 ? 's' : ''}. Submit anyway?`;
        if (sk === 'L' && att.mode === 'exam' && audio && !audio.paused) msg = 'The recording is still playing. ' + msg;
      } else {
        const short = parts.filter((p) => wordCount(att.essays[p.n]) < (p.n === 1 ? 150 : 250));
        if (short.length) msg = `Task ${short.map((p) => p.n).join(' and ')} is under the minimum word count. Submit anyway?`;
      }
      if (!(await confirmBox(msg, 'Submit', 'Keep working'))) return;
    }
    cleanup();
    att.finished = Date.now();
    att.phase = 'done';
    if (sk !== 'W') {
      const r = markAnswers(key, att.answers, allQs);
      const byPart = {}, byType = {};
      parts.forEach((p) => {
        const qs = qsOf(p);
        byPart[p.n] = [qs.filter((q) => r.right[q]).length, qs.length];
        p.groups.forEach((g) => {
          const t = typeOf(g);
          const b = byType[t] || (byType[t] = [0, 0]);
          for (let q = g.from; q <= g.to; q++) { b[1]++; if (r.right[q]) b[0]++; }
        });
      });
      att.result = { score: r.score, total: r.total, band: band(sk, r.score, r.total), right: r.right, byPart, byType };
    } else {
      att.result = { words: Object.fromEntries(parts.map((p) => [p.n, wordCount(att.essays[p.n])])) };
    }
    if (att.mock) { const m = getMock(att.mock); if (m) m.ids[sk] = att.id; }
    saveResult(att);
    if (auto) toast(sk === 'L' ? 'Time is up — your answers have been submitted.' : 'Time is up — the test has been submitted.', 4000);
    location.hash = `#/r/${att.id}`;
  }

  // ---------------------------------------------------------------- events
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act], [data-part], .num[data-q]');
    if (!t) return;
    if (t.matches('.num[data-q]')) {
      const q = +t.dataset.q; const pi = parts.findIndex((p) => q >= p.from && q <= p.to);
      switchPart(pi, q); return;
    }
    if (t.dataset.part != null && !t.dataset.act) { switchPart(+t.dataset.part); return; }
    const a = t.dataset.act;
    if (a === 'prev') step(-1);
    if (a === 'next') step(1);
    if (a === 'submit') finish();
    if (a === 'results') { cleanup(); location.hash = `#/r/${att.id}`; }
    if (a === 'flagcur' && curQ) toggleFlag(curQ);
    if (a === 'settings') colourSettings();
    if (a === 'help') help();
    if (a === 'bands') bandGuide();
    if (a === 'pages') showPages();
    if (a === 'exit') {
      if (!review && att.started && !(await confirmBox('Leave the test? Your answers are saved — you can continue later from the home page.', 'Leave', 'Stay'))) return;
      cleanup();
      location.hash = `#/t/${att.test}`;
    }
    if (a === 'play' && audio) { audio.paused ? audio.play() : audio.pause(); }
    if (a === 'back5' && audio) audio.currentTime = Math.max(0, audio.currentTime - 5);
    if (a === 'fwd5' && audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    if (a === 'seek' && audio && audio.duration) {
      const r = t.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    }
  });
  root.addEventListener('input', (e) => {
    const a = e.target.dataset.act;
    if (a === 'vol' && audio) { audio.volume = +e.target.value; setSetting('volume', audio.volume); }
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'rate' && audio) audio.playbackRate = +e.target.value;
  });
  $('#x-timer', root).addEventListener('click', (e) => {
    const el = e.currentTarget;
    if (el.dataset.hidden) delete el.dataset.hidden; else el.dataset.hidden = '1';
    drawClock();
  });
  const onKey = (e) => {
    if (isTyping(e)) return;
    if (sk === 'L' && audio && (att.mode === 'practice' || review) && e.key === ' ') { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
  };
  document.addEventListener('keydown', onKey);
  hlOff = enableHighlighting(root, { get: (z) => att.hl[z], set: (z, r) => { att.hl[z] = r; save(); } });

  function colourSettings() {
    const sizes = [[16, 'Standard'], [19, 'Large'], [22, 'Extra large']];
    const cur = settings().textSize || 16;
    const near = sizes.reduce((a, b) => (Math.abs(b[0] - cur) < Math.abs(a[0] - cur) ? b : a))[0];
    modal(`<h2>Settings</h2>
      <p class="muted">As in the computer test, you can change the text size and the colours. Your choice is remembered.</p>
      <h3>Text size</h3>
      <div class="stack">${sizes.map(([v, l]) => `<label class="row"><input type="radio" name="ts" value="${v}" ${near === v ? 'checked' : ''}> <span style="font-size:${v}px">${l}</span></label>`).join('')}</div>
      <h3>Colours</h3>
      <div class="stack">${[['', 'Black on white (standard)'], ['wob', 'White on black'], ['yob', 'Yellow on black']].map(([v, l]) =>
        `<label class="row"><input type="radio" name="ct" value="${v}" ${(settings().contrast || '') === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="actions"><button class="btn primary" data-close="ok">Done</button></div>`, {
      onMount: (d) => d.addEventListener('change', (ev) => {
        if (ev.target.name === 'ct') { setSetting('contrast', ev.target.value); root.dataset.contrast = ev.target.value; }
        if (ev.target.name === 'ts') { setSetting('textSize', +ev.target.value); root.style.setProperty('--exam-size', ev.target.value + 'px'); }
      }),
    });
  }
  function help() {
    modal(`<h2>How this test works</h2><ul>
      <li><b>Gaps:</b> type in the box that shows the question number. Press <kbd>Enter</kbd> or <kbd>Tab</kbd> to go on.</li>
      <li><b>Choices:</b> click an answer to select it; click it again to clear it. For "choose TWO", tick two boxes.</li>
      <li><b>Matching:</b> drag an option into the box beside the question, or click the box and pick from the list.</li>
      <li><b>Navigation:</b> the numbers at the bottom jump to any question. A line under a number means it is answered; a circle means you marked it for review (${icon('flag')} or the Review box).</li>
      <li><b>Highlight and notes:</b> select text, then right-click (or use the pop-up) and choose Highlight or Note. Right-click a highlight to clear it.</li>
      <li>Drag the bar between the two panes to resize them. Text size and colours are under Settings.</li>
      <li>The clock flashes when 10 and 5 minutes remain; click it to hide or show the time.</li>
      ${fsSupported ? '<li><b>Full screen</b> (top right) hides the browser tabs and toolbars. Press <kbd>Esc</kbd> to leave it.</li>' : ''}
      ${sk === 'L' && att.mode === 'practice' ? '<li>Practice mode: <kbd>Space</kbd> plays or pauses the recording.</li>' : ''}
      <li>Everything is saved as you go. You can leave and continue later.</li></ul>
      <div class="actions"><button class="btn primary" data-close="ok">OK</button></div>`);
  }
  function bandGuide() {
    modal(`<h2>Band scores · ${SKILL[sk]}</h2><div class="bg-mount"></div>
      <div class="actions"><button class="btn primary" data-close="ok">Close</button></div>`, {
      wide: true, onMount: (d) => mountBandGuide($('.bg-mount', d), sk, att.result),
    });
  }
  function showPages() {
    const p = parts[view];
    const pages = sk === 'W' ? p.pages : p.pages;
    modal(`<h2>Original book pages</h2><p class="muted">Scanned pages from ${esc(testName(info))} — use these if anything in the text version looks wrong.</p>
      <div class="lightbox">${pages.map((n) => pageImg(T.book, n)).join('')}</div>
      <div class="actions"><button class="btn primary" data-close="ok">Close</button></div>`, { wide: true });
  }

  function cleanup() {
    timers.forEach(clearInterval); timers = [];
    if (audio) { audio.pause(); audio.src = ''; }
    hlOff?.();
    unbindQ?.();
    document.removeEventListener('keydown', onKey);
    save(true);
  }
  return cleanup;

}

function fmtMinutes(sec) {
  if (sec % 60) return `${Math.floor(sec / 60)} min ${sec % 60} s`;
  const m = sec / 60;
  return m % 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`;
}
