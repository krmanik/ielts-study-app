// Progress kept in step through GitHub, for when the app is opened from GitHub Pages and there is no
// serve.py for it to talk to. Every device reads and writes one file, `test-centre.json` on the branch
// `progress-sync` of your repository, and folds the others' changes in with merge.js. GitHub refuses a
// write that was not based on the file's latest version; the writer then reads, merges and writes again,
// so no device overwrites another.
//
// Two ways of reaching that file:
//  - on the Mac (opened through serve.py): the server does it with git and the login git already has —
//    nothing to set up (serve.py, GITSYNC);
//  - anywhere else (the phone, a browser on GitHub Pages): the GitHub API with a fine-grained personal
//    access token limited to the repository, "Contents: Read and write". The token is kept in this
//    browser only (localStorage) and sent to api.github.com and nowhere else.
//
// Both ways give { read() -> { sha, doc }, write(doc, sha, message) -> { sha } | { conflict: true } } and
// throw an Error to show, with `quiet` set when it is only that there is no connection.
const KEY = 'ielts-cbt.github';
const API = 'https://api.github.com';
const BRANCH = 'progress-sync', PATH = 'test-centre.json';
const ROUTINE = 5 * 60e3;      // every write is a commit: routine saves are spaced out, results go at once

export function githubConfig() {
  try { const c = JSON.parse(localStorage.getItem(KEY)); return c?.token && c?.repo ? c : null; } catch { return null; }
}

const b64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

const quiet = (text) => Object.assign(new Error(text), { quiet: true });
async function timed(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, cache: 'no-store', signal: c.signal }); } catch { throw quiet('no connection'); } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- the GitHub API, with a token
const call = (cfg, method, path, body) => timed(`${cfg.api || API}/repos/${cfg.repo}${path}`, {
  method,
  headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}, 25000);
const refused = (status) => new Error(status === 401 ? 'GitHub no longer accepts the token' : status === 403 ? 'The token may not write to the repository — it needs "Contents: Read and write"' : `GitHub answered ${status}`);

/** Check a token and repository ("owner/name"). Resolves with the config to keep, or throws with a reason to show. */
export async function checkGithub(token, repo, api) {
  repo = String(repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  token = String(token || '').trim();
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Give the token and the repository as owner/name');
  const cfg = { token, repo, ...(api ? { api } : {}) };
  let r;
  try { r = await call(cfg, 'GET', ''); } catch { throw new Error('GitHub could not be reached — check the connection'); }
  if (r.status === 401) throw new Error('GitHub does not accept this token');
  if (r.status === 404 || r.status === 403) throw new Error('This token cannot see that repository');
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const info = await r.json();
  if (info.permissions && !info.permissions.push) throw new Error('This token can read the repository but not write to it — it needs "Contents: Read and write"');
  return { ...cfg, base: info.default_branch || 'main' };
}

const viaToken = (cfg) => ({
  repo: cfg.repo,
  async read() {
    const r = await call(cfg, 'GET', `/contents/${PATH}?ref=${BRANCH}`);
    if (r.status === 404) return { sha: null, doc: null };
    if (!r.ok) throw refused(r.status);
    const j = await r.json();
    let text = j.content;
    if (!text) {       // over 1 MB the listing leaves the content out
      const b = await call(cfg, 'GET', `/git/blobs/${j.sha}`);
      if (!b.ok) throw refused(b.status);
      text = (await b.json()).content;
    }
    return { sha: j.sha, doc: JSON.parse(unb64(text)) };
  },
  async write(doc, sha, message) {
    for (let first = true; ; first = false) {
      const r = await call(cfg, 'PUT', `/contents/${PATH}`, { message, content: b64(JSON.stringify(doc)), branch: BRANCH, ...(sha ? { sha } : {}) });
      if (r.ok) return { sha: (await r.json()).content.sha };
      if (r.status === 409 || r.status === 422) return { conflict: true };       // someone else wrote first
      if (r.status === 404 && !sha && first) {      // the branch is not there yet: start it from the main one
        const ref = await call(cfg, 'GET', `/git/ref/heads/${cfg.base || 'main'}`);
        if (!ref.ok) throw new Error(`Could not read the branch ${cfg.base || 'main'} (${ref.status})`);
        const made = await call(cfg, 'POST', '/git/refs', { ref: `refs/heads/${BRANCH}`, sha: (await ref.json()).object.sha });
        if (!made.ok && made.status !== 422) throw refused(made.status);
        continue;
      }
      throw refused(r.status);
    }
  },
});

// ---------------------------------------------------------------- serve.py on the Mac, with git
const viaServer = () => {
  const fail = async (r) => { const j = await r.json().catch(() => ({})); return j.quiet ? quiet(j.error) : new Error(j.error || `The Mac could not reach GitHub (${r.status})`); };
  const t = {
    repo: '',
    async read() {
      const r = await timed('/api/gitsync', {}, 100000);
      if (!r.ok) throw await fail(r);
      const j = await r.json();
      t.repo = j.repo || '';
      return { sha: j.sha, doc: j.doc };
    },
    async write(doc, sha, message) {
      const r = await timed('/api/gitsync', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Base': sha || '', 'X-Commit-Message': encodeURIComponent(message) }, body: JSON.stringify(doc) }, 100000);
      if (r.status === 409) return { conflict: true };
      if (!r.ok) throw await fail(r);
      return { sha: (await r.json()).sha };
    },
  };
  return t;
};

/**
 * Same shape as makeSync() in ../../js/sync.js. `merge(remote)` folds a copy in and returns true if this
 * browser has more. `server`: this page came from serve.py on the Mac, which can reach GitHub with git.
 */
export function makeGitHubSync({ get, merge, onStatus, device = '', server = false }) {
  let cfg = githubConfig();
  let way = cfg ? viaToken(cfg) : server ? viaServer() : null;
  let sha = null, timer = null, message = null, busy = null, online = false, last = null, error = '';
  const note = (ok, err = '') => { online = ok; error = err; if (ok) last = Date.now(); onStatus?.(); };
  const failed = (e) => note(false, e.quiet ? '' : e.message);

  /** Take in the file as it is on GitHub. -> true if this browser has something it lacks (a missing file lacks everything). */
  async function read() {
    const f = await way.read();
    sha = f.sha;
    return f.doc ? merge(f.doc) : true;
  }

  async function write() {
    timer = null;
    const msg = message; message = null;
    try {
      for (let tries = 0; tries < 5; tries++) {
        const r = await way.write(get(), sha, msg || `Progress from ${device || 'a browser'}`);
        if (r.conflict) { await read(); continue; }
        sha = r.sha;
        return note(true);
      }
      throw new Error('GitHub kept refusing the save — try again in a minute');
    } catch (e) { message = message || msg; failed(e); }
  }
  const run = () => (busy = (busy || Promise.resolve()).then(write));

  return {
    async pull() {
      if (!way) return false;
      try {
        const first = !sha;
        const more = await read();
        note(true);
        if (more) this.push(first && !sha ? 'Progress, first copy' : undefined);      // nothing there yet: start it at once
        return true;
      } catch (e) { failed(e); return false; }
    },
    /** Queue a save; with a message (a finished test) it goes at once. */
    push(commitMessage) {
      if (!way) return;
      if (commitMessage) message = commitMessage;
      if (timer && !commitMessage) return;          // a routine save is already waiting
      clearTimeout(timer);
      timer = setTimeout(run, commitMessage ? 0 : ROUTINE);
    },
    flush() { if (way && timer) { clearTimeout(timer); return run(); } return busy || Promise.resolve(); },
    /** `via`: 'token' (the GitHub API), 'git' (through serve.py on the Mac) or '' (not in use). */
    status: () => ({ on: !!way, via: cfg ? 'token' : way ? 'git' : '', repo: way?.repo || '', online, last, error, pending: !!timer }),
    /** Start using (or, with null, stop using) a token and repository; see checkGithub(). */
    configure(c) {
      cfg = c; way = c ? viaToken(c) : server ? viaServer() : null;
      sha = null; online = false; error = ''; last = null;
      clearTimeout(timer); timer = null;
      if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY);
      onStatus?.();
    },
  };
}
