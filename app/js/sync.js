// Keeps a copy of an app's progress on disk through serve.py (/api/state/<name>), which commits it to git.
// localStorage stays the working copy. Shared by the Study Suite and the Test Centre.
//
// Two ways of settling differences with the copy on disk:
//  - plain (Study Suite): whichever side was saved last wins when the page loads;
//  - merging (Test Centre, used from the Mac and the phone): pass `merge(remote)`, which folds the copy on
//    disk into this browser's state and returns true when this browser has something the disk lacks.
//    Every save carries the revision it was based on; if another device saved in between, the server
//    answers 409 with its copy, which is merged before trying again. Nothing is overwritten unseen.

/** fetch() that gives up after `ms` — a Mac that is asleep or on another network must not hang the app. */
function fetchT(url, opts = {}, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

/**
 * `delay`: milliseconds a routine save waits for more changes before it is sent.
 * `off`: no server at all — every call does nothing.
 * `onStatus()`: called whenever the connection state or the time of the last save changes.
 */
export function makeSync(name, { get, adopt, merge, delay = 1500, onStatus, off = false }) {
  // served as plain files (GitHub Pages): there is no serve.py to talk to
  if (off) return { pull: async () => false, push() {}, flush: () => Promise.resolve(), status: () => ({ online: false, needKey: false, last: null, pending: false, off: true }) };
  const url = `/api/state/${name}`;
  let timer = null, message = null, online = true, needKey = false, last = null, rev = 0, busy = null;
  const note = (r) => {
    online = !!r?.ok;
    needKey = r?.status === 401;      // the server wants the phone code first (see serve.py, PAIR)
    if (r?.ok) last = Date.now();
    onStatus?.();
  };

  async function send(unloading = false) {
    timer = null;
    const msg = message; message = null;
    try {
      for (let tries = 0; tries < 4; tries++) {
        const body = JSON.stringify(get());
        const r = await fetchT(url, {
          method: 'PUT',
          // keepalive lets the request outlive the page, but browsers cap such bodies at 64 KB
          keepalive: unloading && body.length < 60000,
          headers: { 'Content-Type': 'application/json', ...(merge ? { 'X-Rev': String(rev) } : {}), ...(msg ? { 'X-Commit-Message': encodeURIComponent(msg) } : {}) },
          body,
        }, 20000);
        if (merge && r.status === 409) {        // someone else saved first: take their changes in, then send again
          const theirs = await r.json();
          rev = theirs.rev || 0;
          merge(theirs);
          continue;
        }
        if (r.ok && merge) rev = (await r.json()).rev ?? rev;
        note(r);
        if (!r.ok) message = message || msg;
        return;
      }
    } catch {
      note(null);
      message = message || msg;       // keep the commit message for the next attempt
    }
  }
  // one request at a time, so a revision is never used twice
  const run = (unloading) => (busy = (busy || Promise.resolve()).then(() => send(unloading)));

  return {
    /** Fetch the copy on disk and settle differences. Resolves true if the server answered. */
    async pull() {
      let remote = null, r = null;
      try {
        r = await fetchT(url, { cache: 'no-store' });
        if (r.ok) remote = await r.json();
      } catch { r = null; }
      note(r);
      if (!online) return false;
      if (merge) {
        rev = remote?.rev || 0;
        if (remote ? merge(remote) : true) this.push();
        return true;
      }
      const mine = get().savedAt || 0, theirs = remote?.savedAt || 0;
      if (remote && theirs > mine) adopt(remote);
      else if (mine > theirs) this.push();
      return true;
    },
    /** Queue a save. With `commitMessage` the server commits to git straight away under that message. */
    push(commitMessage) {
      if (commitMessage) message = commitMessage;
      clearTimeout(timer);
      timer = setTimeout(run, commitMessage ? 0 : delay);
    },
    /** Send what is waiting now (the page is closing, or the user asked). */
    flush(unloading = true) { if (timer) { clearTimeout(timer); return run(unloading); } return busy || Promise.resolve(); },
    status: () => ({ online, needKey, last, pending: !!timer }),
  };
}
