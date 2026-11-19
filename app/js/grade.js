// Auto-marking of practice test answers against the book's answer key, and band conversion.
// Keys use IELTS notation: "/" = alternatives, "(x)" = optional words, "(-)" = optional hyphen.
// Marking is deliberately lenient-but-flagged: exact matches are "ok"; answers whose words all
// appear in the key are "check" (counted as correct, shown in amber so you can confirm).

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’‘`]/g, "'").replace(/£/g, '');
const squash = (s) => strip(s).replace(/[^a-z0-9]/g, '');
const words = (s) => strip(s).replace(/\([^)]*\)/g, (m) => m.slice(1, -1)).split(/[^a-z0-9.,']+/).filter(Boolean)
  .map((w) => w.replace(/[.,']+$/, ''));

const ABBR = { t: 'true', f: 'false', ng: 'not given', y: 'yes', n: 'no', notgiven: 'not given' };

/** All acceptable squashed spellings of a key string. */
export function variants(key) {
  const out = new Set();
  const alts = key.split('/').map((s) => s.trim()).filter(Boolean);
  const add = (s) => {
    // optional parenthesised parts: with and without
    const parts = s.split(/(\([^)]*\))/);
    let acc = [''];
    for (const p of parts) {
      if (/^\(.*\)$/.test(p)) {
        const inner = p.slice(1, -1);
        acc = acc.flatMap((a) => [a, a + ' ' + inner]);
      } else acc = acc.map((a) => a + p);
    }
    acc.forEach((a) => out.add(squash(a)));
  };
  alts.forEach(add);
  add(key);
  // word-level alternatives: "taking/take photos/photographs"
  const toks = key.split(/\s+/);
  if (toks.some((t) => t.includes('/')) && toks.length <= 6) {
    let acc = [''];
    for (const t of toks) {
      const opts = t.split('/').filter(Boolean);
      acc = acc.flatMap((a) => opts.map((o) => a + ' ' + o)).slice(0, 200);
    }
    acc.forEach(add);
  }
  out.delete('');
  return out;
}

/** mark one answer: returns 'ok' | 'check' | 'bad' | 'blank' */
export function markOne(user, key) {
  if (!user || !user.trim()) return 'blank';
  if (!key) return 'check';
  let u = strip(user).trim();
  if (ABBR[u.replace(/\s|\./g, '')] && /^(true|false|not given|yes|no)$/i.test(key.trim())) u = ABBR[u.replace(/\s|\./g, '')];
  const us = squash(u);
  if (!us) return 'blank';
  // single-letter / roman numeral answers must match exactly
  if (/^([a-z]|[ivx]+|true|false|not given|yes|no)$/i.test(key.trim())) return us === squash(key) ? 'ok' : 'bad';
  if (variants(key).has(us)) return 'ok';
  const kw = new Set([...words(key), ...words(key.replace(/\([^)]*\)/g, ' '))]);
  const uw = words(u);
  if (uw.length && uw.every((w) => kw.has(w))) return 'check';
  // tolerate a single typo in longer single-word answers
  if (us.length >= 6) for (const v of variants(key)) if (Math.abs(v.length - us.length) <= 1 && lev(v, us) <= 1) return 'check';
  return 'bad';
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Mark a whole part. key: {q: string | {a, group:[q..]}}, answers: {q: string}
 * Returns { rows: [{q, user, key, mark}], score }
 */
export function markPart(key, answers, qs = [1, 40]) {
  const rows = [];
  const doneGroups = new Set();
  for (let q = qs[0]; q <= qs[1]; q++) {
    const k = key[q];
    if (k && typeof k === 'object' && k.group) {
      const gid = k.group.join('&');
      if (doneGroups.has(gid)) continue;
      doneGroups.add(gid);
      // "in either order": each distinct correct letter/word scores once
      const pool = k.a.split(/[\s,;/]+|\band\b/).map((s) => squash(s)).filter(Boolean);
      const used = new Set();
      for (const gq of k.group) {
        const u = answers[gq] || '';
        const us = squash(u);
        let mark = 'blank';
        if (us) {
          const hit = pool.find((p) => p === us && !used.has(p));
          if (hit) { used.add(hit); mark = 'ok'; } else mark = 'bad';
        }
        rows.push({ q: gq, user: u, key: k.a + ' (either order)', mark });
      }
      continue;
    }
    rows.push({ q, user: answers[q] || '', key: k ?? '', mark: markOne(answers[q] || '', k ?? '') });
  }
  rows.sort((a, b) => a.q - b.q);
  return rows;
}
export const scoreOf = (rows, overrides = {}) =>
  rows.reduce((n, r) => n + (isRight(r, overrides) ? 1 : 0), 0);
export const isRight = (r, ov = {}) => (r.q in ov ? ov[r.q] : r.mark === 'ok' || r.mark === 'check');

// Raw score (/40) -> band. Standard published conversion tables (approximate; they vary slightly per test).
const L_TABLE = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]];
const RA_TABLE = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]];
const RG_TABLE = [[40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6], [27, 5.5], [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5], [3, 2], [1, 1]];
export function band(part, raw, kind = 'academic') {
  const table = part === 'listening' ? L_TABLE : kind === 'gt' ? RG_TABLE : RA_TABLE;
  for (const [min, b] of table) if (raw >= min) return b;
  return 0;
}
/** IELTS overall: mean of the four, rounded to nearest half band (.25 rounds up to .5, .75 up to next whole). */
export function overall(bands) {
  const v = bands.filter((b) => b != null);
  if (v.length < 4) return null;
  return roundHalf(v.reduce((a, b) => a + b, 0) / 4);
}
function roundHalf(m) {
  const f = m - Math.floor(m);
  if (f < 0.25) return Math.floor(m);
  if (f < 0.75) return Math.floor(m) + 0.5;
  return Math.floor(m) + 1;
}
export const bandFmt = (b) => (b == null ? '–' : Number.isInteger(b) ? b + '.0' : String(b));

export const CRITERIA = {
  writing: ['Task Achievement / Response', 'Coherence & Cohesion', 'Lexical Resource', 'Grammatical Range & Accuracy'],
  speaking: ['Fluency & Coherence', 'Lexical Resource', 'Grammatical Range & Accuracy', 'Pronunciation'],
};
export function criteriaBand(vals) {
  const v = vals.filter((x) => x != null && x !== '').map(Number);
  if (v.length < 4) return null;
  return roundHalf(v.reduce((a, b) => a + b, 0) / 4);
}
