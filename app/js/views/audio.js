import { esc, fmtTime } from '../util.js';
import { S } from '../store.js';
import { BOOK, MOD, label, byId } from '../data.js';
import { setChrome } from '../chrome.js';
import { play, onPlayer, state as ps, isListened } from '../player.js';
import { icon } from '../../cbt/js/icons.js';

const GROUPS = [
  ['intro', 'Introduction'],
  ['listening', 'Listening skills units'],
  ['speaking', 'Speaking — pronunciation (Unit 4)'],
  ['tests', 'Practice tests — Listening'],
];

export function render(view) {
  setChrome({ crumbs: '<b>Audio tracks</b>' });
  const draw = () => {
    const tracks = BOOK.tracks;
    const done = tracks.filter((t) => isListened(t.n)).length;
    const cur = ps();
    view.innerHTML = `
      <h1>Audio tracks</h1>
      <p class="muted" style="margin-top:-4px">All ${tracks.length} recordings, matched to the track numbers printed in the book. ${done} listened to the end. Click a track to play; use <b>Page</b> to jump to its exercise and <b>Script</b> for the transcript.</p>
      ${GROUPS.map(([g, title]) => {
        const list = tracks.filter((t) => t.group === g);
        if (!list.length) return '';
        return `<div class="card" style="margin-bottom:16px;padding:8px 8px 4px"><h2 style="padding:8px 10px 0">${title}</h2>
          ${list.map((t) => {
            const ref = t.refs?.[0];
            const playing = cur.n === t.n && cur.playing;
            const plays = S().plays[t.n]?.count || 0;
            return `<div class="result-row">
              <button class="icon-btn" data-play="${t.n}" title="Play" style="${playing ? 'background:var(--accent);color:#fff' : ''}">${icon(playing ? 'pause' : 'play')}</button>
              <b style="width:34px">${t.n}</b>
              <div class="grow"><div>${esc(t.title)}</div><small>${fmtTime(t.dur)}${plays ? ` · played ${plays}×` : ''}</small></div>
              ${isListened(t.n) ? `<span class="pill ok">${icon('check')}</span>` : ''}
              ${ref ? `<a class="btn sm" href="${t.group === 'tests' ? `#/test/t${t.test}/study/listening` : `#/page/${ref.page}?y=${ref.y}`}">Page ${label(ref.page)}</a>` : ''}
              ${t.script ? `<a class="btn sm" href="#/page/${t.script.page}?y=${t.script.y}">Script</a>` : ''}
            </div>`;
          }).join('')}</div>`;
      }).join('')}`;
  };
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-play]');
    if (b) play(Number(b.dataset.play));
  });
  const off = onPlayer(draw);
  draw();
  return off;
}
