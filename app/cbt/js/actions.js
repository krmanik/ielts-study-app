// Starting tests and summarising progress — shared by several views.
import { newAttempt, newMock, getMock, finishedAttempts, openAttempts, S, settings } from './store.js';
import { allTests } from './data.js';
import { overall } from './mark.js';
import { dayKey } from './util.js';

export const LIMITS = { R: { 1: 1200, 2: 1200, 3: 1200 }, W: { 1: 1200, 2: 2400 } };

/** Reading time limits to choose from, in minutes for the full test. 60 is the real exam; less trains reading speed. */
export const READING_MINUTES = [60, 50, 40];
/** Seconds for `nParts` passages when the full test is given `minutes`. */
export const readingLimit = (minutes, nParts) => Math.round((minutes * 60) / 3) * nParts;

export function startTest(test, skill, parts, mode, mock = null) {
  let limit = 0;
  // a mock test is always the real 60 minutes
  if (skill === 'R') limit = readingLimit(mock ? 60 : settings().readingMinutes || 60, parts.length);
  if (skill === 'W') limit = parts.length === 2 ? 3600 : parts[0] === 1 ? 1200 : 2400;
  const a = newAttempt({ test, skill, parts, mode, mock, limit });
  location.hash = `#/x/${a.id}`;
  return a;
}

export const FULL = { L: [1, 2, 3, 4], R: [1, 2, 3], W: [1, 2], S: [1, 2, 3] };

export function startMock(test) {
  const m = newMock(test, ['L', 'R', 'W']);
  startTest(test, 'L', FULL.L, 'exam', m.id);
}

/** The next skill of a mock test still to do, or null. */
export function mockNext(mockId) {
  const m = getMock(mockId);
  if (!m) return null;
  return m.seq.find((s) => !m.ids[s]) || null;
}
export function continueMock(mockId) {
  const m = getMock(mockId);
  const s = mockNext(mockId);
  if (s) startTest(m.test, s, FULL[s], 'exam', m.id);
}

/** Band for an attempt: L/R from the key, W/S from self-assessment. */
export function attemptBand(a) {
  if (!a?.finished) return null;
  if (a.skill === 'L' || a.skill === 'R') return a.result?.band ?? null;
  return a.self?.band ?? null;
}
export const isFull = (a) => a.parts.length === FULL[a.skill].length;

/** Latest band per skill (prefers full tests; part practice is scaled and less reliable). */
export function latestBands() {
  const out = {};
  for (const a of finishedAttempts()) {
    const b = attemptBand(a);
    if (b == null) continue;
    const cur = out[a.skill];
    if (!cur || isFull(a) || !cur.full) out[a.skill] = { band: b, full: isFull(a), ts: a.finished, id: a.id };
  }
  const ov = overall(['L', 'R', 'W', 'S'].map((s) => out[s]?.band));
  return { ...out, overall: ov };
}

/** Per test: which skills have a finished attempt (and the latest band). */
export function testStatus(testId) {
  const st = {};
  for (const a of Object.values(S().attempts)) {
    if (a.test !== testId || !a.finished) continue;
    const prev = st[a.skill];
    if (!prev || a.finished > prev.ts) st[a.skill] = { ts: a.finished, band: attemptBand(a), full: isFull(a) };
  }
  return st;
}

/** Part number -> the latest finished attempt that covers it, for one skill of one test. */
export function partsDone(testId, skill) {
  const out = {};
  for (const a of finishedAttempts()) if (a.test === testId && a.skill === skill) for (const p of a.parts) out[p] = a;
  return out;
}
/** A section is done once every part of it is finished — in one sitting or part by part. */
export function sectionDone(testId, skill) {
  const got = partsDone(testId, skill);
  return FULL[skill].every((p) => got[p]);
}

const SECTION_MIN = { L: 30, R: 60, W: 60, S: 15 };
export const REST_DAYS = 2;   // the plan is finished this many days before the exam

/**
 * What is left before the exam, or null without an exam date. A skill of a test counts once all of
 * its parts are finished (exam or practice mode, in one sitting or one part at a time).
 * -> { exam, deadline, daysToExam, studyDays, goal, testsDone, testsLeft, left: {L,R,W,S}, sectionsLeft, sectionsGoal, minutesLeft }
 */
export function examPlan(now = new Date()) {
  const st = settings();
  if (!st.examDate) return null;
  const exam = new Date(st.examDate + 'T00:00');
  if (isNaN(exam)) return null;
  const daysToExam = Math.round((exam - new Date(dayKey(now) + 'T00:00')) / 86400000);
  const deadline = new Date(exam);
  deadline.setDate(deadline.getDate() - REST_DAYS);
  const total = allTests().length;
  const goal = Math.min(total, st.planTests || total);
  const done = { L: new Set(), R: new Set(), W: new Set(), S: new Set() };
  for (const t of allTests()) for (const s of ['L', 'R', 'W', 'S']) if (sectionDone(t.id, s)) done[s].add(t.id);
  const testsDone = allTests().filter((t) => ['L', 'R', 'W', 'S'].every((s) => done[s].has(t.id))).length;
  const left = {};
  for (const s of ['L', 'R', 'W', 'S']) left[s] = Math.max(0, goal - done[s].size);
  const sectionsLeft = left.L + left.R + left.W + left.S;
  return {
    exam, deadline, daysToExam, goal, left, sectionsLeft, sectionsGoal: goal * 4,
    studyDays: Math.max(0, daysToExam - REST_DAYS + 1),   // today up to and including the deadline
    testsDone: Math.min(goal, testsDone), testsLeft: Math.max(0, goal - testsDone),
    minutesLeft: ['L', 'R', 'W', 'S'].reduce((m, s) => m + left[s] * SECTION_MIN[s], 0),
  };
}

export function suggestion() {
  const open = openAttempts()[0];
  if (open) return { kind: 'continue', attempt: open };
  for (const t of allTests()) {
    const st = testStatus(t.id);
    for (const s of ['L', 'R', 'W', 'S']) if (!st[s]) return { kind: 'next', test: t, skill: s };
  }
  return null;
}
