// Global audio player docked at the bottom of the screen.
import { $, esc, fmtTime, isTyping, toast } from './util.js';
import { TRACK, label } from './data.js';
import { trackPlayed, S } from './store.js';
import { icon } from '../cbt/js/icons.js';

const audio = new Audio();
audio.preload = 'auto';
let cur = null;          // current track object
let opts = {};           // { strict, onEnded, context }
let loopA = null, loopB = null;
let finishedMarked = false;
const listeners = new Set();

export const onPlayer = (f) => (listeners.add(f), () => listeners.delete(f));
const emit = () => listeners.forEach((f) => f(state()));
export const state = () => ({ n: cur?.n ?? null, playing: !audio.paused, time: audio.currentTime, strict: !!opts.strict });

export function play(n, o = {}) {
  const t = TRACK[n];
  if (!t) return;
  if (cur?.n === n && !o.restart) {
    if (audio.paused) audio.play(); else if (!opts.strict) audio.pause();
    return;
  }
  cur = t; opts = o; loopA = loopB = null; finishedMarked = false;
  audio.src = `audio/${t.file}`;
  audio.playbackRate = o.strict ? 1 : Number(sessionStorage.getItem('rate') || 1);
  audio.play().catch(() => toast('Press play to start audio'));
  trackPlayed(n, false);
  render();
  emit();
}
export function stop() {
  audio.pause(); audio.removeAttribute('src'); audio.load();
  cur = null; opts = {};
  render(); emit();
}
export const current = () => cur;

audio.addEventListener('timeupdate', () => {
  if (loopA != null && loopB != null && audio.currentTime >= loopB) audio.currentTime = loopA;
  if (!finishedMarked && cur && audio.duration && audio.currentTime / audio.duration > 0.9) {
    finishedMarked = true; trackPlayed(cur.n, true);
  }
  const seek = $('#p-seek'), tm = $('#p-time');
  if (seek && !seek.matches(':active')) seek.value = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
  if (tm) tm.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration || cur?.dur)}`;
});
audio.addEventListener('play', () => { updateBtn(); emit(); });
audio.addEventListener('pause', () => { updateBtn(); emit(); });
audio.addEventListener('ended', () => {
  updateBtn(); emit();
  const cb = opts.onEnded; if (cb) cb();
});

function updateBtn() {
  const b = $('#p-play');
  if (b) b.innerHTML = icon(audio.paused ? 'play' : 'pause');
}

function render() {
  const el = $('#player');
  if (!cur) {
    el.hidden = true; document.documentElement.style.setProperty('--player-h', '0px');
    return;
  }
  const t = cur, strict = !!opts.strict;
  const ref = t.refs?.[0];
  el.hidden = false;
  el.innerHTML = `
    <button class="p-play" id="p-play" data-p="toggle" ${strict ? 'disabled title="Exam mode: audio plays once without pausing"' : ''}>${icon('play')}</button>
    <div class="p-title"><b title="${esc(t.title)}">Track ${t.n} · ${esc(t.title)}</b>
      <small>${strict ? `<span class="strict">${icon('circle')} Exam mode — plays once</span>` : `${fmtTime(t.dur)}${ref ? ` · page ${label(ref.page)}` : ''}`}</small></div>
    ${strict ? '' : `<button class="btn sm ghost" data-p="back" title="Back 5s (←)">−5s</button>`}
    <div class="p-seek"><input type="range" id="p-seek" min="0" max="1000" value="0" ${strict ? 'disabled' : ''}><span id="p-time">0:00</span></div>
    ${strict ? '' : `<button class="btn sm ghost" data-p="fwd" title="Forward 5s (→)">+5s</button>
    <select id="p-rate" title="Speed">${[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((r) => `<option value="${r}" ${audio.playbackRate == r ? 'selected' : ''}>${r}×</option>`).join('')}</select>
    <button class="btn sm ${loopA != null ? 'on' : ''}" data-p="loop" title="Repeat a part: click at start, click at end, click again to clear">${loopLabel()}</button>
    ${ref ? `<a class="btn sm" href="#/page/${ref.page}?y=${ref.y}" title="Open the page with this exercise">Page</a>` : ''}
    ${t.script ? `<button class="btn sm" data-p="script" title="Show the recording script">Script</button>` : ''}
    <button class="icon-btn" data-p="close" title="Close player" aria-label="Close player">${icon('x')}</button>`}
  `;
  updateBtn();
  requestAnimationFrame(() => document.documentElement.style.setProperty('--player-h', el.offsetHeight + 'px'));
}
function loopLabel() {
  if (loopA == null) return 'A–B';
  if (loopB == null) return `A ${fmtTime(loopA)} → B?`;
  return `${icon('repeat')} ${fmtTime(loopA)}–${fmtTime(loopB)}`;
}

export function initPlayer() {
  const el = $('#player');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const a = b.dataset.p;
    if (a === 'toggle') audio.paused ? audio.play() : audio.pause();
    if (a === 'back') audio.currentTime = Math.max(0, audio.currentTime - 5);
    if (a === 'fwd') audio.currentTime = Math.min(audio.duration || 1e9, audio.currentTime + 5);
    if (a === 'close') stop();
    if (a === 'script') window.dispatchEvent(new CustomEvent('open-script', { detail: cur }));
    if (a === 'loop') {
      if (loopA == null) loopA = audio.currentTime;
      else if (loopB == null) { loopB = audio.currentTime; if (loopB <= loopA) loopA = loopB = null; else audio.currentTime = loopA; }
      else loopA = loopB = null;
      render();
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.id === 'p-seek' && audio.duration && !opts.strict) audio.currentTime = (e.target.value / 1000) * audio.duration;
    if (e.target.id === 'p-rate') { audio.playbackRate = Number(e.target.value); sessionStorage.setItem('rate', e.target.value); }
  });
  document.addEventListener('keydown', (e) => {
    if (!cur || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || opts.strict) return;
    if (e.code === 'Space') { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
    else if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); }
    else if (e.key === 'ArrowRight') { audio.currentTime += 5; }
  });
  new ResizeObserver(() => { if (cur) document.documentElement.style.setProperty('--player-h', el.offsetHeight + 'px'); }).observe(el);
}
export const isListened = (n) => !!S().plays[n]?.done;
