// The band scale shown with a Listening or Reading result: pick a band to see how many correct answers
// it takes and what the band means (the official IELTS descriptions).
import { bandRanges } from './mark.js';
import { settings } from './store.js';

const LEVEL = {
  9: ['Expert user', 'You have a full operational command of the language. Your use of English is appropriate, accurate and fluent, and you show complete understanding.'],
  8: ['Very good user', 'You have a fully operational command of the language with only occasional unsystematic inaccuracies and inappropriate usage. You may misunderstand some things in unfamiliar situations. You handle complex detailed argumentation well.'],
  7: ['Good user', 'You have an operational command of the language, though with occasional inaccuracies, inappropriate usage and misunderstandings in some situations. Generally you handle complex language well and understand detailed reasoning.'],
  6: ['Competent user', 'Generally you have an effective command of the language despite some inaccuracies, inappropriate usage and misunderstandings. You can use and understand fairly complex language, particularly in familiar situations.'],
  5: ['Modest user', 'You have a partial command of the language, and cope with overall meaning in most situations, although you are likely to make many mistakes. You should be able to handle basic communication in your own field.'],
  4: ['Limited user', 'Your basic competence is limited to familiar situations. You frequently show problems in understanding and expression. You are not able to use complex language.'],
  3: ['Extremely limited user', 'You convey and understand only general meaning in very familiar situations. There are frequent breakdowns in communication.'],
};

/**
 * Draw the guide into `el`. `result` (optional) is an attempt's { score, total, band }: its band is
 * marked "you" and opened first, and a line says how far the target band is.
 */
export function mountBandGuide(el, skill, result = null) {
  const rows = bandRanges(skill);
  const yours = result?.band ?? null;
  const target = +settings().target || null;
  let cur = rows.some((r) => r.band === yours) ? yours : rows.some((r) => r.band === target) ? target : 7;

  const draw = () => {
    const r = rows.find((x) => x.band === cur);
    const [level, desc] = LEVEL[Math.floor(cur)];
    el.innerHTML = `<div class="band-guide">
      <div class="bg-tabs" role="tablist" aria-label="Band score">
        <span class="bg-lbl">Band score</span>
        ${rows.map((x) => `<button type="button" role="tab" aria-selected="${x.band === cur}" data-band="${x.band}" class="${x.band === cur ? 'on' : ''}">${x.band}${x.band === yours ? '<small>you</small>' : x.band === target ? '<small>target</small>' : ''}</button>`).join('')}
      </div>
      <dl class="bg-info" role="tabpanel">
        <dt>Correct answers</dt><dd><b>${r.lo}–${r.hi}</b> <span class="muted">out of 40 · ${skill === 'L' ? 'Listening' : 'Academic Reading'}</span></dd>
        <dt>Skill level</dt><dd>${level}</dd>
        <dt>Description</dt><dd>${desc}</dd>
      </dl>
      ${gapLine(rows, result, target)}
    </div>`;
  };
  el.onclick = (e) => {
    const b = e.target.closest('[data-band]');
    if (!b) return;
    cur = +b.dataset.band;
    draw();
    el.querySelector('[data-band].on')?.focus();
  };
  el.onkeydown = (e) => {
    if (!e.target.matches?.('[data-band]') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const i = rows.findIndex((x) => x.band === cur) + (e.key === 'ArrowRight' ? 1 : -1);
    if (!rows[i]) return;
    e.preventDefault();
    cur = rows[i].band;
    draw();
    el.querySelector('[data-band].on')?.focus();
  };
  draw();
}

/** "You got 30 — band 7. Band 7.5 (your target) needs 33: 3 more." */
function gapLine(rows, result, target) {
  if (!result || result.score == null) return '';
  const scaled = result.total === 40 ? result.score : Math.round((result.score / result.total) * 40);
  const got = result.total === 40 ? `<b>${scaled}</b> correct` : `<b>${result.score}/${result.total}</b>, about <b>${scaled}</b> out of 40`;
  let line = `You got ${got}${result.band >= 3 ? ` — band <b>${result.band}</b>` : ' — below band 3'}.`;
  const goal = rows.find((x) => x.band === target);
  const next = [...rows].reverse().find((x) => x.lo > scaled);
  if (goal && scaled >= goal.lo) line += ` That reaches your target of ${target}.`;
  else if (goal) line += ` Your target, band ${target}, needs <b>${goal.lo}</b> — ${goal.lo - scaled} more.`;
  if (next && (!goal || next.band !== goal.band) && !(goal && scaled < goal.lo && next.lo > goal.lo)) line += ` The next band (${next.band}) starts at ${next.lo}.`;
  return `<p class="bg-gap">${line}</p>`;
}
