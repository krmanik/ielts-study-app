export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
export function fmtMins(sec) {
  const m = Math.round((sec || 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function dayKey(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export function debounce(fn, ms = 400) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function wordCount(s) {
  return (s.trim().match(/[\p{L}\p{N}'’-]+/gu) || []).length;
}

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/** Open a modal. `html` is trusted markup; returns the dialog element. Resolves with value passed to close(). */
export function modal(html, { onMount } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  return new Promise((resolve) => {
    const close = (v) => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    m.onclick = (e) => {
      if (e.target === m) close(null);
      const b = e.target.closest('[data-close]');
      if (b) close(b.dataset.close);
    };
    onMount?.(m.firstElementChild, close);
  });
}
export async function confirmBox(text, ok = 'OK') {
  const r = await modal(`<p style="margin-top:0">${esc(text)}</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close="">Cancel</button><button class="btn primary" data-close="ok">${esc(ok)}</button></div>`);
  return r === 'ok';
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
