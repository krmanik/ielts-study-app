// Learn: the writing and speaking material (writing/band9/*.md and writing/cards.txt, built into
// data/learn.json by writing/build.py) — model answers to read and practise, rules and phrases as cards.
// Everything a learner needs is on the page; the Anki decks are offered as a download beside it.
import { $, $$, esc } from '../util.js';
import { loadLearn } from '../data.js';
import { isLearnt, setLearnt, onChange } from '../store.js';
import { icon } from '../icons.js';

const SKILL_ICON = { W: 'pen-line', S: 'mic' };
const SKILL_NAME = { W: 'Writing', S: 'Speaking' };
const key = (sec, it) => `${sec.id}/${it.id}`;
const hydrate = (root) => $$('[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); el.removeAttribute('data-icon'); });
const sections = (doc) => doc.groups.flatMap((g) => g.sections);
const learntIn = (sec) => sec.items.filter((it) => isLearnt(key(sec, it))).length;

function bar(done, total) {
  const p = total ? Math.round((done / total) * 100) : 0;
  return `<div class="l-bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></div>`;
}

/** The first item not learnt yet, in the order the README suggests: essays, Task 1, topics, speaking, phrases. */
function nextItem(doc) {
  for (const sec of sections(doc)) for (const it of sec.items) if (!isLearnt(key(sec, it))) return [sec, it];
  return null;
}

// ------------------------------------------------------------------------------------------ overview
export async function render(page) {
  const doc = await loadLearn();
  const draw = () => {
    const all = sections(doc), total = all.reduce((n, s) => n + s.items.length, 0), done = all.reduce((n, s) => n + learntIn(s), 0);
    const nx = nextItem(doc);
    page.innerHTML = `<div class="l-top"><div><h1>Learn</h1>
        <p class="muted">Model answers, rules and phrases for Writing and Speaking — all here, nothing to look up elsewhere.</p></div>
        <div class="l-total"><b>${done}</b><span>of ${total} learnt</span>${bar(done, total)}</div></div>
      ${nx ? `<a class="card l-next" href="#/learn/${nx[0].id}${nx[0].kind === 'model' ? '/' + nx[1].id : ''}">
          <span class="l-ico">${icon(SKILL_ICON[nx[0].skill])}</span>
          <span class="grow"><small>Up next · ${esc(nx[0].title)}</small><b>${nx[0].kind === 'model' ? esc(nx[1].title) : 'Practise the cards'}</b></span>
          <span class="btn primary">Start ${icon('arrow-right')}</span></a>`
        : `<div class="card l-next"><span class="l-ico">${icon('circle-check')}</span><span class="grow"><b>Everything is marked as learnt.</b><small>Keep it fresh with the Anki decks below.</small></span></div>`}
      ${doc.groups.map((g) => `<div class="section-title"><h2>${esc(g.title)}</h2></div>
        <div class="l-grid">${g.sections.map((s) => {
          const d = learntIn(s);
          return `<a class="card l-sec" href="#/learn/${s.id}">
            <span class="l-ico sk-${s.skill}">${icon(SKILL_ICON[s.skill])}</span>
            <b>${esc(s.title)}</b>
            <small>${s.items.length} ${s.kind === 'model' ? 'pages' : 'cards'} · ${SKILL_NAME[s.skill]}</small>
            ${bar(d, s.items.length)}<small class="l-count">${d ? `${d} learnt` : 'Not started'}</small></a>`;
        }).join('')}</div>`).join('')}
      ${doc.decks?.length ? `<div class="section-title"><h2>Review with Anki</h2></div>
        <div class="card l-anki"><div class="grow"><p>The same material as spaced-repetition cards. Download, then open the file
          with Anki (Mac/Windows), AnkiMobile or AnkiDroid. Importing a newer copy updates the cards and keeps your reviews.</p>
          <p class="muted">Deck options: 15 new cards a day. Suspend the sub-decks you are not on yet.</p></div>
          <div class="l-dl">${doc.decks.map((d) => `<a class="btn" href="${esc(d.file)}" download>${icon('download')} ${esc(d.title)} <small>${d.cards} cards</small></a>`).join('')}</div></div>` : ''}`;
  };
  draw();
  return onChange(draw);
}

// ------------------------------------------------------------------------------------------ one section
export async function renderSection(page, secId) {
  const doc = await loadLearn();
  const sec = sections(doc).find((s) => s.id === secId);
  if (!sec) { page.innerHTML = `<div class="card"><h2>Not found</h2><a href="#/learn">Back to Learn</a></div>`; return; }
  return sec.kind === 'model' ? modelList(page, sec) : cardDeck(page, sec);
}

function head(sec) {
  const d = learntIn(sec);
  return `<a class="back" href="#/learn">${icon('arrow-left')} Learn</a>
    <div class="l-top"><div><span class="pill accent">${icon(SKILL_ICON[sec.skill])} ${SKILL_NAME[sec.skill]}</span><h1>${esc(sec.title)}</h1></div>
      <div class="l-total"><b>${d}</b><span>of ${sec.items.length} learnt</span>${bar(d, sec.items.length)}</div></div>`;
}

function modelList(page, sec) {
  const draw = () => {
    page.innerHTML = `${head(sec)}
      ${sec.intro ? `<div class="card l-intro">${sec.intro}</div>` : ''}
      <div class="card l-list">${sec.items.map((it, i) => {
        const on = isLearnt(key(sec, it));
        return `<a class="l-row${on ? ' on' : ''}" href="#/learn/${sec.id}/${it.id}">
          <span class="l-num">${on ? icon('check') : i + 1}</span>
          <span class="grow"><b>${esc(it.title)}</b>${it.q ? `<small>${it.q.replace(/<[^>]+>/g, '')}</small>` : ''}</span>
          ${icon('chevron-right', 'l-chev')}</a>`;
      }).join('')}</div>`;
  };
  draw();
  return onChange(draw);
}

/** Rules and phrases: one card at a time — think of the answer, show it, say whether you knew it. */
function cardDeck(page, sec) {
  let order = sec.items.map((_, i) => i), at = 0, shown = false, list = false;
  const startAt = () => { const i = order.findIndex((n) => !isLearnt(key(sec, sec.items[n]))); return i < 0 ? 0 : i; };
  at = startAt();
  const draw = () => {
    const it = sec.items[order[at]], on = isLearnt(key(sec, it));
    page.innerHTML = `${head(sec)}
      <div class="row l-modes"><div class="l-seg" role="tablist">
        <button class="${list ? '' : 'on'}" data-mode="cards" role="tab" aria-selected="${!list}">${icon('layers')} Practise</button>
        <button class="${list ? 'on' : ''}" data-mode="list" role="tab" aria-selected="${list}">${icon('book-open')} Read all</button></div>
        ${list ? '' : `<button class="btn ghost small" data-act="shuffle">${icon('shuffle')} Shuffle</button>`}</div>
      ${list ? `<div class="l-cards">${sec.items.map((x) => `<div class="card l-card${isLearnt(key(sec, x)) ? ' on' : ''}">
          <div class="l-front">${x.front}</div><div class="l-back">${x.back}</div></div>`).join('')}</div>`
      : `<div class="card l-flash${on ? ' on' : ''}">
          <small class="muted">Card ${at + 1} of ${sec.items.length}${on ? ` · ${icon('check')} learnt` : ''}</small>
          <div class="l-front">${it.front}</div>
          ${shown ? `<div class="l-back">${it.back}</div>` : `<p class="muted l-think">Say the answer to yourself first.</p>`}
          <div class="row l-actions">
            ${shown ? `<button class="btn" data-act="again">${icon('rotate-ccw')} Not yet</button>
              <button class="btn primary" data-act="knew">${icon('check')} I knew it</button>`
            : `<button class="btn primary big" data-act="show">${icon('eye')} Show answer <kbd>Space</kbd></button>`}
          </div></div>
        <div class="row l-pager"><button class="btn ghost" data-act="prev" ${at ? '' : 'disabled'}>${icon('arrow-left')} Previous</button>
          <button class="btn ghost" data-act="next" ${at < order.length - 1 ? '' : 'disabled'}>Next ${icon('arrow-right')}</button></div>`}`;
    hydrate(page);
  };
  const go = (d) => { at = Math.max(0, Math.min(order.length - 1, at + d)); shown = false; draw(); };
  const onClick = (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { list = m.dataset.mode === 'list'; draw(); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    const it = sec.items[order[at]];
    if (a === 'show') { shown = true; draw(); }
    else if (a === 'knew') { setLearnt(key(sec, it), true); if (at < order.length - 1) go(1); else draw(); }
    else if (a === 'again') { setLearnt(key(sec, it), false); if (at < order.length - 1) go(1); else draw(); }
    else if (a === 'prev') go(-1);
    else if (a === 'next') go(1);
    else if (a === 'shuffle') { order = order.map((n) => [Math.random(), n]).sort((x, y) => x[0] - y[0]).map((x) => x[1]); at = 0; shown = false; draw(); }
  };
  const onKey = (e) => {
    if (list || e.target.closest('input, textarea')) return;
    if (e.key === ' ' && !shown) { e.preventDefault(); shown = true; draw(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  draw();
  page.addEventListener('click', onClick);
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}

// ------------------------------------------------------------------------------------------ one model answer
export async function renderItem(page, secId, itemId) {
  const doc = await loadLearn();
  const sec = sections(doc).find((s) => s.id === secId);
  const i = sec ? sec.items.findIndex((x) => x.id === itemId) : -1;
  if (i < 0) { page.innerHTML = `<div class="card"><h2>Not found</h2><a href="#/learn">Back to Learn</a></div>`; return; }
  const it = sec.items[i], prev = sec.items[i - 1], next = sec.items[i + 1];
  let practise = false;
  const draw = () => {
    const on = isLearnt(key(sec, it));
    page.innerHTML = `<a class="back" href="#/learn/${sec.id}">${icon('arrow-left')} ${esc(sec.title)}</a>
      <div class="l-item">
        <div class="row l-meta"><span class="pill accent">${icon(SKILL_ICON[sec.skill])} ${esc(sec.title)}</span><small class="muted">${i + 1} of ${sec.items.length}</small></div>
        <h1>${esc(it.title)}</h1>
        ${it.q ? `<div class="l-q">${icon('message-circle')}<div>${it.q}</div></div>` : ''}
        ${it.chunks ? `<div class="row l-modes"><div class="l-seg" role="tablist">
            <button class="${practise ? '' : 'on'}" data-mode="read" role="tab" aria-selected="${!practise}">${icon('book-open')} Read</button>
            <button class="${practise ? 'on' : ''}" data-mode="practise" role="tab" aria-selected="${practise}">${icon('target')} Practise</button></div>
            <small class="muted">${practise ? 'Say each hidden phrase, then tap it to check.' : `${it.chunks} key phrase${it.chunks > 1 ? 's' : ''} highlighted — learn these, not the whole text.`}</small>
            ${practise ? `<button class="btn ghost small" data-act="reveal">${icon('eye')} Show all</button>` : ''}</div>` : ''}
        <div class="card l-body${practise ? ' practise' : ''}">${it.html}</div>
        ${it.tip ? `<div class="l-tip">${icon('lightbulb')}<div>${it.tip}</div></div>` : ''}
        <div class="row l-pager">
          ${prev ? `<a class="btn ghost" href="#/learn/${sec.id}/${prev.id}">${icon('arrow-left')} Previous</a>` : '<span></span>'}
          <button class="btn ${on ? 'ok-on' : 'primary'}" data-act="learnt">${icon(on ? 'circle-check' : 'check')} ${on ? 'Learnt' : 'Mark as learnt'}</button>
          ${next ? `<a class="btn ghost" href="#/learn/${sec.id}/${next.id}">Next ${icon('arrow-right')}</a>` : '<span></span>'}
        </div></div>`;
  };
  const onClick = (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { practise = m.dataset.mode === 'practise'; draw(); return; }
    const k = e.target.closest('.l-body.practise .k');
    if (k) { k.classList.toggle('open'); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'reveal') $$('.l-body .k', page).forEach((x) => x.classList.add('open'));
    else if (a === 'learnt') {
      const on = !isLearnt(key(sec, it));
      setLearnt(key(sec, it), on);
      if (on && next) location.hash = `#/learn/${sec.id}/${next.id}`;
    }
  };
  const onKey = (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight' && next) location.hash = `#/learn/${sec.id}/${next.id}`;
    else if (e.key === 'ArrowLeft' && prev) location.hash = `#/learn/${sec.id}/${prev.id}`;
  };
  draw();
  page.addEventListener('click', onClick);
  addEventListener('keydown', onKey);
  const off = onChange(draw);
  return () => { off(); removeEventListener('keydown', onKey); };
}
