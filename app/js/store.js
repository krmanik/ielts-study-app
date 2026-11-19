// All progress lives in localStorage (one JSON blob). Recordings live in IndexedDB (see db.js).
// A copy is kept on disk by serve.py (../progress/study-suite.json), see sync.js. Nothing is committed by itself.
import { dayKey } from './util.js';
import { makeSync } from './sync.js';

const KEY = 'ielts-suite.v1';
const DEFAULT = () => ({
  done: {},            // sectionId -> timestamp completed
  visited: {},         // sectionId -> timestamp last opened
  lastPos: null,       // { route, title, page, ts }
  notes: {},           // sectionId | 'p<page>' -> text
  bookmarks: [],       // { page, label, ts }
  plays: {},           // track n -> { count, done }
  attempts: [],        // practice test attempts (listening/reading/writing/speaking)
  drafts: {},          // in-progress exam answers: key -> { answers, startedAt, elapsed }
  vocab: [],           // { id, word, meaning, example, page, box, due, ts }
  activity: {},        // 'YYYY-MM-DD' -> seconds studied
  savedAt: 0,
  settings: { theme: 'auto', darkPages: false, module: 'ac', dailyGoal: 30, examDate: '', targetBand: 7, zoom: 860, strictAudio: true },
});

let state = load();
const subs = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT();
    const s = JSON.parse(raw), d = DEFAULT();
    return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
  } catch {
    return DEFAULT();
  }
}
const writeLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); } };

const sync = makeSync('study-suite', {
  get: () => state,
  adopt(remote) {
    const d = DEFAULT();
    state = { ...d, ...remote, settings: { ...d.settings, ...(remote.settings || {}) } };
    writeLocal();
  },
});
/** Load the copy saved on disk (if it is newer). Call once before the first render. */
export const initSync = () => sync.pull();
export const syncStatus = () => sync.status();

let saveTimer;
/** `commit`: a name for this save (a finished test); the server no longer commits anything. */
export function save(commit = null) {
  clearTimeout(saveTimer);
  state.savedAt = Date.now();
  saveTimer = setTimeout(writeLocal, 150);
  sync.push(commit);
  subs.forEach((f) => f(state));
}
window.addEventListener('beforeunload', () => { writeLocal(); sync.flush(); });
window.addEventListener('pagehide', () => { writeLocal(); sync.flush(); });

export const S = () => state;
export const settings = () => state.settings;
export function setSetting(k, v) { state.settings[k] = v; save(); }
export function onChange(f) { subs.add(f); return () => subs.delete(f); }

export function isDone(id) { return !!state.done[id]; }
export function setDone(id, on = true) {
  if (on) state.done[id] = Date.now(); else delete state.done[id];
  save();
}
export function visit(id) { state.visited[id] = Date.now(); save(); }
export function setLastPos(pos) { state.lastPos = { ...pos, ts: Date.now() }; save(); }

export function addActivity(sec) {
  const k = dayKey();
  state.activity[k] = (state.activity[k] || 0) + sec;
  save();
}
export function todaySeconds() { return state.activity[dayKey()] || 0; }
export function streak() {
  // consecutive days (ending today or yesterday) with >= 5 minutes of study
  let n = 0; const d = new Date();
  if ((state.activity[dayKey(d)] || 0) < 300) d.setDate(d.getDate() - 1);
  while ((state.activity[dayKey(d)] || 0) >= 300) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

export function trackPlayed(n, finished) {
  const p = state.plays[n] || (state.plays[n] = { count: 0, done: false });
  if (finished) p.done = true; else p.count++;
  save();
}

export function exportJSON() { return JSON.stringify(state, null, 1); }
export function importJSON(txt) {
  const s = JSON.parse(txt);
  if (!s || typeof s !== 'object' || !s.settings) throw new Error('Not a backup file');
  const d = DEFAULT();
  state = { ...d, ...s, settings: { ...d.settings, ...s.settings } };
  save('Restore Study Suite progress from a backup file');
}
export function resetAll() { state = DEFAULT(); save('Reset Study Suite progress'); }
