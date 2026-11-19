// Top bar + navigation guard helpers shared by all views.
import { $ } from './util.js';
import { icon } from '../cbt/js/icons.js';

let guard = null; // optional fn returning a message if leaving the view should be confirmed

export function setChrome({ crumbs = '', actions = '', wide = false } = {}) {
  $('#crumbs').innerHTML = crumbs;
  $('#top-actions').innerHTML = actions;
  $('#view').classList.toggle('wide', wide);
}
export const crumbs = (...parts) => parts.map((p, i) => (i === parts.length - 1 ? `<b>${p}</b>` : p)).join(` <span>${icon('chevron-right')}</span> `);
export function setGuard(fn) { guard = fn; }
export function takeGuard() { const g = guard; return g; }
export function clearGuard() { guard = null; }
