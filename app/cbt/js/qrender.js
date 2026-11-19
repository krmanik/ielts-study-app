// Renders question groups (from data/t/*.json) as interactive HTML and binds answers to an attempt.
// The controls follow the computer-delivered test: gaps you type into, radio lists for single choices,
// tick boxes for "choose TWO", and boxes you fill by dragging an option in (or clicking to pick one).
import { $, $$, esc, pageImg } from './util.js';
import { icon } from './icons.js';

const emph = (s) => esc(s).replace(/\b(NO MORE THAN [A-Z ]+?WORDS?(?: AND\/OR A NUMBER)?|ONE WORD(?: AND\/OR A NUMBER| ONLY)?|ONLY ONE WORD|A NUMBER|TWO|THREE|FOUR|FIVE|SIX|NOT GIVEN|TRUE|FALSE|YES|NO|NB)\b/g, '<b>$1</b>');

function instrHtml(g) {
  return g.instr.map((t) => {
    const m = t.match(/^(TRUE|FALSE|NOT GIVEN|YES|NO)\s+(if .*)$/);
    if (m) return `<div class="tf-def"><b>${m[1]}</b><span>${esc(m[2])}</span></div>`;
    return `<p>${emph(t)}</p>`;
  }).join('');
}

/** Does this group answer with a letter or numeral picked from a list (rather than typed text)? */
const picks = (g) => g.kind === 'match' || g.kind === 'roman';
/** Option label -> its text, for the groups that print a list of options. */
function optionTexts(g) {
  const map = {};
  for (const r of g.rows) {
    const k = r.o ?? r.r;
    if (k != null && r.q == null) map[k] = (r.t || []).filter((s) => typeof s === 'string').join('');
  }
  return map;
}

function segsHtml(segs, g, ctx) {
  return (segs || []).map((s) => (typeof s === 'string' ? esc(s) : picks(g) ? slotHtml(g, s.g, ctx, true) : gapHtml(s.g, ctx))).join('');
}

function gapHtml(q, ctx) {
  const v = ctx.answers[q] ?? '';
  const rv = ctx.review ? reviewBits(q, ctx) : '';
  return `<span class="gapw no-hl${ctx.review ? (ctx.right[q] ? ' right' : ' wrong') : ''}" id="q-${q}" data-q="${q}"><input class="gap" data-q="${q}" placeholder="${q}" value="${esc(v)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${ctx.review ? 'disabled' : ''} aria-label="Question ${q}">${rv}</span>`;
}

function reviewBits(q, ctx) {
  const k = ctx.key[q];
  if (!k) return '';
  return ctx.right[q] ? `<span class="key ok">${icon('check')}</span>` : `<span class="key">${icon('check')} ${esc(k.show)}</span>`;
}

/** A box that takes one option: drag an option onto it, or click it and pick from the list. */
function slotHtml(g, q, ctx, inline = false) {
  const v = ctx.answers[q] ?? '';
  const text = v ? optionTexts(g)[v] : '';
  const state = ctx.review ? (ctx.right[q] ? ' right' : ' wrong') : '';
  const inner = v ? `<b>${esc(v)}</b>${text ? `<span>${esc(text)}</span>` : ''}` : `<i>${q}</i>`;
  const btn = `<button type="button" class="slot${v ? ' filled' : ''}${state}" data-slot="${q}" data-g="${g.from}" ${ctx.review ? 'disabled' : ''} aria-label="Question ${q}${v ? ', answer ' + esc(v) : ''}">${inner}</button>`;
  if (!inline) return btn;
  return `<span class="gapw slotw no-hl${state}" id="q-${q}" data-q="${q}">${btn}${ctx.review ? reviewBits(q, ctx) : ''}</span>`;
}

function chips(q, opts, ctx) {
  const v = ctx.answers[q] ?? '';
  return `<span class="opts no-hl" data-q="${q}">${opts.map((o) => `<button type="button" class="opt${v === o ? ' sel' : ''}" data-q="${q}" data-v="${esc(o)}" ${ctx.review ? 'disabled' : ''}>${esc(o)}</button>`).join('')}</span>`;
}

function ctlHtml(g, q, ctx) {
  if (g.kind === 'text') {
    return `<input class="ans" data-q="${q}" value="${esc(ctx.answers[q] ?? '')}" autocomplete="off" spellcheck="false" ${ctx.review ? 'disabled' : ''} aria-label="Question ${q}">`;
  }
  if (picks(g)) return slotHtml(g, q, ctx);
  return chips(q, g.opts || ['A', 'B', 'C'], ctx);
}

const flagBtn = (q, ctx) => (ctx.review ? '' : `<button class="flag no-hl${ctx.flags[q] ? ' on' : ''}" data-flag="${q}" title="Mark for review" aria-label="Mark question ${q} for review">${icon('flag')}</button>`);

function qRow(g, row, ctx, labelHtml) {
  const q = row.n;
  const cls = ctx.review ? (ctx.right[q] ? ' right' : ' wrong') : '';
  if ((g.kind === 'tfng' || g.kind === 'ynng') && row.ctl) {
    // a statement with its three choices listed under it, as on the real screen
    const v = ctx.answers[q] ?? '';
    const key = ctx.key[q]?.show;
    const radios = g.opts.map((o) => {
      const rc = ctx.review ? (o === key ? ' is-key' : v === o ? ' is-wrong' : '') : '';
      return `<label class="mc-opt plain${v === o ? ' sel' : ''}${rc}" data-q="${q}" data-v="${esc(o)}"><span class="radio no-hl"></span><span>${esc(o)}</span></label>`;
    }).join('');
    return `<div class="q stmt${cls}" id="q-${q}" data-q="${q}">
      <span class="qn no-hl">${q}</span><span class="qt">${labelHtml}</span>${flagBtn(q, ctx)}
      <div class="radios no-hl">${radios}</div></div>`;
  }
  return `<div class="q${cls}" id="q-${q}" data-q="${q}">
    <span class="qn no-hl">${q}</span>
    <span class="qt">${labelHtml}</span>
    ${row.ctl ? `<span class="qc">${ctlHtml(g, q, ctx)}</span>` : ''}
    ${ctx.review ? reviewBits(q, ctx) : ''}
    ${flagBtn(q, ctx)}
  </div>`;
}

/** A "complete the table" question as a table, the gaps inside its cells. */
function tableHtml(g, ctx) {
  const cell = (c) => {
    const tag = c.h ? 'th' : 'td';
    const span = (c.cs ? ` colspan="${c.cs}"` : '') + (c.rs ? ` rowspan="${c.rs}"` : '');
    const nested = c.p.some((p) => p.li === 'dot') && c.p.some((p) => p.li === 'dash');      // dashes under a bullet point
    const inner = c.p.map((p) => (p.li
      ? `<div class="qrow li"${nested && p.li === 'dash' ? ' style="--lv:1"' : ''}><span class="mk no-hl">${p.li === 'dash' ? '–' : '•'}</span><span>${segsHtml(p.t, g, ctx)}</span></div>`
      : `<div class="qrow">${segsHtml(p.t, g, ctx)}</div>`)).join('');
    return `<${tag}${span}>${c.ex ? '<span class="ex-tag no-hl">Example</span>' : ''}${inner}</${tag}>`;
  };
  return `<div class="qtable-wrap">${g.table.title ? `<div class="qrow title">${esc(g.table.title)}</div>` : ''}
    <table class="qtable">${g.table.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table></div>`;
}

export function groupHtml(g, T, ctx) {
  const range = g.from === g.to ? `Question ${g.from}` : `Questions ${g.from}–${g.to}`;
  const drag = picks(g) && !ctx.review;
  let body = '';
  if (g.fig) {
    body += `<div class="figs no-hl">${g.fig.map((f) => pageImg(T.book, f.page, f.box, T.ratio)).join('')}</div>`;
    body += g.rows.map((r) => qRow(g, r, ctx, esc(r.lab || ''))).join('');
  } else if (g.table) {
    body += tableHtml(g, ctx);
  } else {
    let boxOpen = false;
    for (const r of g.rows) {
      const isBox = (r.o && (g.kind === 'match' || r.box)) || r.r;
      if (isBox && !boxOpen) { body += `<div class="opt-box${drag ? ' draggable' : ''}">`; boxOpen = true; }
      if (!isBox && boxOpen) { body += '</div>'; boxOpen = false; }
      const pad = r.i ? ` style="--lv:${r.i}"` : '';
      if (isBox) {
        const k = r.r || r.o;
        body += `<div class="ol-row"${drag ? ` draggable="true" data-drag="${esc(k)}" data-g="${g.from}"` : ''}><b>${esc(k)}</b><span>${segsHtml(r.t, g, ctx)}</span></div>`;
        continue;
      }
      if (r.o && g.kind === 'multi') {
        const sel = selectedMulti(g, ctx).includes(r.o);
        body += `<label class="mc-opt multi${sel ? ' sel' : ''}${reviewMulti(g, r.o, ctx)}" data-g="${g.from}" data-v="${esc(r.o)}"><span class="box no-hl"></span><b>${esc(r.o)}</b><span>${segsHtml(r.t, g, ctx)}</span></label>`;
        continue;
      }
      if (r.o && r.q != null) {
        const sel = ctx.answers[r.q] === r.o;
        const rc = ctx.review ? (ctx.key[r.q]?.a?.includes(r.o.toLowerCase()) ? ' is-key' : sel ? ' is-wrong' : '') : '';
        body += `<label class="mc-opt${sel ? ' sel' : ''}${rc}" data-q="${r.q}" data-v="${esc(r.o)}"><span class="radio no-hl"></span><b>${esc(r.o)}</b><span>${segsHtml(r.t, g, ctx)}</span></label>`;
        continue;
      }
      if (r.n != null) { body += qRow(g, r, ctx, segsHtml(r.t, g, ctx)); continue; }
      if (r.c) { body += `<div class="qrow title">${segsHtml(r.t, g, ctx)}</div>`; continue; }
      if (r.ex) { body += `<div class="qrow ex"${pad}><span class="ex-tag no-hl">Example</span>${segsHtml(r.t, g, ctx)}</div>`; continue; }
      if (r.li) { body += `<div class="qrow li"${pad}><span class="mk no-hl">${r.li === 'dash' ? '–' : '•'}</span><span>${segsHtml(r.t, g, ctx)}</span></div>`; continue; }
      body += `<div class="qrow${r.b ? ' sub' : ''}"${pad}>${segsHtml(r.t, g, ctx)}</div>`;
    }
    if (boxOpen) body += '</div>';
  }
  let multiHead = '';
  if (g.kind === 'multi') {
    const anchors = [];
    for (let q = g.from; q <= g.to; q++) anchors.push(`<span class="anchor" id="q-${q}" data-q="${q}"></span>`);
    multiHead = anchors.join('') + (ctx.review ? `<div class="multi-key no-hl">${multiReview(g, ctx)}</div>` : `<p class="pick-note no-hl">Choose <b>${g.to - g.from + 1}</b> answers.</p>`);
  }
  const hint = drag && g.rows.some((r) => r.box || r.r) ? `<p class="pick-note no-hl">Drag an option into a box, or click a box to choose.</p>` : '';
  if (g.frame && !g.fig) body = `<div class="notes-box">${body}</div>`;
  return `<section class="qgroup kind-${g.kind}" data-from="${g.from}" data-to="${g.to}">
    <h4>${range}</h4>
    <div data-hz="g${g.from}">
      <div class="instr">${instrHtml(g)}</div>
      ${multiHead}${hint}
      ${body}
    </div>
  </section>`;
}

function selectedMulti(g, ctx) {
  const out = [];
  for (let q = g.from; q <= g.to; q++) if (ctx.answers[q]) out.push(ctx.answers[q]);
  return out;
}
function reviewMulti(g, letter, ctx) {
  if (!ctx.review) return '';
  const k = ctx.key[g.from];
  const isKey = k?.vals?.includes(letter.toLowerCase());
  const sel = selectedMulti(g, ctx).includes(letter);
  return isKey ? ' is-key' : sel ? ' is-wrong' : '';
}
function multiReview(g, ctx) {
  const parts = [];
  for (let q = g.from; q <= g.to; q++) parts.push(`<span class="${ctx.right[q] ? 'ok' : 'no'}">Q${q}: ${esc(ctx.answers[q] || '—')} ${icon(ctx.right[q] ? 'check' : 'x')}</span>`);
  return parts.join(' · ') + ` <span class="muted">(answer: ${esc(ctx.key[g.from]?.show || '')})</span>`;
}

export function partQuestionsHtml(part, T, ctx) {
  return part.groups.map((g) => groupHtml(g, T, ctx)).join('');
}

/**
 * Wire up answer controls inside `root`. `onAnswer(q, value)` saves; `onFocus(q)` marks the current question;
 * `onFlag(q)` toggles review flag. Groups are looked up by their first question in `groupsByFrom`.
 * Returns a function that removes the document-level listeners (call it before rendering another part).
 */
export function bindQuestions(root, { answers, onAnswer, onFocus, onFlag, groupsByFrom }) {
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; };

  const setSlot = (g, q, v) => {
    onAnswer(q, v);
    const texts = optionTexts(g);
    $$(`[data-slot="${q}"]`, root).forEach((b) => {
      b.classList.toggle('filled', !!v);
      b.innerHTML = v ? `<b>${esc(v)}</b>${texts[v] ? `<span>${esc(texts[v])}</span>` : ''}` : `<i>${q}</i>`;
    });
    onFocus(q);
  };

  const openMenu = (slot) => {
    closeMenu();
    const q = +slot.dataset.slot, g = groupsByFrom[+slot.dataset.g];
    const texts = optionTexts(g);
    menu = document.createElement('div');
    menu.className = 'slot-menu no-hl';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = (g.opts || []).map((o) => `<button type="button" role="option" data-v="${esc(o)}" class="${answers[q] === o ? 'sel' : ''}"><b>${esc(o)}</b>${texts[o] ? `<span>${esc(texts[o])}</span>` : ''}</button>`).join('')
      + (answers[q] ? `<button type="button" class="clear" data-v="">Clear answer</button>` : '');
    document.body.appendChild(menu);
    const r = slot.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left)) + 'px';
    const below = r.bottom + 4 + menu.offsetHeight < innerHeight - 8;
    menu.style.top = (below ? r.bottom + 4 : Math.max(8, r.top - menu.offsetHeight - 4)) + 'px';
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) { setSlot(g, q, b.dataset.v); closeMenu(); slot.focus(); }
    });
    menu.querySelector('.sel, button')?.focus();
  };
  const onDocDown = (e) => { if (menu && !e.target.closest('.slot-menu, [data-slot]')) closeMenu(); };
  const onDocKey = (e) => {
    if (!menu) return;
    if (e.key === 'Escape') { closeMenu(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...menu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  };
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('keydown', onDocKey);
  root.addEventListener('scroll', closeMenu, true);

  // drag an option from the list into a box
  root.addEventListener('dragstart', (e) => {
    const d = e.target.closest?.('[data-drag]');
    if (!d) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ v: d.dataset.drag, g: d.dataset.g }));
    e.dataTransfer.effectAllowed = 'copy';
    root.classList.add('dragging');
    root.dataset.dragG = d.dataset.g;
  });
  root.addEventListener('dragend', () => { root.classList.remove('dragging'); $$('.slot.over', root).forEach((s) => s.classList.remove('over')); });
  root.addEventListener('dragover', (e) => {
    const s = e.target.closest?.('[data-slot]');
    if (s && s.dataset.g === root.dataset.dragG) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; s.classList.add('over'); }
  });
  root.addEventListener('dragleave', (e) => e.target.closest?.('[data-slot]')?.classList.remove('over'));
  root.addEventListener('drop', (e) => {
    const s = e.target.closest?.('[data-slot]');
    if (!s) return;
    e.preventDefault();
    s.classList.remove('over');
    let d;
    try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (d.g !== s.dataset.g) return;
    setSlot(groupsByFrom[+s.dataset.g], +s.dataset.slot, d.v);
  });

  root.addEventListener('input', (e) => {
    const inp = e.target.closest('input[data-q]');
    if (inp) onAnswer(+inp.dataset.q, inp.value);
  });
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-slot]') || e.target.closest('[data-q]');
    if (el) onFocus(+(el.dataset.slot || el.dataset.q));
  });
  root.addEventListener('click', (e) => {
    const fl = e.target.closest('[data-flag]');
    if (fl) { onFlag(+fl.dataset.flag); fl.classList.toggle('on'); return; }
    const slot = e.target.closest('[data-slot]');
    if (slot) { if (menu) closeMenu(); else openMenu(slot); onFocus(+slot.dataset.slot); return; }
    const chip = e.target.closest('button.opt[data-q]');
    if (chip) {
      const q = +chip.dataset.q, v = chip.dataset.v;
      const nv = answers[q] === v ? '' : v;
      $$(`button.opt[data-q="${q}"]`, root).forEach((b) => b.classList.toggle('sel', b.dataset.v === nv));
      onAnswer(q, nv); onFocus(q);
      return;
    }
    const mc = e.target.closest('label.mc-opt');
    if (!mc) return;
    e.preventDefault();
    if (mc.classList.contains('multi')) {
      const g = groupsByFrom[+mc.dataset.g];
      const n = g.to - g.from + 1;
      let sel = [];
      for (let q = g.from; q <= g.to; q++) if (answers[q]) sel.push(answers[q]);
      const v = mc.dataset.v;
      if (sel.includes(v)) sel = sel.filter((x) => x !== v);
      else if (sel.length < n) sel.push(v);
      else { sel.shift(); sel.push(v); }
      sel.sort();
      for (let i = 0; i < n; i++) onAnswer(g.from + i, sel[i] || '');
      $$(`label.mc-opt.multi[data-g="${g.from}"]`, root).forEach((l) => l.classList.toggle('sel', sel.includes(l.dataset.v)));
      onFocus(g.from + Math.max(0, sel.length - 1));
      return;
    }
    const q = +mc.dataset.q, v = mc.dataset.v;
    const nv = answers[q] === v ? '' : v;
    $$(`label.mc-opt[data-q="${q}"]`, root).forEach((l) => l.classList.toggle('sel', l.dataset.v === nv));
    onAnswer(q, nv); onFocus(q);
  });
  return () => { closeMenu(); document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onDocKey); };
}

export function focusQuestion(root, q) {
  const el = $(`#q-${q}`, root);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const inp = el.matches('input') ? el : el.querySelector('input:not([disabled]), [data-slot]:not([disabled])');
  if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 250);
}
