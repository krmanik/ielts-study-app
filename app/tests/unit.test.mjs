// node --test app/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT, normalize, mergeState } from '../cbt/js/merge.js';
import { ICONS, icon } from '../cbt/js/icons.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('learnt marks: the later change wins on each item, both ways', () => {
  const mac = normalize(DEFAULT()), phone = normalize(DEFAULT());
  mac.savedAt = phone.savedAt = 1;
  mac.learnt = { a: { on: true, at: 10 }, b: { on: true, at: 10 } };
  phone.learnt = { a: { on: false, at: 20 }, c: { on: true, at: 5 } };
  const r = mergeState(mac, structuredClone(phone));
  assert.deepEqual(mac.learnt, { a: { on: false, at: 20 }, b: { on: true, at: 10 }, c: { on: true, at: 5 } });
  assert.equal(r.changed, true);
  assert.equal(r.push, true, 'b exists only on the Mac, so the Mac must push');
  const again = mergeState(mac, structuredClone(mac));
  assert.equal(again.changed, false);
  assert.equal(again.push, false);
});

test('an old progress file without learnt marks still loads and merges', () => {
  const old = { attempts: {}, settings: { target: 7 }, savedAt: 5 };
  const s = normalize(old);
  assert.deepEqual(s.learnt, {});
  const mine = normalize(DEFAULT()); mine.savedAt = 9; mine.learnt = { x: { on: true, at: 3 } };
  const r = mergeState(mine, { attempts: {}, settings: {}, savedAt: 5 });
  assert.equal(mine.learnt.x.on, true);
  assert.equal(r.push, true);
});

test('icon() gives an inline SVG and refuses unknown names', () => {
  const s = icon('check', 'big');
  assert.match(s, /^<svg class="i big" viewBox="0 0 24 24"[^>]*aria-hidden="true">.*<\/svg>$/);
  assert.throws(() => icon('no-such-icon'));
});

test('every icon the code asks for exists', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}${e.name}/`);
      else if (e.name.endsWith('.js') || e.name.endsWith('.html')) files.push(`${dir}${e.name}`);
    }
  };
  walk('js/'); walk('cbt/js/'); files.push('index.html');
  const names = new Set();
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/icon\(\s*'([\w-]+)'/g)) names.add(m[1]);
    for (const m of src.matchAll(/icon\([^)]*?\?\s*'([\w-]+)'\s*:\s*'([\w-]+)'/g)) { names.add(m[1]); names.add(m[2]); }
    for (const m of src.matchAll(/data-icon="([\w-]+)"/g)) names.add(m[1]);
  }
  for (const [, v] of read('cbt/js/m/main.js').matchAll(/\w+: '([\w-]+)'/g)) names.add(v);
  for (const [, v] of read('cbt/js/views/learn.js').matchAll(/[WS]: '([\w-]+)'/g)) names.add(v);
  const missing = [...names].filter((n) => !ICONS[n] && !/^(Writing|Speaking)$/.test(n));
  assert.deepEqual(missing, []);
  assert.ok(names.size > 30, `found only ${names.size} icon names — has the pattern changed?`);
});

test('no emoji or symbol icons left in the app code', () => {
  const bad = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{23F1}\u{25A0}-\u{25FF}\u{2300}-\u{23FF}]/u;
  const files = ['index.html', 'cbt/index.html', 'cbt/m.html', 'css/app.css', 'cbt/css/cbt.css', 'cbt/css/m.css'];
  const walk = (dir) => { for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) e.isDirectory() ? walk(`${dir}${e.name}/`) : e.name.endsWith('.js') && files.push(`${dir}${e.name}`); };
  walk('js/'); walk('cbt/js/');
  const hits = [];
  for (const f of files) read(f).split('\n').forEach((ln, i) => {
    if (bad.test(ln) && !/^\s*(\/\/|\*|\/\*)/.test(ln) && !/kbd>|<kbd/.test(ln)) hits.push(`${f}:${i + 1}: ${ln.trim().slice(0, 80)}`);
  });
  assert.deepEqual(hits, []);
});

test('learn.json: every section and item has what the Learn pages need', () => {
  const doc = JSON.parse(read('cbt/data/learn.json'));
  assert.ok(doc.groups.length >= 2);
  const ids = new Set();
  let items = 0;
  for (const g of doc.groups) for (const s of g.sections) {
    assert.ok(['model', 'cards'].includes(s.kind), s.id);
    assert.ok(['W', 'S'].includes(s.skill), s.id);
    assert.ok(s.items.length, `${s.id} is empty`);
    for (const it of s.items) {
      const k = `${s.id}/${it.id}`;
      assert.ok(!ids.has(k), `duplicate id ${k}`); ids.add(k);
      assert.match(it.id, /^[a-z0-9-]+$/);
      if (s.kind === 'model') { assert.ok(it.title && it.html, k); assert.equal((it.html.match(/class="k"/g) || []).length, it.chunks, k); }
      else assert.ok(it.front && it.back, k);
      items++;
    }
  }
  assert.ok(items > 250, `only ${items} items`);
  // the views route on these ids (app/tests/smoke.mjs uses some of them)
  for (const id of ['task-2-essays', 'speaking-part-2', 'p-task-1-academic']) assert.ok(doc.groups.some((g) => g.sections.some((s) => s.id === id)), id);
});
