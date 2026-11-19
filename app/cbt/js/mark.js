// Marking, band conversion and question-type labels.

/** Must match norm() in tools/build.py. */
export function norm(s) {
  s = String(s || '').toLowerCase().replace(/[’‘]/g, "'");
  s = s.replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d):(\d)/g, '$1.$2').replace(/[-–—]/g, ' ');
  s = s.replace(/^[\s.,;:!?"']+|[\s.,;:!?"']+$/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Returns { right: {q: bool}, score, total } for the questions in `qs`. */
export function markAnswers(key, answers, qs) {
  const right = {};
  const usedSets = new Map();
  for (const q of qs) {
    const k = key[q];
    if (!k) continue;
    const a = norm(answers[q]);
    if (k.set) {
      // "either order" pair: each box earns a mark if it holds one of the set's values, no double counting
      const id = k.set.join('&');
      if (!usedSets.has(id)) usedSets.set(id, new Set());
      const used = usedSets.get(id);
      const ok = !!a && k.vals.includes(a) && !used.has(a);
      if (ok) used.add(a);
      right[q] = ok;
    } else {
      right[q] = !!a && k.a.includes(a);
    }
  }
  const score = Object.values(right).filter(Boolean).length;
  return { right, score, total: qs.length };
}

const L_BANDS = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]];
const R_BANDS = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]];

/** Band for a raw score out of 40 (Academic). For part practice the score is scaled to 40 first. */
export function band(skill, score, total = 40) {
  const s = total === 40 ? score : Math.round((score / total) * 40);
  const t = skill === 'L' ? L_BANDS : R_BANDS;
  for (const [min, b] of t) if (s >= min) return b;
  return 0;
}

/** The bands from 9 down to 3 with the raw scores (out of 40) that earn them: [{ band, lo, hi }]. */
export function bandRanges(skill) {
  const t = skill === 'L' ? L_BANDS : R_BANDS;
  return t.filter(([, b]) => b >= 3).map(([lo, b], i) => ({ band: b, lo, hi: i ? t[i - 1][0] - 1 : 40 }));
}

export function overall(bands) {
  const v = bands.filter((b) => typeof b === 'number');
  if (v.length < 4) return null;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.floor(avg * 2 + 0.5) / 2; // .25 rounds up to .5, .75 rounds up to next band
}

export const TYPE_LABEL = {
  text: 'Completion (notes, form, sentence, summary)',
  fig: 'Map / plan / diagram / table / flow-chart',
  mcq: 'Multiple choice',
  multi: 'Multiple choice — choose two/three',
  match: 'Matching (features, information, endings)',
  roman: 'Matching headings',
  tfng: 'True / False / Not Given',
  ynng: 'Yes / No / Not Given',
};
export const typeOf = (g) => (g.fig || g.table ? 'fig' : g.kind);

export const fmtBand = (b) => (b == null ? '–' : Number(b).toFixed(1).replace(/\.0$/, '.0'));
