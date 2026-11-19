// Folding two copies of the Test Centre progress together (this browser's and the one on disk), so the
// Mac and the phone can both be used and neither loses work. No DOM in here: it also runs under Node.
//
//  attempts   kept from both sides; where both have the same attempt, the one changed last (`u`) wins
//  deleted    a deletion on either side removes the attempt on both
//  mocks      kept from both sides
//  act        seconds studied per device per day; each device only ever adds to its own counter, so the
//             larger number is the newer one. `activity` (what the charts read) is the sum over devices.
//  settings   the SHARED ones follow whoever changed them last; the rest belong to each device
//  learnt     Learn pages marked as learnt: id -> { on, at }; per item, the later change wins

/** Settings that follow you between devices. Text size, theme, pane split etc. stay with the device. */
export const SHARED = ['target', 'examDate', 'planTests', 'readingMinutes', 'strictListening'];

export const DEFAULT = () => ({
  attempts: {},        // id -> attempt (see newAttempt in store.js)
  mocks: {},           // id -> { id, test, seq: ['L','R','W'], ids: {L: attemptId, ...}, created }
  activity: {},        // 'YYYY-MM-DD' -> seconds in tests, all devices together
  act: {},             // device id -> { 'YYYY-MM-DD' -> seconds }
  deleted: {},         // attempt id -> when it was deleted (so another copy does not bring it back)
  learnt: {},          // Learn item id ('section/item') -> { on: true|false, at: when it was last changed }
  savedAt: 0,
  settingsAt: 0,       // when a SHARED setting was last changed
  settings: { theme: 'auto', contrast: '', textSize: 16, target: 7, examDate: '', strictListening: true, split: 52,
    fullscreen: false,     // go full screen when a test starts
    readingMinutes: 60,    // time for a full Reading test: 60 (real exam), 50 or 40 to train reading speed
    planTests: 0 },        // tests to finish before the exam (0 = all of them)
});

/** Fill in what an older or partial copy lacks. Returns the same object. */
export function normalize(s) {
  const d = DEFAULT();
  for (const k of Object.keys(d)) if (k !== 'settings' && s[k] == null) s[k] = d[k];
  s.settings = { ...d.settings, ...(s.settings || {}) };
  // copies from before devices were counted separately: their totals become one fixed counter
  if (!Object.keys(s.act).length && Object.keys(s.activity).length) s.act = { base: { ...s.activity } };
  if (!s.settingsAt) s.settingsAt = s.savedAt || 0;
  for (const a of Object.values(s.attempts)) if (!a.u) a.u = a.finished || a.started || a.created || 0;
  return s;
}

export function sumActivity(s) {
  const out = {};
  for (const days of Object.values(s.act)) for (const [d, sec] of Object.entries(days)) out[d] = (out[d] || 0) + sec;
  s.activity = out;
}

const rank = (a) => [a.u || 0, a.finished ? 1 : 0, a.elapsed || 0];
function newer(a, b) {
  const x = rank(a), y = rank(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * Fold `remote` into `state`, changing `state` in place — and each attempt in place, because an open
 * test screen holds on to its attempt object.
 * -> { changed: something here was updated, push: this side has something `remote` lacks }
 */
export function mergeState(state, remote) {
  remote = normalize(remote);
  let changed = false, push = false;
  const fresh = !state.savedAt;      // nothing has been done in this browser yet

  for (const [id, ts] of Object.entries(remote.deleted)) if (!state.deleted[id]) { state.deleted[id] = ts; changed = true; }
  for (const id of Object.keys(state.deleted)) {
    if (!remote.deleted[id] || remote.attempts[id]) push = true;
    if (state.attempts[id]) { delete state.attempts[id]; changed = true; }
  }

  for (const [id, r] of Object.entries(remote.attempts)) {
    if (state.deleted[id]) continue;
    const l = state.attempts[id];
    if (!l) { state.attempts[id] = r; changed = true; }
    else if (newer(r, l)) {
      for (const k of Object.keys(l)) if (!(k in r)) delete l[k];
      Object.assign(l, r);
      changed = true;
    } else if (newer(l, r)) push = true;
  }
  for (const id of Object.keys(state.attempts)) if (!remote.attempts[id]) push = true;

  for (const [id, r] of Object.entries(remote.mocks)) {
    const l = state.mocks[id];
    if (!l) { state.mocks[id] = r; changed = true; continue; }
    l.ids ||= {};
    for (const [sk, aid] of Object.entries(r.ids || {})) if (!l.ids[sk]) { l.ids[sk] = aid; changed = true; }
  }
  for (const [id, l] of Object.entries(state.mocks)) {
    const r = remote.mocks[id];
    if (!r || Object.keys(l.ids || {}).some((sk) => !r.ids?.[sk])) push = true;
  }

  for (const [dev, days] of Object.entries(remote.act)) {
    const mine = (state.act[dev] ||= {});
    for (const [d, sec] of Object.entries(days)) if ((mine[d] || 0) < sec) { mine[d] = sec; changed = true; }
  }
  for (const [dev, days] of Object.entries(state.act)) {
    for (const [d, sec] of Object.entries(days)) if ((remote.act[dev]?.[d] || 0) < sec) push = true;
  }
  sumActivity(state);

  for (const [id, r] of Object.entries(remote.learnt)) {
    const l = state.learnt[id];
    if (!l || r.at > l.at) { state.learnt[id] = r; changed = true; }
  }
  for (const [id, l] of Object.entries(state.learnt)) if (!remote.learnt[id] || l.at > remote.learnt[id].at) push = true;

  if (fresh) { state.settings = { ...state.settings, ...remote.settings }; state.settingsAt = remote.settingsAt; changed = true; }
  else if (remote.settingsAt > state.settingsAt) {
    for (const k of SHARED) if (k in remote.settings) state.settings[k] = remote.settings[k];
    state.settingsAt = remote.settingsAt;
    changed = true;
  } else if (state.settingsAt > remote.settingsAt) push = true;

  state.savedAt = Math.max(state.savedAt || 0, remote.savedAt || 0);
  return { changed, push };
}
