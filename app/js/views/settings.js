import { $, toast, confirmBox, dayKey } from '../util.js';
import { settings, setSetting, exportJSON, importJSON, resetAll } from '../store.js';
import { setChrome } from '../chrome.js';

export function render(view) {
  setChrome({ crumbs: '<b>Settings</b>' });
  const s = settings();
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="grid g2">
      <div class="card">
        <h2>Your exam</h2>
        <label class="field"><span>Which IELTS module?</span>
          <select name="module">
            <option value="ac" ${s.module === 'ac' ? 'selected' : ''}>Academic</option>
            <option value="gt" ${s.module === 'gt' ? 'selected' : ''}>General Training</option>
            <option value="both" ${s.module === 'both' ? 'selected' : ''}>Show everything</option>
          </select></label>
        <label class="field"><span>Exam date</span><input type="date" name="examDate" value="${s.examDate || ''}" min="${dayKey()}"></label>
        <label class="field"><span>Target band</span>
          <select name="targetBand">${[5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map((b) => `<option ${Number(s.targetBand) === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        <label class="field"><span>Daily study goal (minutes)</span><input type="number" name="dailyGoal" min="5" max="600" step="5" value="${s.dailyGoal}"></label>
      </div>
      <div class="card">
        <h2>Display</h2>
        <label class="field"><span>Theme</span>
          <select name="theme">
            <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Match system</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select></label>
        <label class="row field" style="gap:8px"><input type="checkbox" name="darkPages" ${s.darkPages ? 'checked' : ''}> Dim book pages in dark theme</label>
        <label class="row field" style="gap:8px"><input type="checkbox" name="strictAudio" ${s.strictAudio ? 'checked' : ''}> Real-exam audio in timed Listening (plays once, no pausing)</label>
        <label class="field"><span>Page width: <b id="zv">${s.zoom}px</b></span><input type="range" name="zoom" min="520" max="1500" step="20" value="${s.zoom}" style="width:100%"></label>
      </div>
      <div class="card">
        <h2>Backup</h2>
        <p class="muted">Progress is stored in this browser only. Export a backup now and then, or to move to another computer. (Speaking recordings are not included.)</p>
        <div class="row">
          <button class="btn" id="exp">Export progress</button>
          <label class="btn">Import backup<input type="file" id="imp" accept="application/json" hidden></label>
          <button class="btn ghost" id="reset" style="color:var(--bad)">Reset everything</button>
        </div>
      </div>
      <div class="card">
        <h2>Keyboard shortcuts</h2>
        <table class="t"><tbody>
          <tr><td><kbd>Space</kbd></td><td>Play / pause audio</td></tr>
          <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Rewind / forward 5 seconds</td></tr>
          <tr><td><kbd>J</kbd> <kbd>K</kbd></td><td>Next / previous page</td></tr>
          <tr><td><kbd>F</kbd></td><td>Focus mode (hide sidebar)</td></tr>
          <tr><td><kbd>/</kbd></td><td>Search the book</td></tr>
        </tbody></table>
      </div>
    </div>`;
  view.addEventListener('change', (e) => {
    const el = e.target; if (!el.name) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['dailyGoal', 'zoom', 'targetBand'].includes(el.name)) v = Number(v);
    setSetting(el.name, v);
    toast('Saved');
  });
  view.addEventListener('input', (e) => {
    if (e.target.name === 'zoom') { $('#zv', view).textContent = e.target.value + 'px'; setSetting('zoom', Number(e.target.value)); }
  });
  $('#exp', view).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
    a.download = `ielts-progress-${dayKey()}.json`; a.click();
  };
  $('#imp', view).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { importJSON(await f.text()); toast('Backup restored'); setTimeout(() => location.reload(), 600); } catch (err) { toast('Import failed: ' + err.message, 4000); }
  };
  $('#reset', view).onclick = async () => {
    if (await confirmBox('Erase all progress, notes, vocabulary and test attempts? This cannot be undone.', 'Erase everything')) { resetAll(); toast('Reset'); location.hash = '#/'; }
  };
}
