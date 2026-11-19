// Opens every screen of the Study Suite and the Test Centre (desktop and phone width) in headless Chrome
// and fails on a script error, a failed request, an emoji left in the page, or a page that stays empty.
// No packages needed: Chrome is driven over its DevTools protocol with Node's own WebSocket.
//
//   IELTS_PROGRESS=/tmp/p python3 app/serve.py 8790 --no-browser &      # a server with throw-away progress
//   node app/tests/smoke.mjs http://localhost:8790 [screenshot-folder]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:8790').replace(/\/$/, '');
const SHOTS = process.argv[3] || '';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{23F1}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2300}-\u{23FF}]/u;
const ARROWS_OK = /[→←]/gu;              // arrows in running text ("3 days → 2 a week") are typography, not icons

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chrome() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = mkdtempSync(join(tmpdir(), 'ielts-smoke-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const t = (await r.json()).find((x) => x.type === 'page'); if (t) return { proc, ws: t.webSocketDebuggerUrl }; } catch {}
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const wait = new Map(), handlers = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { const [ok, no] = wait.get(d.id); wait.delete(d.id); d.error ? no(new Error(d.error.message)) : ok(d.result); }
    else handlers.forEach((h) => h(d));
  };
  return new Promise((res) => ws.onopen = () => res({
    send: (method, params = {}) => new Promise((ok, no) => { wait.set(++id, [ok, no]); ws.send(JSON.stringify({ id, method, params })); }),
    on: (h) => handlers.push(h),
    close: () => ws.close(),
  }));
}

const DESKTOP = [
  '/', '/#/cbt', '/#/cbt/learn', '/#/learn', '/#/tests', '/#/audio', '/#/vocab', '/#/mistakes', '/#/notes', '/#/search', '/#/settings',
  '/cbt/', '/cbt/#/tests', '/cbt/#/t/11-1', '/cbt/#/learn', '/cbt/#/learn/task-2-essays', '/cbt/#/learn/task-2-essays/skeleton-opinion-agree-disagree',
  '/cbt/#/learn/p-task-1-academic', '/cbt/#/learn/speaking-part-2', '/cbt/#/progress', '/cbt/#/mistakes', '/cbt/#/settings',
];
const PHONE = ['/cbt/m.html', '/cbt/m.html#/tests', '/cbt/m.html#/learn', '/cbt/m.html#/learn/task-2-topic-bank',
  '/cbt/m.html#/learn/speaking-part-1', '/cbt/m.html#/progress', '/cbt/m.html#/more'];

async function main() {
  const { proc, ws } = await chrome();
  const c = await client(ws);
  const problems = [];
  let current = '';
  c.on((d) => {
    if (d.method === 'Runtime.exceptionThrown') problems.push(`${current}: script error: ${d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text}`);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push(`${current}: console.error: ${d.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (d.method === 'Network.loadingFailed' && !d.params.canceled && !/net::ERR_ABORTED/.test(d.params.errorText)) problems.push(`${current}: request failed: ${d.params.errorText}`);
    if (d.method === 'Network.responseReceived' && d.params.response.status >= 400 && !/\/api\//.test(d.params.response.url)) problems.push(`${current}: ${d.params.response.status} ${d.params.response.url}`);
  });
  await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Page.enable');
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const visit = async (path, width, height, mobile) => {
    current = `${path} @${width}`;
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await c.send('Page.navigate', { url: 'about:blank' });
    await sleep(100);
    await c.send('Page.navigate', { url: BASE + path });
    await sleep(1800);
    const { result } = await c.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const inner = document.querySelector('#cbt-frame')?.contentDocument;   // Test Centre shown inside the suite
      const root = inner?.querySelector('#app') || document.querySelector('#app, #view') || document.body;
      const text = document.body.innerText;
      const wide = [...document.querySelectorAll('body *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.x-body, table, .l-dl, pre, .m-tabs, [style*=overflow], .card'));
      return { text, empty: root.innerText.trim().length < 20, scrollX: document.documentElement.scrollWidth > innerWidth + 1, wide };
    })()` });
    const v = result.value;
    if (v.empty) problems.push(`${current}: page is empty`);
    const leftover = v.text.replace(ARROWS_OK, '').match(EMOJI);
    if (leftover) problems.push(`${current}: emoji/symbol left in the page: "${leftover[0]}" (U+${leftover[0].codePointAt(0).toString(16)})`);
    if (v.scrollX) problems.push(`${current}: page scrolls sideways`);
    if (SHOTS) {
      const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, `${width}-${path.replace('#', 'H').replace(/[^\w]+/g, '_') || 'root'}.png`), Buffer.from(data, 'base64'));
    }
  };

  // warm up (the first page after start can report "not ready")
  await visit('/cbt/', 1280, 860, false); problems.length = 0;
  for (const p of DESKTOP) await visit(p, 1280, 860, false);
  for (const p of PHONE) await visit(p, 390, 844, true);
  for (const p of ['/cbt/#/learn', '/cbt/#/learn/task-2-essays/sample-opinion-free-university']) await visit(p, 1280, 860, false);

  // interactions on the Learn pages: practise mode hides phrases, a click shows one, "learnt" is kept
  current = 'learn interactions';
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: BASE + '/cbt/#/learn/task-2-essays/sample-opinion-free-university' });
  await sleep(1500);
  const step = async (js) => (await c.send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })).result.value;
  const r1 = await step(`(async () => {
    const q = (s) => document.querySelector(s);
    q('[data-mode="practise"]').click(); await new Promise((r) => setTimeout(r, 50));
    const k = q('.l-body.practise .k'); const hidden = getComputedStyle(k).fontSize === '0px';
    k.click(); const shown = getComputedStyle(k).fontSize !== '0px';
    // progress synced from an earlier run may have it learnt already: unmark first (that stays on the page)
    if (q('[data-act="learnt"]').textContent.trim() === 'Learnt') { q('[data-act="learnt"]').click(); await new Promise((r) => setTimeout(r, 50)); }
    q('[data-act="learnt"]').click(); await new Promise((r) => setTimeout(r, 400));
    const s = JSON.parse(localStorage.getItem('ielts-cbt.v1'));
    return { hidden, shown, learnt: !!s.learnt['task-2-essays/sample-opinion-free-university']?.on, moved: location.hash };
  })()`);
  if (!r1.hidden || !r1.shown) problems.push(`practise mode: hidden=${r1.hidden} shown-after-click=${r1.shown}`);
  if (!r1.learnt) problems.push('"Mark as learnt" was not saved');
  if (!/skeleton-discuss-both-views/.test(r1.moved)) problems.push(`after "Mark as learnt" expected the next page, got ${r1.moved}`);

  await c.send('Page.navigate', { url: BASE + '/cbt/#/learn/p-task-1-academic' });
  await sleep(1500);
  const r2 = await step(`(async () => {
    const q = (s) => document.querySelector(s);
    const before = q('.l-flash small').textContent;
    q('[data-act="show"]').click(); const back = !!q('.l-back');
    q('[data-act="knew"]').click(); await new Promise((r) => setTimeout(r, 50));
    return { before, after: q('.l-flash small').textContent, back, hiddenAgain: !q('.l-back') };
  })()`);
  if (!r2.back || !r2.hiddenAgain || r2.before === r2.after) problems.push(`flash cards: ${JSON.stringify(r2)}`);

  c.close(); proc.kill();
  if (problems.length) { console.error(problems.map((p) => '✗ ' + p).join('\n')); process.exit(1); }
  console.log(`ok: ${DESKTOP.length + PHONE.length} screens, Learn interactions`);
}
main().catch((e) => { console.error(e); process.exit(1); });
