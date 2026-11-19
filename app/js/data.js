// Loads data/book.json (built by tools/build_data.py) and derives lookup tables.
import { settings } from './store.js';

export let BOOK = null;
export const MOD = {
  start: { title: 'Start here', color: 'var(--accent)', icon: 'star' },
  listening: { title: 'Listening', color: 'var(--listening)', icon: 'headphones' },
  reading: { title: 'Reading', color: 'var(--reading)', icon: '¶' },
  writing: { title: 'Writing', color: 'var(--writing)', icon: 'pen-line' },
  speaking: { title: 'Speaking', color: 'var(--speaking)', icon: 'mic' },
};
export const SECTIONS = [];      // ordered study path items
export const UNITS = [];         // { id, module, n, title, sections[], only }
export const byId = {};
export const TRACK = {};         // n -> track
export const pageTracks = {};    // page -> [{ n, x, y }]
export const TEST = {};          // id -> test

export async function loadData() {
  BOOK = await (await fetch('data/book.json')).json();
  for (const t of BOOK.tracks) {
    TRACK[t.n] = t;
    for (const r of t.refs || []) {
      if (t.group === 'tests') continue; // test tracks have no badge on the page
      (pageTracks[r.page] ||= []).push({ n: t.n, x: r.x, y: r.y });
    }
  }
  const startUnit = {
    id: 'start-0', module: 'start', n: 0, title: 'Before you begin', only: null, sections: [
      { id: 'start-intro', title: 'Introduction to this book', start: 5, end: 6 },
      { id: 'start-summary', title: 'IELTS summary — the test at a glance', start: 7, end: 12 },
    ],
  };
  addUnit(startUnit);
  for (const m of BOOK.modules) {
    addUnit({
      id: `${m.id}-0`, module: m.id, n: 0, title: `About the ${m.title} test`, only: null,
      sections: [{ id: `${m.id}-intro`, title: `How ${m.title} is tested`, start: m.intro[0], end: m.intro[1] }],
    });
    for (const u of m.units) {
      addUnit({
        id: u.id, module: m.id, n: u.n, title: u.title, only: u.only, key: u.key, script: u.script,
        sections: u.sections.map((s) => ({ ...s })),
      });
    }
  }
  for (const t of BOOK.tests) TEST[t.id] = t;
  return BOOK;
}

function addUnit(u) {
  UNITS.push(u);
  byId[u.id] = u;
  u.sections.forEach((s, i) => {
    Object.assign(s, { module: u.module, unit: u.id, unitN: u.n, unitTitle: u.title, only: u.only, idx: i });
    s.tracks = [];
    for (let p = s.start; p <= s.end; p++) {
      for (const t of pageTracks[p] || []) {
        // shared start/end pages: keep only badges inside this section's vertical span
        if (p === s.start && s.y != null && t.y < s.y - 0.02 && s.start !== s.end) continue;
        if (!s.tracks.includes(t.n)) s.tracks.push(t.n);
      }
    }
    SECTIONS.push(s);
    byId[s.id] = s;
  });
}

export const label = (p) => BOOK.labels[p];
export const pages = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Is this unit/section relevant for the chosen module (Academic / General Training / both)? */
export function relevant(x) {
  const m = settings().module;
  return !x.only || m === 'both' || x.only === m;
}
export const studySections = () => SECTIONS.filter(relevant);
export function unitSections(unitId) { return byId[unitId].sections; }
export function nextSection(id, dir = 1) {
  const list = studySections();
  const i = list.findIndex((s) => s.id === id);
  return list[i + dir] || null;
}
export function sectionForPage(p) {
  return SECTIONS.find((s) => s.start <= p && p <= s.end && s.module !== 'start') || null;
}
export const modColor = (m) => (MOD[m] || { color: 'var(--tests)' }).color;
export function testsInOrder() {
  // academic tests, with the two General Training tests placed where the book prints them
  const out = [];
  for (const t of BOOK.tests.filter((t) => t.kind === 'academic')) {
    out.push(t);
    for (const g of BOOK.tests.filter((g) => g.kind === 'gt' && g.after === t.n)) out.push(g);
  }
  return out;
}
