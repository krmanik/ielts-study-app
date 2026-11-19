// Reading passages and listening transcripts as HTML (shared by the test screen and tools/audit.html).
import { esc } from './util.js';

/** The passage of one Reading part: label, title, paragraphs. */
export function passageHtml(p) {
  // where paragraphs carry letters in the margin, the ones without a letter keep to the same text column
  const hang = p.passage.some((b) => b.label) ? ' class="cont"' : '';
  return `<p class="pass-label no-hl">READING PASSAGE ${p.n}</p>
    ${p.title ? `<h2>${esc(p.title)}</h2>` : ''}
    ${p.passage.map((b) => b.h ? `<h3${hang}>${esc(b.text)}</h3>`
    : b.sub ? `<p class="strap">${esc(b.text)}</p>`
    : b.fn ? `<p class="footnote">${esc(b.text)}</p>`
    : b.label ? `<p class="lettered"><b class="plabel">${esc(b.label)}</b>${esc(b.text)}</p>`
    : `<p${hang}>${esc(b.text)}</p>`).join('')}`;
}

/** The transcript of one Listening part, with the book's "Q12" answer markers. */
export function scriptHtml(p) {
  if (!p.script) return `<p class="muted">The transcript for this part is missing from the book scan.</p>`;
  return `<p class="pass-label no-hl">TRANSCRIPT · PART ${p.n}</p>` + p.script.map((para) => {
    let text = esc(para.t);
    if (para.marks) {
      // insert markers from the end so earlier positions stay valid (positions refer to unescaped text)
      const raw = para.t;
      const pieces = [];
      let last = raw.length;
      [...para.marks].sort((a, b) => b[0] - a[0]).forEach(([pos, qs]) => {
        pieces.unshift(esc(raw.slice(Math.min(pos, last), last)));
        pieces.unshift(`<span class="qmark no-hl">${qs.map((q) => 'Q' + q).join(' ')}</span>`);
        last = Math.min(pos, last);
      });
      pieces.unshift(esc(raw.slice(0, last)));
      text = pieces.join('');
    }
    return `<p>${para.s ? `<b class="spk no-hl">${esc(para.s)}</b> ` : ''}${text}</p>`;
  }).join('');
}
