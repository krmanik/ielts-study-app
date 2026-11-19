import { $, toast, confirmBox, dayKey } from '../util.js';
import { settings, setSetting, exportJSON, importJSON, resetAll, syncStatus, syncNow, onSync, disconnectGithub } from '../store.js';
import { allTests } from '../data.js';
import { READING_MINUTES } from '../actions.js';
import { fsSupported } from '../fullscreen.js';

export function render(page) {
  const s = settings();
  page.innerHTML = `<h1>Settings</h1>
    <div class="card stack" style="max-width:640px">
      <label class="row"><span class="grow">Theme</span>
        <select id="theme"><option value="auto">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label class="row"><span class="grow">Target band</span>
        <select id="target">${[5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map((b) => `<option ${+s.target === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <label class="row"><span class="grow">Exam date</span><input type="date" id="exam" value="${s.examDate || ''}" min="${dayKey()}"></label>
      <label class="row"><span class="grow">Tests to finish before the exam<br><small class="muted">The home page plans them to be done 2 days before your exam date.</small></span>
        <select id="plan"><option value="0">All ${allTests().length}</option>${[2, 4, 6, 8, 12, 16, 20, 24, 32].filter((n) => n < allTests().length).map((n) => `<option value="${n}">${n} tests</option>`).join('')}</select></label>
      <label class="row"><span class="grow">Reading time limit<br><small class="muted">60 minutes is the real exam. Less time trains you to read faster.</small></span>
        <select id="rmin">${READING_MINUTES.map((m) => `<option value="${m}">${m} minutes${m === 60 ? ' (real exam)' : ''}</option>`).join('')}</select></label>
      ${fsSupported ? `<label class="row"><span class="grow">Start tests in full screen<br><small class="muted">Hides the browser tabs and toolbars. Press Esc to leave.</small></span>
        <input type="checkbox" id="fs" ${s.fullscreen ? 'checked' : ''}></label>` : ''}
      <label class="row"><span class="grow">Test text size</span><input type="range" id="size" min="13" max="24" value="${s.textSize || 16}"><span id="sizev">${s.textSize || 16}px</span></label>
    </div>
    <div class="card stack" style="max-width:640px;margin-top:16px">
      <h3 style="margin:0">Backup</h3>
      <p class="muted" style="margin:0">${syncStatus().online
    ? 'Your results are saved in this browser <b>and on disk</b> in the <code>progress</code> folder next to the app. Nothing is committed to git by itself — commit the <code>progress</code> folder yourself when you want a saved point.'
    : 'Your results are stored in this browser only — the app was not opened through <b>Start IELTS Suite.command</b>, so nothing is being saved to disk.'}</p>
      <div class="row"><button class="btn" id="export">Export results</button>
      <label class="btn">Import… <input type="file" id="import" accept=".json" hidden></label>
      <button class="btn ghost" id="reset" style="color:var(--bad)">Reset everything</button></div>
    </div>
    <div class="card stack" style="max-width:640px;margin-top:16px" id="phone" hidden></div>
    <div class="card stack" style="max-width:640px;margin-top:16px" id="github"></div>`;
  phoneCard($('#phone', page));
  const off = githubCard($('#github', page));
  $('#theme', page).value = s.theme || 'auto';
  $('#theme', page).onchange = (e) => setSetting('theme', e.target.value);
  $('#target', page).onchange = (e) => setSetting('target', +e.target.value);
  $('#exam', page).onchange = (e) => setSetting('examDate', e.target.value);
  $('#plan', page).value = String(s.planTests || 0);
  $('#plan', page).onchange = (e) => setSetting('planTests', +e.target.value);
  $('#rmin', page).value = String(s.readingMinutes || 60);
  $('#rmin', page).onchange = (e) => setSetting('readingMinutes', +e.target.value);
  if ($('#fs', page)) $('#fs', page).onchange = (e) => setSetting('fullscreen', e.target.checked);
  $('#size', page).oninput = (e) => { setSetting('textSize', +e.target.value); $('#sizev', page).textContent = e.target.value + 'px'; };
  $('#export', page).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
    a.download = `ielts-test-centre-${dayKey()}.json`;
    a.click();
  };
  $('#import', page).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { importJSON(await f.text()); toast('Added to your progress'); render(page); } catch (err) { toast(err.message); }
  };
  $('#reset', page).onclick = async () => {
    if (await confirmBox('Delete all results, answers and settings? This cannot be undone.', 'Delete everything')) { resetAll(); toast('Reset'); render(page); }
  };
  return off;
}

/** How to open the Test Centre on a phone: the address and the code, when the server was started for it. */
async function phoneCard(box) {
  let p;
  try { const r = await fetch('/api/phone'); if (!r.ok) return; p = await r.json(); } catch { return; }
  box.hidden = false;
  box.innerHTML = `<h3 style="margin:0">On your phone</h3>` + (p.on && p.url
    ? `<p class="muted" style="margin:0">With the phone on the same Wi-Fi as this Mac, open this address and type the code. ${p.offline
      ? 'Then add it to the home screen: it keeps the tests on the phone, works with no connection and sends your results back here when the two meet again.'
      : 'No HTTPS certificate could be fetched, so the phone can use it only while this Mac is in reach.'}</p>
      <p style="margin:0;font-size:17px"><code>${p.url}</code><br>Code: <b style="letter-spacing:2px">${p.code.slice(0, 4)} ${p.code.slice(4)}</b></p>`
    : `<p class="muted" style="margin:0">To continue on your phone — same tests, same progress, usable with no connection — close this app's Terminal window and start it with <b>Start IELTS for Phone.command</b> instead. The address and the code for the phone then appear here.</p>`);
}

/**
 * Progress exchanged through GitHub (../ghsync.js): how this Mac and the app on GitHub Pages stay in step.
 * The Mac needs no token — serve.py uses git. Returns a function that stops the card from updating.
 */
function githubCard(box) {
  const draw = () => {
    const g = syncStatus().gh;
    if (!g.on) { box.hidden = true; return; }
    box.hidden = false;
    const state = g.error ? ['bad', 'problem'] : g.online ? ['good', 'in step'] : ['warn', 'not reached'];
    box.innerHTML = `<h3 style="margin:0">GitHub — progress shared with the app on GitHub Pages <span class="pill ${state[0]}">${state[1]}</span></h3>
      <p class="muted" style="margin:0">${g.error ? `<b style="color:var(--bad)">${g.error}</b><br>` : ''}
      This Mac and your phone meet on GitHub: the file <code>test-centre.json</code> on the branch <code>progress-sync</code>${g.repo ? ` of <b>${g.repo}</b>` : ''}.
      What the phone did is merged in when this page opens; what you do here goes to GitHub only when you press <b>Exchange now</b>.
      ${g.via === 'git' ? 'The Mac uses the login git already has — nothing to set up here. On the phone: <b>More → GitHub</b>, paste a token once.' : ''}</p>
      <div class="row"><button class="btn" id="gh-now">Exchange now</button>${g.via === 'token' ? '<button class="btn ghost" id="gh-off">Disconnect</button>' : ''}
      <span class="muted" style="font-size:13px">${g.last ? 'last exchanged ' + new Date(g.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>`;
  };
  draw();
  box.onclick = async (e) => {
    const b = e.target.closest('button');
    if (b?.id === 'gh-now') { b.disabled = true; b.textContent = 'Exchanging…'; await syncNow(); toast(syncStatus().gh.error || (syncStatus().gh.online ? 'Exchanged with GitHub' : 'GitHub is out of reach — try again later')); }
    if (b?.id === 'gh-off') disconnectGithub();
    draw();
  };
  return onSync(draw);
}
