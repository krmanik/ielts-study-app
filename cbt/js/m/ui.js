// Small pieces shared by the phone views.
import { esc, SKILL, fmtDateTime } from '../util.js';
import { syncStatus, STATIC } from '../store.js';
import { partsDone, FULL } from '../actions.js';
import { allTests } from '../data.js';

export const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
export const PART_WORD = { L: 'Part', R: 'Passage', W: 'Task', S: 'Part' };

export const skBadge = (s) => `<span class="m-sk sk-${s}" aria-hidden="true">${s}</span>`;
export const chevron = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Where the progress is right now, in a few words: { cls, text, detail }. */
export function syncInfo() {
  const s = syncStatus(), g = s.gh;
  if (STATIC || (g.on && !s.online)) {       // no Mac behind this page: GitHub is the meeting place
    if (!g.on) return { cls: 'idle', text: 'Saved on this device', detail: 'Results are kept on this device only. Connect GitHub below and they are kept in step with your Mac.' };
    if (g.error) return { cls: 'warn', text: 'GitHub needs a look', detail: g.error + '. Results are safe on this device meanwhile.' };
    if (g.online && navigator.onLine) return { cls: 'good', text: 'In step through GitHub', detail: `Last exchanged ${g.last ? fmtDateTime(g.last) : 'just now'}${g.pending ? ' — a few changes are waiting to go' : ''}.` };
    return { cls: 'idle', text: 'Saved on this device', detail: 'No connection. Everything is kept on this device and exchanged through GitHub when you are online again.' };
  }
  if (s.needKey) return { cls: 'warn', text: 'Phone code needed', detail: 'Your Mac is in reach but wants the phone code again. Results are safe on this device meanwhile.' };
  if (s.online) {
    return LOCAL
      ? { cls: 'good', text: 'Saved on this Mac', detail: 'Results are written to the progress folder as you go.' }
      : { cls: 'good', text: 'In step with your Mac', detail: `Last saved to the Mac ${s.last ? fmtDateTime(s.last) : 'just now'}.` };
  }
  return { cls: 'idle', text: 'Saved on this device', detail: 'Your Mac is out of reach. Everything is kept on this device and sent to the Mac the next time the two meet.' };
}
export const syncChip = () => { const i = syncInfo(); return `<a class="m-chip ${i.cls}" href="#/more"><i></i>${esc(i.text)}</a>`; };

/** How long one part takes, in words. */
export const partTime = (skill, n) => (skill === 'L' ? 'about 8 min' : skill === 'R' ? '20 min' : skill === 'W' ? (n === 1 ? '20 min' : '40 min') : 'about 12 min');

/** The first part of `skill` not finished yet, going through the books in order: { t, part } or null. */
export function nextPart(skill) {
  for (const t of allTests()) {
    const got = partsDone(t.id, skill);
    if (skill === 'S') { if (!got[1]) return { t, part: null }; continue; }
    if (skill === 'L' && !t.audio) continue;
    const part = FULL[skill].find((p) => !got[p]);
    if (part) return { t, part };
  }
  return null;
}

/** "Passage 2 · The Falkirk Wheel" */
export function partLabel(skill, t, n) {
  if (skill === 'S') return 'Speaking test';
  const title = skill === 'R' ? t.titles?.[n - 1] : '';
  return `${PART_WORD[skill]} ${n}${title ? ' · ' + title : ''}`;
}
/** Can a recording that is not saved on the device be played from where the app came from? */
export const inReach = () => LOCAL || (STATIC ? navigator.onLine : syncStatus().online);
export { SKILL, STATIC };
