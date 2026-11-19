// More: where the progress is, what is kept on the device, and the few settings worth having in a pocket.
import { $, esc, toast, confirmBox, dayKey } from '../util.js';
import { settings, setSetting, exportJSON, importJSON, syncNow, onSync, syncStatus, connectGithub, disconnectGithub } from '../store.js';
import { READING_MINUTES } from '../actions.js';
import { sendRecordings } from '../rec.js';
import { offlineOK, appSaved, savedIds, allIds, usage, fmtMB, removeAll, checkUpdate, onOffline, standalone } from './offline.js';
import { syncInfo, chevron, LOCAL, STATIC } from './ui.js';

/** "owner/name" of the repository a GitHub Pages address belongs to, or ''. */
function guessRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
  const name = location.pathname.split('/')[1];
  return m && name ? `${m[1]}/${name}` : '';
}

/** Progress kept in step through GitHub: the only meeting place when the app is served as plain files. */
function githubCard() {
  const g = syncStatus().gh;
  if (g.on) {
    return `<div class="card m-stack m-gh">
      <div class="m-status ${g.error ? 'warn' : g.online ? 'good' : 'idle'}"><i></i><span><b>GitHub: ${esc(g.repo)}</b>
        <small>${g.error ? esc(g.error) : 'Progress is exchanged through the branch <code>progress-sync</code> — when the app opens, when a test is finished, and every few minutes in between.'}</small></span></div>
      <button class="btn block ghost" id="gh-off">Disconnect GitHub</button></div>`;
  }
  return `<div class="card m-stack m-gh">
    <p class="muted" style="margin:0">${STATIC ? 'To keep this device and your Mac in step, both exchange progress through your GitHub repository. The Mac does it by itself; here it takes a token, once.'
    : 'Optional: also exchange progress through your GitHub repository, for when the app is opened from GitHub Pages instead of from your Mac.'}</p>
    <label>Token<input type="password" id="gh-token" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
    <label>Repository<input type="text" id="gh-repo" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="owner/name" value="${esc(guessRepo())}"></label>
    <button class="btn primary block" id="gh-on">Connect</button>
    <details><summary>How to get a token</summary><ol>
      <li>On github.com: your picture → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
      <li>Repository access: <b>Only select repositories</b> → the repository this app is in.</li>
      <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Nothing else.</li>
      <li>Generate, copy it, paste it here. Your Mac needs no token.</li>
    </ol><small class="muted">The token stays in this browser and is sent only to api.github.com.</small></details>
  </div>`;
}

export function render(page) {
  const draw = async () => {
    // do not pull the page from under someone typing a token or choosing a date
    if (page.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
    const s = settings(), si = syncInfo(), st = syncStatus();
    const used = offlineOK ? await usage() : null;
    const viaGithub = STATIC || (st.gh.on && !st.online);
    page.innerHTML = `<header class="m-top"><h1>More</h1></header>

      <div class="m-grid two"><section>
      <h2 class="m-h">Your progress</h2>
      <div class="card m-stack">
        <div class="m-status ${si.cls}"><i></i><span><b>${esc(si.text)}</b><small>${esc(si.detail)}</small></span></div>
        ${st.needKey && !STATIC ? '<a class="btn primary block" href="pair">Enter the phone code</a>'
    : STATIC && !st.gh.on ? '' : `<button class="btn block" id="sync">${viaGithub ? 'Exchange through GitHub now' : 'Check with the Mac now'}</button>`}
        <div class="row"><button class="btn grow" id="share">Send progress as a file</button>
        <label class="btn grow">Add from a file <input type="file" id="import" accept=".json,application/json" hidden></label></div>
        <small class="muted">The file is a spare route: send it to your Mac (AirDrop, mail), then use <b>Import</b> under Settings in the Test Centre there. Nothing is overwritten — the two are merged.</small>
      </div>

      <h2 class="m-h">GitHub</h2>
      ${githubCard()}
      </section><section>
      ${LOCAL ? '' : `<h2 class="m-h">On this device</h2>
      <div class="card m-stack">${offlineOK ? `
        <div class="m-status ${appSaved() ? 'good' : 'idle'}"><i></i><span><b>${appSaved() ? 'Works with no connection' : 'Saving the app…'}</b>
          <small>The app and the text of all ${allIds().length} tests${standalone() ? '' : ' — in this browser tab. The home-screen icon keeps its own copy'}.</small></span></div>
        <a class="m-row" href="#/tests"><span class="grow"><b>Recordings and pictures</b><small>${savedIds().size} of ${allIds().length} tests saved${used ? ` · ${fmtMB(used)} used` : ''}</small></span>${chevron}</a>
        <div class="row"><button class="btn grow" id="update">Look for an app update</button>
        ${savedIds().size ? '<button class="btn grow ghost" id="wipe" style="color:var(--bad)">Remove saved tests</button>' : ''}</div>`
    : `<p class="muted" style="margin:0">This address only works while your Mac is on and in reach. To keep the tests on the device, open the <b>https</b> address shown in the window on your Mac.</p>`}
      </div>`}

      <h2 class="m-h">Settings</h2>
      <div class="card m-stack m-form">
        <label><span>Exam date</span><input type="date" id="exam" value="${s.examDate || ''}"></label>
        <label><span>Target band</span><select id="target">${[5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map((b) => `<option ${+s.target === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        <label><span>Reading time<small>60 minutes is the real exam</small></span><select id="rmin">${READING_MINUTES.map((m) => `<option value="${m}" ${(s.readingMinutes || 60) === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
        <label><span>Text size in tests</span><select id="size">${[[16, 'Standard'], [18, 'Large'], [20, 'Larger'], [22, 'Largest']].map(([v, l]) => `<option value="${v}" ${(s.textSize || 16) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label><span>Colours</span><select id="theme"><option value="auto">Match the device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      </div>

      <div class="m-list" style="margin-top:20px">
        <a class="m-row" href="#/mistakes"><span class="grow"><b>Mistakes</b><small>Every question you got wrong, by type</small></span>${chevron}</a>
      </div>
      </section></div>`;
    $('#theme', page).value = s.theme || 'auto';
  };
  const redraw = () => { document.activeElement?.blur?.(); return draw(); };
  draw();
  const offs = [onSync(draw), onOffline(draw)];

  page.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'exam') setSetting('examDate', t.value);
    if (t.id === 'target') setSetting('target', +t.value);
    if (t.id === 'rmin') setSetting('readingMinutes', +t.value);
    if (t.id === 'size') setSetting('textSize', +t.value);
    if (t.id === 'theme') setSetting('theme', t.value);
    if (t.id === 'import' && t.files[0]) {
      try { importJSON(await t.files[0].text()); toast('Added to your progress'); } catch (err) { toast(err.message, 4000); }
    }
  });
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    const id = btn?.id;
    if (id === 'sync') {
      const github = /GitHub/.test(btn.textContent);
      btn.disabled = true; btn.textContent = 'Checking…';
      const ok = await syncNow();
      if (ok) sendRecordings();
      toast(ok ? (github ? 'In step through GitHub' : 'In step with your Mac') : `${github ? 'GitHub' : 'Your Mac'} is out of reach — nothing is lost, it is all on this device`, 3500);
      redraw();
    }
    if (id === 'gh-on') {
      btn.disabled = true; btn.textContent = 'Connecting…';
      try {
        await connectGithub($('#gh-token', page).value, $('#gh-repo', page).value);
        await syncNow();
        const g = syncStatus().gh;
        if (g.error) { disconnectGithub(); throw new Error(g.error); }
        toast('Connected — progress is now exchanged through GitHub', 3500);
        redraw();
      } catch (err) { toast(err.message, 5000); btn.disabled = false; btn.textContent = 'Connect'; }
    }
    if (id === 'gh-off' && (await confirmBox('Stop exchanging progress through GitHub from this device? Your results stay here.', 'Disconnect'))) { disconnectGithub(); redraw(); }
    if (id === 'share') {
      const file = new File([exportJSON()], `ielts-progress-${dayKey()}.json`, { type: 'application/json' });
      try {
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'IELTS progress' });
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); }
      } catch { /* the share sheet was closed */ }
    }
    if (id === 'update') { await checkUpdate(true); toast('Looking… the app reloads if there is a newer version'); }
    if (id === 'wipe' && (await confirmBox('Remove the saved recordings and pictures from this device? Your results stay.', 'Remove'))) { await removeAll(); redraw(); }
  });
  return () => offs.forEach((f) => f());
}
