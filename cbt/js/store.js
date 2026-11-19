// All progress lives in localStorage (one JSON blob). Speaking recordings live in IndexedDB (see rec.js).
// A copy is kept on disk by serve.py (../progress/test-centre.json), see ../../js/sync.js. Nothing is committed by itself.
// The Mac and the phone both work on that copy; merge.js folds their changes together.
import { dayKey, uid } from './util.js';
import { makeSync } from '../../js/sync.js';
import { DEFAULT, SHARED, normalize, mergeState, sumActivity } from './merge.js';
import { makeGitHubSync, checkGithub } from './ghsync.js';

const KEY = 'ielts-cbt.v1';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);    // on the Mac itself
/** Served as plain files (the folder made by tools/static_site.py, e.g. on GitHub Pages): no serve.py behind the page. */
export const STATIC = document.documentElement.dataset.host === 'static';

/** A name for this browser, to count its study time apart from the other devices'. */
export const DEVICE = (() => {
  try {
    let d = localStorage.getItem(KEY + '.device');
    if (!d) localStorage.setItem(KEY + '.device', (d = (LOCAL ? 'mac-' : 'phone-') + uid().slice(-5)));
    return d;
  } catch { return 'dev-' + uid().slice(-5); }
})();

let state = load();
const subs = new Set();
const syncSubs = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : DEFAULT());
  } catch {
    return DEFAULT();
  }
}

// `u` on an attempt is when it last changed. Rather than every caller remembering to set it, each attempt
// is compared with how it looked the last time it was written.
const seen = new Map();
const body = (a) => { const { u, ...rest } = a; return JSON.stringify(rest); };
function remember() { seen.clear(); for (const [id, a] of Object.entries(state.attempts)) seen.set(id, body(a)); }
function stamp() {
  const now = Date.now();
  for (const [id, a] of Object.entries(state.attempts)) {
    const b = body(a);
    if (seen.get(id) === b) continue;
    if (seen.has(id) || !a.u) a.u = now;
    seen.set(id, b);
  }
  for (const id of seen.keys()) if (!state.attempts[id]) seen.delete(id);
}
remember();

const writeLocal = () => { stamp(); try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); } };

/**
 * Fold another copy (the disk's, or GitHub's) into this browser's. True when this browser has something
 * that copy lacks. `other()`: the place the copy did not come from — what it brought is news there.
 */
function fold(remote, other) {
  stamp();
  const r = mergeState(state, remote);
  if (r.changed) {
    remember(); writeLocal();
    subs.forEach((f) => f(state));
    other().push();
  }
  return r.push;
}
const told = () => syncSubs.forEach((f) => f());
const current = () => { stamp(); return state; };
// the copy on this Mac's disk, through serve.py …
const sync = makeSync('test-centre', {
  get: current, merge: (remote) => fold(remote, () => gh),
  delay: LOCAL ? 1500 : 15000,       // over the network: fewer, larger saves
  onStatus: told, off: STATIC,
});
// … and the copy on GitHub (see ghsync.js), where a phone on GitHub Pages and the Mac meet: through serve.py's git
// on the Mac, with a token everywhere else
const gh = makeGitHubSync({ get: current, merge: (remote) => fold(remote, () => sync), onStatus: told, device: DEVICE, server: LOCAL && !STATIC });

/** Load the copy saved on disk and merge it in. On the Mac, call once before the first render. GitHub follows in the background. */
export const initSync = () => { gh.pull(); return sync.pull(); };
/** `gh`: the same for GitHub — { on, repo, online, last, error }. */
export const syncStatus = () => ({ ...sync.status(), gh: gh.status() });
/** Pull and push now, everywhere. Resolves true if somewhere answered. */
export async function syncNow() {
  const [a, b] = await Promise.all([sync.pull(), gh.pull()]);
  await Promise.all([sync.flush(false), gh.flush()]);
  return a || b;
}
export function onSync(f) { syncSubs.add(f); return () => syncSubs.delete(f); }
/** Start keeping progress on GitHub. Throws with a reason to show if the token or repository is no good. */
export async function connectGithub(token, repo, api) {
  gh.configure(await checkGithub(token, repo, api));
  return gh.pull();
}
export const disconnectGithub = () => gh.configure(null);

let timer;
/** `commit`: a name for this save (a finished test), used as the commit message when you exchange through GitHub. */
export function save(now = false, commit = null) {
  clearTimeout(timer);
  state.savedAt = Date.now();
  if (now) writeLocal(); else timer = setTimeout(writeLocal, 200);
  sync.push(commit); gh.push(commit);
  subs.forEach((f) => f(state));
}
addEventListener('beforeunload', () => { writeLocal(); sync.flush(); });
addEventListener('pagehide', () => { writeLocal(); sync.flush(); });
// coming back to the app (or back into range of the Mac): see what the other device has done meanwhile
let lastPull = Date.now();
function repull() {
  if (document.visibilityState !== 'visible' || Date.now() - lastPull < 20000) return;
  lastPull = Date.now();
  sync.pull(); gh.pull();
}
// leaving the app (phone locked, tab hidden): send what is waiting, GitHub included
// GitHub is written only by syncNow() ("Exchange now"), never on leaving the page
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { writeLocal(); sync.flush(); } else repull(); });
addEventListener('online', repull);

const SKILL_NAME = { L: 'Listening', R: 'Reading', W: 'Writing', S: 'Speaking' };
/** Save and record a finished (or re-scored) attempt in git history. */
export function saveResult(a, what = '') {
  const [book, test] = a.test.split('-');
  const r = a.result || {};
  const bits = [];
  if (r.score != null) bits.push(`${r.score}/${r.total}`);
  const band = r.band ?? a.self?.band;
  if (band != null) bits.push(`band ${Number(band).toFixed(1)}`);
  if (r.words) bits.push(Object.entries(r.words).map(([n, w]) => `task ${n}: ${w} words`).join(', '));
  if (a.mode === 'practice') bits.push('practice');
  save(true, `Result: Cambridge ${book} Test ${test} ${SKILL_NAME[a.skill]}${what ? ' ' + what : ''}${bits.length ? ' — ' + bits.join(', ') : ''}`);
}

export const S = () => state;
export const settings = () => state.settings;
export function setSetting(k, v) {
  state.settings[k] = v;
  if (SHARED.includes(k)) state.settingsAt = Date.now();
  save();
}
export function onChange(f) { subs.add(f); return () => subs.delete(f); }

/** Learn pages: is item `id` ('section/item') marked as learnt? */
export const isLearnt = (id) => !!state.learnt[id]?.on;
export function setLearnt(id, on) { state.learnt[id] = { on: !!on, at: Date.now() }; save(); }

/**
 * skill: L R W S.  parts: which parts/passages/tasks are included (numbers).  mode: 'exam' | 'practice'.
 */
export function newAttempt({ test, skill, parts, mode, mock = null, limit = 0 }) {
  const a = {
    id: uid(), test, skill, parts, mode, mock, limit,
    created: Date.now(), started: null, finished: null, elapsed: 0,
    answers: {}, flags: {}, hl: {}, essays: {}, recs: [], audio: { part: parts[0], time: 0, done: false },
    result: null, self: null, phase: 'intro',
  };
  state.attempts[a.id] = a;
  save(true);
  return a;
}
export const getAttempt = (id) => state.attempts[id];
export function deleteAttempt(id) { delete state.attempts[id]; state.deleted[id] = Date.now(); save(); }
export function attemptsFor(test, skill) {
  return Object.values(state.attempts).filter((a) => a.test === test && (!skill || a.skill === skill)).sort((a, b) => b.created - a.created);
}
export function finishedAttempts() {
  return Object.values(state.attempts).filter((a) => a.finished).sort((a, b) => a.finished - b.finished);
}
export function openAttempts() {
  return Object.values(state.attempts).filter((a) => !a.finished && a.started).sort((a, b) => b.created - a.created);
}

export function newMock(test, seq) {
  const m = { id: uid(), test, seq, ids: {}, created: Date.now() };
  state.mocks[m.id] = m; save(true); return m;
}
export const getMock = (id) => state.mocks[id];

export function addActivity(sec) {
  const k = dayKey(), mine = (state.act[DEVICE] ||= {});
  mine[k] = (mine[k] || 0) + sec;
  state.activity[k] = (state.activity[k] || 0) + sec;
  save();
}

export function exportJSON() { stamp(); return JSON.stringify(state); }
/** Add what a backup file (or another device's export) holds to what is here; nothing here is dropped. */
export function importJSON(txt) {
  const s = JSON.parse(txt);
  if (!s || typeof s !== 'object' || !s.attempts) throw new Error('Not a Test Centre backup file');
  stamp();
  mergeState(state, s);
  remember();
  save(true, 'Add Test Centre progress from a backup file');
}
export function resetAll() {
  // mark every attempt as deleted, or the next sync would bring them back from the other device
  const gone = { ...state.deleted };
  for (const id of Object.keys(state.attempts)) gone[id] = Date.now();
  state = { ...DEFAULT(), deleted: gone, act: { [DEVICE]: {} } };
  sumActivity(state);
  remember();
  save(true, 'Reset Test Centre progress');
}
