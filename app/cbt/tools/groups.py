"""Turn the OCR rows of one question group ("Questions 11-16 ...") into structure for the app.

OCR is unreliable exactly where structure lives: a lone "B", a question number, the dots of a gap. So nothing
here trusts a single label. Each question type has a known shape - question numbers run in order, option
letters run A, B, C..., every question has one gap - and the rows are fitted to that shape. A label that was
misread or lost is restored from its position in the sequence; what cannot be fitted is left visibly broken
for tools/check.py to report instead of being guessed.

Output (one dict per group): from, to, kind, instr, opts?, limit?, pick?, fig?, rows. Row fields:
  t    text segments; {"g": q} is an answer gap for question q
  n    question number (the row is a question)      ctl  1 = show an answer control beside it
  o    option letter   q  the question it belongs to (mcq)   box 1 = option listed in a box
  r    heading numeral (i, ii, ...)                 i    indent level 0-3     c  1 = centred title
  ex   1 = the worked example printed in the book   fb   1 = question not found in the text (fallback)
  b    1 = sub-heading (bold)
"""
import re
from lines import UNKNOWN

GAP = re.compile(r'(?:(?<![\w.])(\d{1,2})\s?)?(?:[.…·]\s?){2,}[.…]?|_{3,}')
ROMAN = r'(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|x)'
ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']
INSTR = re.compile(r'^(Complete|Choose|Write|Answer|Label|Do the following|Look at|Match|Classify|Reading Passage \d|'
                   r'In boxes|NB\b|N\.B|You may use|Use the information|Which (paragraph|section)|TRUE\b|FALSE\b|NOT GIVEN|'
                   r'YES\b|NO\b|if the|if it is|Using NO|Select|Identify|For (each|questions)|The (text|passage) on|'
                   r'What (is|are|does)|The (diagram|chart|map|plan|table) (below|on))')
STRONG = re.compile(r'^(Write|Choose|Complete|Label|Answer the|Match|Classify|Do the following|Look at|NB\b|N\.B|'
                    r'Reading Passage \d has|Which (paragraph|section) contains|In boxes|You may use|Using NO|Select|Identify)')
BARE = re.compile(r'(?<![\w£$€.,:/-])(\d{1,2})(?![\w%,:/-]|\.\d|\s*(?:am|pm|km|kg|cm|m\b|days?|weeks?|months?|years?|hours?|'
                  r'minutes?|mins?|people|per\b|%|times|metres|meters|miles|percent))')


def fix_text(t):
    t = t.replace('…', '...').replace('·', '.')
    t = re.sub(r'^[+•●▪◦»]\s*', '• ', t)
    t = t.replace('\uff0b', '+')                     # a "+" the ink says is text, not a bullet (lines.PLUS)
    t = re.sub(r'^e\s+(?=[A-Z])', '• ', t)          # tesseract's reading of a bullet
    t = re.sub(r'\s+([,;:])', r'\1', t)
    return t.strip()


def letter_range(text):
    m = re.search(r'\b([A-L])\s*[-–—]\s*([A-L])\b', text)
    if m and m.group(1) < m.group(2):
        return [chr(c) for c in range(ord(m.group(1)), ord(m.group(2)) + 1)]
    m = re.search(r'\bA,\s*B(?:,\s*[C-K])*,?\s+or\s+([B-L])\b', text)
    if m:
        return [chr(c) for c in range(ord('A'), ord(m.group(1)) + 1)]
    return None


def as_roman(tok):
    """'il', 'Iii', 'vil', '1' -> the numeral OCR meant, or None."""
    t = tok.strip('.)').replace('l', 'i').replace('I', 'i').replace('1', 'i').replace('|', 'i').replace('V', 'v').replace('X', 'x')
    return t if re.fullmatch(ROMAN, t) else None


def label_of(t, lo, hi, roman=False):
    """Leading label of a row: ('n', 12, rest) | ('o', 'B', rest) | ('r', 'iv', rest) | ('u', None, rest) | (None, None, t)."""
    if t.startswith(UNKNOWN):
        return 'u', None, t[len(UNKNOWN):].strip()
    m = re.match(r'^(\d{1,2})[.)]?(?:\s+|$|(?=[A-Z][a-z]))', t)
    if m and lo <= int(m.group(1)) <= hi:
        return 'n', int(m.group(1)), t[m.end():]
    if roman:
        m = re.match(r'^([ivxlI1|]{1,5})[.)]?(?:\s+)(?=\S)', t)
        if m and as_roman(m.group(1)) and not (m.group(1) in ('I', '1') and not re.match(r'^[I1]\s+[A-Z]', t)):
            return 'r', as_roman(m.group(1)), t[m.end():]
    m = re.match(r'^([A-L])[.)]?(?:\s+|$)', t)
    if m:
        return 'o', m.group(1), t[m.end():]
    return None, None, t


def continues(prev_text, text):
    """Does `text` read as the continuation of `prev_text` (a wrapped line)?"""
    if not prev_text:
        return False
    return text[:1].islower() or not re.search(r'[.?!:]["\')]?$', prev_text.rstrip())


def join(a, b):
    if a.endswith('-') and b[:1].islower() and not a.endswith(' -'):
        return a + b
    return (a + ' ' + b).strip()

# ---------------------------------------------------------------- instructions


def split_instr(rows, lo, hi):
    """Leading rows that tell the candidate what to do, as opposed to the questions themselves."""
    def content_like(t):
        return bool(re.match(r'^(\d{1,2}[.)]?\s|[A-L]\s+\S|•|' + UNKNOWN + ')', t)) and not INSTR.match(t)

    for r in rows[:6]:
        if r['t'].startswith(UNKNOWN) and (STRONG.match(r['t'][1:].strip()) or INSTR.match(r['t'][1:].strip())):
            r['t'] = r['t'][1:].strip()         # a stray mark in front of an instruction
    last = -1
    for i, r in enumerate(rows[:9]):
        t = r['t']
        if content_like(t) or GAP.search(t):
            break
        if STRONG.match(t) or INSTR.match(t):
            last = i
        elif re.search(r'\?$', t) and i == 0:
            pass            # an opening question ("What ability is required for each duty?") counts if an instruction follows
        elif last == i - 1 and i and continues(rows[i - 1]['t'], t) and r['y'] - rows[i - 1]['y1'] < 0.022 and r['page'] == rows[i - 1]['page']:
            last = i        # wrapped instruction line
        elif i and not (last == -1 and i <= 2):
            break
    instr, body = rows[:last + 1], rows[last + 1:]
    # multi-choice: "Choose TWO letters, A-E." is followed by the question itself, which belongs to the body
    return instr, body


def clean_instr(instr):
    """Join wrapped lines and drop answer-sheet wording (the computer test has no answer sheet)."""
    paras = []
    for r in instr:
        t = r['t']
        if paras and not INSTR.match(t) and continues(paras[-1], t):
            paras[-1] = join(paras[-1], t)
        elif paras and re.match(r'^(if the|if it is|than once|each answer|from the)', t):
            paras[-1] = join(paras[-1], t)
        else:
            paras.append(t)
    out = []
    for t in paras:
        if re.match(r'^Write (your answers?|the correct letter[s]?|the correct number|[A-Z ]+) in box(es)? \d+', t) and 'Write the correct letter' not in t \
                and 'Write the correct number' not in t:
            continue
        if re.match(r'^In box(es)? \d+\s*([-–]\s*\d+)? on your answer sheet,? write', t):
            continue
        t = re.sub(r',?\s*in box(es)? \d+\s*([-–]|and)?\s*\d* on your answer sheet', '', t)
        t = re.sub(r'\s*next to [Qq]uestions? \d+\s*[-–]\s*\d+', '', t)
        t = re.sub(r'\s+\.', '.', t).strip()
        t = re.sub(r',\s*\.$', '.', t)
        if re.fullmatch(r'Write the correct (letters?|numbers?)\.?', t):
            continue                    # all that is left of "Write the correct letter in boxes 27-30 on your answer sheet."
        if t:
            out.append(t)
    return out

def unfold_columns(body, lo, hi):
    """Questions set in two columns (1-3 on the left, 4-6 on the right) -> one column, left then right."""
    starts = [l['x'] for r in body for l in r['lines'][1:] if l['x'] > 0.42 and re.match(r'^(\d{1,2}|[A-C])$', l['t'])]
    nums = [int(l['t']) for r in body for l in r['lines'] if l['x'] > 0.42 and l['t'].isdigit() and lo <= int(l['t']) <= hi]
    left_nums = [int(m.group(1)) for r in body for m in [re.match(r'^(\d{1,2})\b', r['t'])] if m and r['x'] < 0.2 and lo <= int(m.group(1)) <= hi]
    if len(nums) < 2 or len(left_nums) < 2 or min(nums) <= max(left_nums) or len(starts) < 4:
        return body
    split = min(starts) - 0.03
    from lines import rows as make_rows
    head = [r for r in body if r['y'] < min(rr['y'] for rr in body if any(l['x'] > split and l['t'].isdigit() for l in rr['lines'])) - 0.005
            and r['page'] == body[0]['page']]
    rest = [r for r in body if r not in head]
    page = rest[0]['page'] if rest else None
    cols = []
    for side in (lambda l: l['x'] < split, lambda l: l['x'] >= split):
        ls = [l for r in rest if r['page'] == page for l in r['lines'] if side(l)]
        rs = make_rows(ls)
        for r in rs:
            r['t'] = fix_text(r['t'])
        cols += rs
    return head + cols + [r for r in rest if r['page'] != page]


def unfold_side_options(body, lo, hi):
    """Numbered items on the left with the list of options beside them on the right -> items, then options."""
    right = [l['x'] for r in body if re.search(r'\b\d{1,2}\b', r['lines'][0]['t']) for l in r['lines'][1:]
             if l['x'] > 0.35 and re.match(r'^[A-L]\s+\S', l['t'])]
    if len(right) < 2:
        return body
    split = min(right) - 0.02
    from lines import rows as make_rows
    first = next(i for i, r in enumerate(body) if any(l['x'] > split and re.match(r'^[A-L]\s+\S', l['t']) for l in r['lines']))
    head, rest = body[:first], body[first:]
    out = []
    for side in (lambda l: l['x'] < split, lambda l: l['x'] >= split):
        rs = make_rows([l for r in rest for l in r['lines'] if side(l)])
        for r in rs:
            r['t'] = fix_text(r['t'])
        out += rs
    return head + out


# ---------------------------------------------------------------- shared row helpers


def out_row(src, x_base, **kw):
    row = {'i': min(3, max(0, round((src['x'] - x_base) / 0.035))), '_x1': src.get('x1', 0)}
    row.update(kw)
    return row


_BOX = [0.07, 0.93]        # left and right edge of the group being built (set by build_group)


def is_title(r, t):
    """A short line centred in the block: the title of a set of notes."""
    if len(t) >= 60 or GAP.search(t) or re.match(r'^(\d|•)', t):
        return False
    left, right = _BOX
    mid = (r['x'] + r['x1']) / 2
    return (r['x'] > 0.3 and r['x1'] < 0.8) or (r['x'] - left > 0.07 and right - r['x1'] > 0.07 and abs(mid - (left + right) / 2) < 0.06)


def find_gaps(t, lo, hi, item=None):
    """Split a row's text at its gaps. Returns segments: str | {'g': q} | {'g': None, 'hint': digits}."""
    segs, pos = [], 0
    for m in GAP.finditer(t):
        q = int(m.group(1)) if m.group(1) and lo <= int(m.group(1)) <= hi else None
        pre = t[pos:m.start()]
        hint = None
        if m.group(1) and q is None:
            hint = m.group(1)            # a number sits before the dots but is not a question number here (yet)
        if q is None and item is not None:
            q, item = item, None
        if pre.strip() or (pre and segs):
            segs.append(pre)
        segs.append({'g': q, 'hint': hint} if q is None else {'g': q})
        pos = m.end()
    if t[pos:].strip():
        segs.append(t[pos:])
    return segs


def number_gaps(rows, lo, hi):
    """Give every gap its question number. Gaps appear in question order, so the numbered ones anchor the rest."""
    gaps = [(r, k) for r in rows for k, s in enumerate(r['t']) if isinstance(s, dict)]
    # the worked example ("Example ... 200 ...") is not a question
    for r in rows:
        if r.get('ex'):
            r['t'] = [s if isinstance(s, str) else ' ' for s in r['t']]
    gaps = [(r, k) for r, k in gaps if not r.get('ex')]
    # an explicit number that breaks the order was misread: forget it and let the sequence decide
    last = lo - 1
    for r, k in gaps:
        g = r['t'][k]
        if g['g'] is not None:
            if g['g'] <= last:
                g['g'] = None
            else:
                last = g['g']
    known = [(i, r['t'][k]['g']) for i, (r, k) in enumerate(gaps) if r['t'][k]['g'] is not None]
    bounds = [(-1, lo - 1)] + known + [(len(gaps), hi + 1)]
    for (i0, q0), (i1, q1) in zip(bounds, bounds[1:]):
        free = list(range(i0 + 1, i1))
        if free and len(free) == q1 - q0 - 1:
            for n, i in enumerate(free):
                r, k = gaps[i]
                r['t'][k]['g'] = q0 + 1 + n
    for r, k in gaps:
        g = r['t'][k]
        hint = g.pop('hint', None)
        if g['g'] is None:
            r['t'][k] = (hint + ' ' if hint else '') + '……'
        elif k and isinstance(r['t'][k - 1], str):
            prev = r['t'][k - 1]
            # the question number printed before a currency sign or bracket: "is 2 £ ......" is "£" and gap 2
            # ... and before the quotation mark of a quoted gap: "called 4 '......'" is "called '" and gap 4
            m = re.search(r'(?:^|\s)' + str(g['g']) + r'\s*([£$€(\'"])[.\s]*$', prev)
            if m and len(prev.strip()) > len(m.group(0).strip()):
                r['t'][k - 1] = prev = prev[:m.start()] + ' ' + m.group(1)
            # drop a misread copy of the question number left in the text ("in a narrow 2" before gap 26)
            m = re.search(r'(?:^|\s)(\d{1,2})\s*$', prev)
            if m and (m.group(1) in str(g['g']) or str(g['g']) in m.group(1)) and int(m.group(1)) != g['g'] and len(prev.strip()) > len(m.group(1)):
                r['t'][k - 1] = prev[:m.start()] + ' '
    for r in rows:
        r['t'] = [s for s in r['t'] if s != '']


def bare_numbers(rows, lo, hi):
    """A question number printed without (OCR-visible) dots is still an answer gap."""
    def gap_list():
        return [s['g'] for r in rows for s in r['t'] if isinstance(s, dict)]

    for r in rows:
        if r.get('ex'):
            continue
        out = []
        for s in r['t']:
            if not isinstance(s, str):
                out.append(s); continue
            pos = 0
            for m in BARE.finditer(s):
                q = int(m.group(1))
                seen = gap_list() + [x['g'] for x in out if isinstance(x, dict)]
                if not (lo <= q <= hi) or q in seen:
                    continue
                # it must fit the order: every gap before it is smaller (those after are checked by check.py)
                before = [x['g'] for rr in rows[:rows.index(r)] for x in rr['t'] if isinstance(x, dict)] + [x['g'] for x in out if isinstance(x, dict)]
                if any(b > q for b in before):
                    continue
                out.append(s[pos:m.start()])
                out.append({'g': q})
                pos = m.end()
                mm = re.match(r'\s*[.…]+', s[pos:])
                if mm:
                    pos += mm.end()
            out.append(s[pos:])
        r['t'] = [s for s in out if s != '']


def glued_numbers(rows, lo, hi):
    """Last resort for a question still without a gap: its number stuck to a neighbour ("A5. is provided").

    Only rows between the gaps of the questions before and after it are searched, so a stray digit elsewhere
    cannot be taken for it.
    """
    def where(q):
        return next((i for i, r in enumerate(rows) if any(isinstance(s, dict) and s['g'] == q for s in r['t'])), None)

    for q in range(lo, hi + 1):
        if where(q) is not None:
            continue
        before = max([i for p in range(lo, q) for i in [where(p)] if i is not None], default=0)
        after = min([i for p in range(q + 1, hi + 1) for i in [where(p)] if i is not None], default=len(rows) - 1)
        hits = []
        for i in range(before, after + 1):
            r = rows[i]
            if r.get('ex'):
                continue
            for k, s in enumerate(r['t']):
                if isinstance(s, str):
                    for m in re.finditer(r'(?<!\d)' + str(q) + r'(?!\d)[.…]*', s):
                        # in the row of the previous question it must come after that gap, and before the next one's
                        gaps_here = [(kk, x['g']) for kk, x in enumerate(r['t']) if isinstance(x, dict)]
                        if any(kk > k and g < q for kk, g in gaps_here) or any(kk < k and g > q for kk, g in gaps_here):
                            continue
                        hits.append((r, k, m))
        if len(hits) == 1:
            r, k, m = hits[0]
            s = r['t'][k]
            r['t'][k:k + 1] = [x for x in (s[:m.start()].rstrip() + ' ' if s[:m.start()].strip() else '', {'g': q}, s[m.end():]) if x != '']


def merge_wrapped(rows):
    """Join a plain row to the row above when it is the rest of the same sentence."""
    out = []
    for r in rows:
        if out and r.get('t') and isinstance(r['t'][0], dict) and not any(k in r for k in ('n', 'o', 'r', 'c', 'fb', 'ctl', 'ex', 'li', 'b')):
            p = out[-1]
            last = p['t'][-1] if p.get('t') else None
            if isinstance(last, str) and not re.search(r'[.?!:]\s*$', last) and not any(k in p for k in ('c', 'o', 'r', 'fb', 'ex')) \
                    and len(last) > 12:
                p['t'] = p['t'][:-1] + [last.rstrip() + ' '] + r['t']       # the gap alone at the start of a wrapped line
                p['_x1'] = r.get('_x1', 0)
                continue
        if out and not any(k in r for k in ('n', 'o', 'r', 'c', 'fb', 'ctl', 'ex', 'li', 'b')) and r.get('t'):
            p = out[-1]
            first = r['t'][0]
            last = p['t'][-1] if p.get('t') else None
            plain_p = ''.join(x for x in p.get('t', []) if isinstance(x, str))
            # running prose (a summary): the line above reaches the right-hand edge and does not end its sentence
            if (isinstance(first, str) and isinstance(last, str) and not re.search(r'[.?!:]\s*$', last) and not first.startswith(('•', '-', '–'))
                    and p.get('_x1', 0) > _BOX[1] - 0.05 and not any(k in p for k in ('c', 'o', 'r', 'fb', 'ex', 'b'))
                    and r.get('i', 0) == p.get('i', 0) and len(plain_p) > 40):
                p['t'] = p['t'][:-1] + [join(last.rstrip(), first)] + r['t'][1:]
                p['_x1'] = r.get('_x1', 0)
                continue
            if (isinstance(first, str) and first[:1].islower() and isinstance(last, str) and not re.search(r'[.?!:]\s*$', last)
                    and (len(plain_p) > 40 or 'r' in p or 'o' in p or 'n' in p) and r.get('i', 0) >= p.get('i', 0) - 1
                    and 'fb' not in p and 'c' not in p and not first.startswith('•')):
                p['t'] = p['t'][:-1] + [join(last.rstrip(), first)] + r['t'][1:]
                continue
        out.append(r)
    return out

# ---------------------------------------------------------------- parsers per question type


def logical_rows(body, lo, hi):
    """Physical rows -> the rows the writer meant: a list item with the lines it wraps onto, as one row.

    The print shows which is which. An item starts with its mark (a bullet, a dash, a question number) in one
    column and its text in the next; a line that starts in the text column with no mark of its own is the rest
    of the item above. Returns copies of the rows with 'li' ('dot', 'dash' or None), the mark taken off the text.
    """
    out = []
    for r in body:
        t, mark = r['t'], None
        m = re.match(r'^([•–-])\s+(?=\S)', t)
        # a dash the ink did not confirm as a list mark may be a minus or a range ("- 5 degrees")
        if m and (m.group(1) == '•' or r.get('bul') == 'dash' or not t[m.end():m.end() + 1].isdigit()
                  or re.match(r'\d{1,2}\s*[.…]{2,}', t[m.end():])):          # "- 9 ......": an item that starts with its gap
            mark = 'dot' if m.group(1) == '•' else 'dash'
            t = re.sub(r'^[-–]\s*(?=[A-Za-z])', '', t[m.end():])      # a dash typed after the list mark as well
        p = out[-1] if out else None
        if p is not None and mark is None and _continues_item(p, r, t, lo, hi):
            p['t'] = join(p['t'], t)
            p['x1'], p['y1'], p['_last'] = max(p['x1'], r['x1']), r['y1'], r
            p['lines'] = p['lines'] + r['lines']
            if r.get('bm') is not None:
                p['bm'] = r['bm'] if p.get('bm') is None else min(p['bm'], r['bm'])
                p['bold'] = p['bm'] >= 0
            continue
        out.append(dict(r, t=t, li=mark, _last=r))
    return out


def _continues_item(p, r, t, lo, hi):
    """Is row r (text t, no list mark) the wrapped end of item p?"""
    last = p['_last']
    if r['page'] != last['page'] or not (0 < r['y'] - last['y'] < 0.05) or r['y'] - last['y1'] > 0.02:
        return False
    if r.get('bold') and p.get('bold') is False:
        return False                    # a heading under an item
    indent = r['tx'] - p['mx']
    if p.get('li'):
        # under a bullet: in line with the item's text (which starts after the bullet)
        return indent >= 0.008 and abs(r['tx'] - p['tx']) <= 0.014 and p['tx'] - p['mx'] >= 0.008
    kind, val, rest = label_of(p['t'], lo, hi)
    if kind == 'n' and not re.match(r'^[.…]', rest):
        # under a numbered sentence: indented past the number, and not a row with a number of its own there
        if not 0.012 <= indent <= 0.09:
            return False
        if re.search(r'[.?!]["\')]?$', p['t'].rstrip()) and t[:1].isupper():
            return False                # the sentence above is finished and this starts a new one
        return True
    return False


def set_levels(rows, srcs):
    """Indent level (0-3) of each built row: its start - list mark or text - ranked among the starts in the group."""
    xs = sorted(src['mx'] for row, src in zip(rows, srcs) if not row.get('c'))
    cols = []
    for x in xs:
        if cols and x - cols[-1][-1] <= 0.012:
            cols[-1].append(x)
        else:
            cols.append([x])
    # the base level is the leftmost start that several rows share: one stray row further left (debris in the
    # margin, a label) must not push every other row in by a level
    need = 2 if len(xs) >= 6 else 1
    while len(cols) > 1 and len(cols[0]) < need:
        cols.pop(0)
    centres = [sum(c) / len(c) for c in cols]
    for row, src in zip(rows, srcs):
        if row.get('c') or not centres:
            row['i'] = 0
            continue
        row['i'] = min(3, min(range(len(centres)), key=lambda k: abs(centres[k] - src['mx'])))


def parse_text(body, lo, hi, x_base):
    """Notes / form / sentence / summary completion: text with numbered gaps."""
    rows, srcs = [], []
    example_next = 0
    for r in logical_rows(body, lo, hi):
        t = r['t']
        if re.fullmatch(r'Example:?', t):
            example_next = 2; continue
        kind, val, rest = label_of(t, lo, hi)
        item = None
        if kind == 'n' and not re.match(r'^[.…]', rest):
            item, t = val, rest
        elif kind == 'n':
            t = f'{val} {rest}'
        elif kind == 'u':
            t = rest
        m = re.match(r'^Example:?\s+(.*)$', t)
        if m:
            t, example_next = m.group(1), 1
        row = out_row(r, x_base)
        if is_title(r, t) and item is None and not r.get('li'):
            row['c'] = 1
        if r.get('li'):
            row['li'] = r['li']
        row['t'] = find_gaps(t, lo, hi, item)
        row['_bm'] = r.get('bm')
        if item is not None and not any(isinstance(s, dict) for s in row['t']):
            # "7 What do they do?" - a short-answer question: the answer box goes after it
            row['n'] = item; row['ctl'] = 1
        if example_next and any(isinstance(s, dict) for s in row['t']) and not any(isinstance(s, dict) and s['g'] is not None for s in row['t']):
            row['ex'] = 1; example_next = 0
        elif example_next:
            example_next -= 1
        if row['t'] or 'n' in row:
            rows.append(row); srcs.append(r)
    set_levels(rows, srcs)
    number_gaps(rows, lo, hi)
    bare_numbers(rows, lo, hi)
    glued_numbers(rows, lo, hi)
    gapped = [s['g'] for r in rows for s in r['t'] if isinstance(s, dict)]
    for r in rows:
        # "37 degrees ..." at the start of a line is text, not question 37, when 37 has its gap elsewhere
        if r.get('ctl') and r.get('n') in gapped:
            r['t'] = [f"{r.pop('n')} " + (r['t'][0] if r['t'] and isinstance(r['t'][0], str) else '')] + r['t'][1:]
            del r['ctl']
    measured = any(r.get('_bm') is not None for r in rows)
    for i, r in enumerate(rows):
        t0 = r['t'][0] if len(r['t']) == 1 and isinstance(r['t'][0], str) else None
        if not t0 or any(k in r for k in ('c', 'n', 'ex', 'li')):
            continue
        over_list = i + 1 < len(rows) and len(t0) < 60 and t0[:1].isupper() and not re.search(r'[.,;:]$', t0) and bool(rows[i + 1].get('li'))
        bm = r.get('_bm')
        if measured and bm is not None:
            # a line printed bold throughout, with no gap in it, is a sub-heading; when the weight is too close
            # to call (a soft scan, a heading in colour) its place over a list decides
            if len(t0) < 90 and (bm >= 0.06 or (bm > -0.06 and over_list)):
                r['b'] = 1
        elif over_list:
            r['b'] = 1          # no measurement: a short line over a list of bullet points is a sub-heading
    for r in rows:
        r.pop('_bm', None)
    answered = set(gapped) | {r['n'] for r in rows if r.get('ctl')}
    if answered >= set(range(lo, hi + 1)):
        # every question has its gap: dots left over are rules, borders or the wrapped end of a long gap
        for r in rows:
            r['t'] = [s for s in r['t'] if s != '……']
            r['t'] = [re.sub(r'\s*……\s*', ' ', s) if isinstance(s, str) else s for s in r['t']]
        rows = [r for r in rows if any(isinstance(s, dict) or s.strip() for s in r['t']) or r.get('ctl')]
    return rows


def split_option_columns(r, opts):
    """A row of a multi-column option box ("A absorb   D dig   G gather") -> [(letter, text, position)] or None.

    OCR returns such a row in any mixture: the letter as its own fragment, glued to its text, or several
    options in one fragment. So the fragments are flattened to tokens and cut again at every label.
    """
    toks = []          # (text, is_label_candidate, x)
    for l in r['lines']:
        t = re.sub(r'^[•*·]\s+', UNKNOWN + ' ', fix_text(l['t']))
        words = t.split()
        if len(words) == 1 and len(t) <= 2 and l.get('src') in ('g', 't') and not re.fullmatch(r'[A-L]', t):
            words = [UNKNOWN]          # a recovered mark in a label position that was misread ("2" for "E")
        for k, w in enumerate(words):
            toks.append((w, l['x'] + l['w'] * k / max(1, len(words))))
    parts, cur = [], None
    for w, x in toks:
        is_label = re.fullmatch(r'[A-L' + UNKNOWN + r'][.)]?', w) is not None
        if is_label and (cur is None or cur[1]):
            cur = [w.rstrip('.)'), [], x]
            parts.append(cur)
        elif cur is None:
            return None
        else:
            cur[1].append(w)
    if len(parts) < 2 or any(not p[1] or len(' '.join(p[1])) > 45 for p in parts):
        return None
    if not any(p[0] != UNKNOWN for p in parts):
        return None
    known = [p[0] for p in parts if p[0] != UNKNOWN]
    if known != sorted(known) or len(set(known)) != len(known):
        return None                    # letters inside a sentence ("vitamin C and B"), not a row of options
    return [(p[0], ' '.join(p[1]), {'x': p[2], 'y': r['y']}) for p in parts]


def fit_options(entries, opts):
    """entries: [{'o': letter or None, ...}] in reading order. Make the letters run exactly through `opts` if possible."""
    if not opts or not entries:
        return
    # more rows than options: an unlabelled row is the wrapped end of the option above it
    while len(entries) > len(opts):
        k = next((i for i, e in enumerate(entries) if i and e.get('o') not in opts and not e.get('_mark')), None)
        if k is None:
            k = next((i for i, e in enumerate(entries) if i and e.get('o') not in opts), None)
        if k is None:
            break
        entries[k - 1]['t'] = [join(entries[k - 1]['t'][0], entries[k]['t'][0])]
        entries[k]['t'] = []
        entries[k]['o'] = None
        del entries[k]
    if len(entries) == len(opts):
        known = [(i, e['o']) for i, e in enumerate(entries) if e.get('o') in opts]
        agree = sum(1 for i, o in known if opts[i] == o)
        if agree >= 0.6 * len(known) or len(known) < len(entries) / 2:
            for e, letter in zip(entries, opts):
                e['o'] = letter
            return
    # fill single holes between known neighbours: A ? C -> B
    for i, e in enumerate(entries):
        if e.get('o') in opts:
            continue
        prev = entries[i - 1].get('o') if i else None
        nxt = entries[i + 1].get('o') if i + 1 < len(entries) else None
        if prev in opts and opts.index(prev) + 1 < len(opts) and (nxt is None or nxt not in opts or opts.index(nxt) == opts.index(prev) + 2):
            e['o'] = opts[opts.index(prev) + 1]
        elif prev is None and nxt in opts and opts.index(nxt) == 1:
            e['o'] = opts[0]


def parse_choice(body, lo, hi, x_base, opts, multi, warn):
    """Multiple choice. Each question is a stem followed by the options A, B, C... in order.

    Rows are collected as pieces: a question or option row plus the plain rows under it. A plain row is
    normally the wrapped end of the line above, but when a letter is missing from the sequence (A, ?, C) the
    plain row in that place is the option whose letter OCR lost.
    """
    k = len(opts)
    labs = [label_of(r['t'], lo, hi) for r in body]
    rows = []
    st = {'item': None, 'got': 0, 'last_n': lo - 1}
    pending = []           # plain rows after a complete option set: tail of the last option, or the next stem

    def add_option(r, text):
        # the letter read twice ("C c Cane sugar ..."): once as the label, once at the start of the text.
        # "a" and "I" are words: "A  a supply of drinking water" keeps its article
        letter = opts[st['got']]
        if letter in 'AI':
            text = re.sub(r'^' + letter + r'[.)]\s+(?=[A-Z])', '', text)
        else:
            text = re.sub(r'^[' + letter + letter.lower() + r'][.)]?\s+(?=[A-Z])', '', text)
        row = out_row(r, x_base, o=opts[st['got']])
        row['i'] = 1
        row['_p'] = [(r, text)]
        if not multi:
            row['q'] = st['last_n']
        rows.append(row)
        st['got'] += 1

    def promote(s):
        """The last s plain rows under the previous row are options whose letters were lost."""
        last = rows[-1] if rows else None
        if last is None or '_p' not in last or len(last['_p']) - 1 < s:
            return False
        if len(last['_p']) - 1 > s:
            warn.append(f'question {st["last_n"] if not multi else lo}: an option letter was not read; which line starts option '
                        f'{opts[st["got"]]} is a guess')
        take = last['_p'][len(last['_p']) - s:]
        del last['_p'][len(last['_p']) - s:]
        for r, text in take:
            add_option(r, text)
        return True

    def close_block():
        if st['item'] is not None and st['got'] < k:
            promote(k - st['got'])

    def new_item(r, n, text):
        close_block()
        row = out_row(r, x_base, n=n)
        row['i'] = 0
        row['_p'] = [(r, text)] if text else []
        rows.append(row)
        st.update(item=row, got=0, last_n=n)

    def flush_pending(as_stem):
        if not pending:
            return
        if as_stem and st['last_n'] < hi:
            while len(pending) > 1 and is_title(*pending[0]):
                r0, t0 = pending.pop(0)
                rows.append(out_row(r0, x_base, t=[t0], c=1))
            while len(pending) > 1 and pending[0][1][:1].islower() and rows and '_p' in rows[-1]:
                rows[-1]['_p'].append(pending.pop(0))     # the wrapped end of the last option
            if len(pending) > 1 and not all(continues(a[1], b[1]) for a, b in zip(pending, pending[1:])):
                warn.append(f'question {st["last_n"] + 1}: its number was not read; where its text starts is a guess')
            text = re.sub(r'^\d{1,2}[.)]?\s+', '', ' '.join(t for _, t in pending))
            new_item(pending[0][0], st['last_n'] + 1, text)
        else:
            for r, t in pending:
                if rows and '_p' in rows[-1] and st['item'] is not None and not is_title(r, t):
                    rows[-1]['_p'].append((r, t))
                else:
                    row = out_row(r, x_base, t=[t])
                    if is_title(r, t):
                        row['c'] = 1
                    rows.append(row)
        pending.clear()

    if multi:
        stem = {'i': 0, 'stem': 1, '_p': []}
        rows.append(stem)
        st['item'] = stem
    # question numbers and option letters sit in two different columns: an unread label is named by its column
    med = lambda xs: sorted(xs)[len(xs) // 2] if xs else None
    num_x = med([r['x'] for r, (kk, _, _) in zip(body, labs) if kk == 'n'])
    opt_x = med([r['x'] for r, (kk, _, _) in zip(body, labs) if kk == 'o'])
    two_cols = num_x is not None and opt_x is not None and opt_x - num_x > 0.015
    skipping = False
    for idx, (r, (kind, val, rest)) in enumerate(zip(body, labs)):
        t = r['t']
        if re.fullmatch(r'Example:?', t) and not multi:
            skipping = True          # the worked example and its options, printed before question 1
            continue
        if skipping and kind != 'n':
            continue
        skipping = False
        later = [(kk, vv) for kk, vv, _ in labs[idx + 1:] if kk in ('n', 'o', 'u')]
        if kind == 'u' and two_cols and not multi and abs(r['x'] - num_x) < abs(r['x'] - opt_x) and st['last_n'] < hi:
            flush_pending(False)
            new_item(r, st['last_n'] + 1, rest)      # an unread mark in the number column
            continue
        if kind == 'n' and val > st['last_n'] and not multi:
            flush_pending(False)
            new_item(r, val, rest)
            continue
        in_block = st['item'] is not None and st['got'] < k
        if kind in ('o', 'u') and in_block:
            expecting = opts[st['got']]
            # "A ..." that is really the stem running on, with the real option A below it
            stray = kind == 'o' and val == expecting == opts[0] and later[:1] == [('o', opts[0])]
            if not stray:
                if kind == 'u' or val == expecting or val not in opts or val in opts[:st['got']]:
                    add_option(r, rest)
                    continue
                if promote(opts.index(val) - st['got']):          # letters were skipped: A, (B lost), C
                    add_option(r, rest)
                    continue
        if kind in ('o', 'u') and not multi and not in_block:
            if kind == 'o' and val == opts[0] and pending and st['last_n'] < hi:
                flush_pending(True)                               # option A of a question whose number was lost
                add_option(r, rest)
                continue
            if kind == 'u' and later[:1] == [('o', opts[0])] and st['last_n'] < hi:
                pending.append((r, rest))                         # an unread question number in front of its stem
                flush_pending(True)
                continue
        text = rest if kind == 'u' else t
        if not multi and not in_block:
            pending.append((r, text))
        else:
            rows[-1]['_p'].append((r, text))
    flush_pending(False)
    close_block()
    for row in rows:
        if '_p' in row:
            text = ''
            for _, piece in row.pop('_p'):
                text = join(text, piece) if text else piece
            row['t'] = [text] if text else []
        row.pop('stem', None)
    return [row for row in rows if row.get('t') or 'n' in row or 'o' in row]


def parse_statements(body, lo, hi, x_base):
    """TRUE/FALSE/NOT GIVEN and YES/NO/NOT GIVEN: one numbered statement per question."""
    rows = []
    for r in body:
        kind, val, rest = label_of(r['t'], lo, hi)
        taken = {x['n'] for x in rows if 'n' in x}
        if kind == 'n' and (val in taken or val < max(taken, default=lo)) and len(r['lines']) > 1:
            kind = 'u'                   # "3" where 5 should be: a misread number, named below from its place
        if kind == 'n' and val not in taken:
            rows.append(out_row(r, x_base, n=val, ctl=1, t=[rest] if rest else []))
        elif kind == 'u':
            rows.append(out_row(r, x_base, u=1, t=[rest]))
        elif rows and rows[-1].get('t') and ('n' in rows[-1] or rows[-1].get('u') or rows[-1].get('p')) and continues(rows[-1]['t'][0], r['t']):
            rows[-1]['t'] = [join(rows[-1]['t'][0], r['t'])]
        else:
            rows.append(out_row(r, x_base, p=1, t=[r['t']]))
    # statements whose number was lost: number them from their place in the sequence
    want = hi - lo + 1
    cand = [x for x in rows if 'n' in x or x.get('u') or (x.get('p') and len(x['t'][0]) > 25 and x['t'][0][:1].isupper())]
    if len(cand) == want and all(x.get('n', lo + i) == lo + i for i, x in enumerate(cand)):
        for i, x in enumerate(cand):
            x['n'] = lo + i; x['ctl'] = 1
            x['t'] = [re.sub(r'^\d{1,2}[.)]?\s+', '', x['t'][0])] if x.get('p') else x['t']
    else:
        for i, x in enumerate(rows):
            if x.get('u') and 'n' not in x:
                before = max([y['n'] for y in rows[:i] if 'n' in y], default=lo - 1)
                after = min([y['n'] for y in rows[i + 1:] if 'n' in y], default=hi + 1)
                if after - before == 2:
                    x['n'] = before + 1; x['ctl'] = 1
    for x in rows:
        x.pop('u', None); x.pop('p', None)
    return rows


def parse_match(body, lo, hi, x_base, opts, key_roman=False):
    """Matching: numbered items answered with a letter (or numeral), usually with a box listing the options."""
    roman = key_roman
    numerals = ROMANS[:len(opts)] if roman and opts else []
    rows, entries = [], []           # entries: option-box rows, in reading order
    med = lambda xs: sorted(xs)[len(xs) // 2] if xs else None
    labs0 = [(r['x'], label_of(r['t'], lo, hi, roman=roman)[0]) for r in body]
    num_x = med([x for x, k in labs0 if k == 'n'])
    opt_x = med([x for x, k in labs0 if k in ('o', 'r')])
    in_list = False                  # inside the heading / option list
    example = False                  # the row after "Example" is the worked example, not a question
    for r in body:
        t = r['t']
        if re.match(r'^(List of [A-Z]\w+( \w+)?$|Example\b)', t):
            in_list = t.startswith('List')
            example = not in_list
            if t.startswith('List'):
                rows.append(out_row(r, x_base, c=1, t=[t]))
            continue
        if re.match(r'^(Paragraph|Section)\s+[A-L]\b', t):
            if example:
                example = False        # "Example: Paragraph A - iv", printed before the questions
                continue
            rows.append(out_row(r, x_base, u=1, t=[t])); in_list = False
            continue
        example = False
        cols = None if roman else split_option_columns(r, opts)
        if cols:
            for letter, text, l in cols:
                row = {'i': 0, 'o': None if letter == UNKNOWN else letter, 't': [text], 'box': 1, '_x': l['x'], '_y': l['y']}
                rows.append(row); entries.append(row)
            continue
        if t.startswith('• ') and rows and ('o' in rows[-1] or 'r' in rows[-1]):
            t = UNKNOWN + t[1:]          # an option letter read as a bullet
        kind, val, rest = label_of(t, lo, hi, roman=roman)
        taken = {x['n'] for x in rows if 'n' in x}
        if kind == 'n' and val not in taken:
            in_list = False
            segs = [s for s in find_gaps(rest, lo, hi) if isinstance(s, str)]
            rows.append(out_row(r, x_base, n=val, ctl=1, t=[' '.join(s.strip() for s in segs).strip()] if segs else [], _sx=r['x']))
        elif kind == 'r' and roman:
            row = out_row(r, x_base, r=val, t=[rest]); row['i'] = 0
            rows.append(row); entries.append(row); in_list = True
        elif kind == 'o' and not roman and (not opts or val in opts) and rest:
            row = out_row(r, x_base, o=val, t=[rest], box=1, _sx=r['x']); row['i'] = 0
            row['_x'], row['_y'] = r['x'], r['y']
            rows.append(row); entries.append(row)
        elif kind == 'u':
            prev = next((x for x in reversed(rows) if any(k in x for k in ('n', 'o', 'r'))), None)
            by_column = None
            if num_x is not None and opt_x is not None and abs(opt_x - num_x) > 0.03:
                by_column = 'o' if abs(r['x'] - opt_x) < abs(r['x'] - num_x) else 'n'
            if by_column == 'o' or (by_column is None and (in_list or (prev is not None and ('o' in prev or 'r' in prev)) or (prev is None and roman))):
                row = out_row(r, x_base, t=[rest]); row['i'] = 0
                row['r' if roman else 'o'] = None
                row['_mark'] = 1
                if not roman:
                    row['box'] = 1; row['_x'], row['_y'] = r['x'], r['y']
                rows.append(row); entries.append(row)
            else:
                rows.append(out_row(r, x_base, u=1, t=[rest]))
        elif rows and ('n' in rows[-1] or 'o' in rows[-1] or 'r' in rows[-1]) and rows[-1].get('t') and not is_title(r, t) \
                and (t[:1].islower() if 'r' in rows[-1] else continues(rows[-1]['t'][0], t)) and not GAP.fullmatch(t) \
                and r['x'] > rows[-1].get('_sx', 0) - 0.01:      # a wrapped line never starts left of its label
            rows[-1]['t'] = [join(rows[-1]['t'][0], t)]
        elif roman and in_list and not is_title(r, t):
            # a heading whose numeral was not read at all
            row = out_row(r, x_base, r=None, t=[t]); row['i'] = 0
            rows.append(row); entries.append(row)
        elif not roman and opts and len(t) < 60 and not GAP.search(t) and (in_list or (rows and 'o' in rows[-1])) \
                and len(entries) < len(opts):
            # inside the option list: an option whose letter was not read at all
            row = out_row(r, x_base, o=None, t=[t], box=1); row['i'] = 0
            row['_x'], row['_y'] = r['x'], r['y']
            rows.append(row); entries.append(row)
        elif GAP.fullmatch(t):
            continue
        else:
            row = out_row(r, x_base, t=[t])
            if is_title(r, t):
                row['c'] = 1
            rows.append(row)
    # ---- options: make the letters / numerals run in order
    if roman:
        fit_options_generic(entries, numerals or ROMANS, 'r')
    else:
        ordered = order_box(entries, opts)
        if entries and ordered != entries:
            at = min(rows.index(e) for e in entries)       # keep the box together where its first entry was
            for e in entries:
                rows.remove(e)
            rows[at:at] = ordered
            entries = ordered
        fit_options(entries, opts)
    # ---- items whose number was lost
    want = hi - lo + 1
    numbered = [i for i, x in enumerate(rows) if 'n' in x]
    if numbered and len(numbered) < want:
        for i in range(numbered[0], numbered[-1]):
            x = rows[i]
            if not any(k in x for k in ('n', 'o', 'r', 'c', 'u')) and x.get('t') and x['t'][0][:1].isupper() and len(x['t'][0]) > 12:
                x['u'] = 1
    items = [x for x in rows if 'n' in x or x.get('u')]
    if len(items) == want and all(x.get('n', lo + i) == lo + i for i, x in enumerate(items)):
        for i, x in enumerate(items):
            x['n'] = lo + i; x['ctl'] = 1
    for i, x in enumerate(rows[:-1]):
        # a line over the numbered items names what they are ("Collections", "Hotels"): a sub-heading
        if not any(k in x for k in ('n', 'o', 'r', 'c', 'u')) and x.get('t') and 'n' in rows[i + 1] and len(x['t'][0]) < 70:
            x['b'] = 1
    for x in rows:
        if x.pop('u', None) and 'n' not in x:
            pass
        x.pop('_x', None); x.pop('_y', None); x.pop('_mark', None); x.pop('_sx', None)
    rows = [x for x in rows if not (('o' in x and x['o'] is None) or ('r' in x and x['r'] is None)) or x.get('t')]
    for x in rows:
        if x.get('o', 1) is None:
            del x['o']; x.pop('box', None)
        if x.get('r', 1) is None:
            del x['r']
    return rows


def attach_box_tails(entries, tails):
    """Second lines of options in a multi-column box: each belongs to the option above it in the same column."""
    left = []
    for r in tails:
        for l in r['lines']:
            t = fix_text(l['t'])
            above = [e for e in entries if '_y' in e and e['_y'] < l['y'] and e['_x'] <= l['x'] + 0.015]
            if not t or not above or GAP.search(t):
                left.append(r); break
            col_x = max(e['_x'] for e in above)
            e = max((e for e in above if abs(e['_x'] - col_x) < 0.03), key=lambda e: e['_y'])
            e['t'] = [join(e['t'][0], t)]
    return left


def order_box(entries, opts):
    """Put the entries of an option box in letter order. A box set in columns may run across or down."""
    def cols_of(es):
        xs = []
        for x in sorted({round(e['_x'], 2) for e in es}):
            if not xs or x - xs[-1] > 0.08:
                xs.append(x)
        return xs

    if not entries or not all('_x' in e for e in entries):
        return entries
    xs = cols_of(entries)
    col = lambda e: min(range(len(xs)), key=lambda c: abs(xs[c] - e['_x']))
    across = sorted(entries, key=lambda e: (round(e['_y'] / 0.012), col(e)))
    down = sorted(entries, key=lambda e: (col(e), e['_y']))

    def ascending(es):
        known = [opts.index(e['o']) for e in es if e.get('o') in (opts or [])]
        return all(a < b for a, b in zip(known, known[1:]))
    for order in (across, down):
        if ascending(order):
            return order
    return entries


def fit_options_generic(entries, seq, field):
    for e in entries:
        e['o'] = e.get(field)
    fit_options(entries, seq)
    for e in entries:
        e[field] = e.pop('o')

# ---------------------------------------------------------------- one group


def framed(book, rows):
    """Do these rows stand inside a ruled frame on the page - a box of notes, a form?"""
    if not book or not rows:
        return False
    from lines import page_ink
    inside = 0
    for r in rows:
        ink = _INK.get((book, r['page']))
        if ink is None:
            ink = _INK[(book, r['page'])] = page_ink(book, r['page']) or {'boxes': []}
        cx, cy = (r['x'] + r['x1']) / 2, (r['y'] + r['y1']) / 2
        inside += any(b[0] - 0.01 <= cx <= b[2] + 0.01 and b[1] - 0.01 <= cy <= b[3] + 0.01 for b in ink['boxes'])
    return inside >= 0.7 * len(rows)


_INK = {}


def build_group(g, key, force_fig=False, book=None):
    lo, hi = g['from'], g['to']
    rows = [dict(r, t=fix_text(r['t'])) for r in g['rows']]
    rows = [r for r in rows if r['t'] and r['t'] != UNKNOWN]
    # a row made only of recovered marks, one of them unreadable, is debris (a logo, a smudge at the foot of the page)
    rows = [r for r in rows if not (UNKNOWN in r['t'] and all(l.get('src') == 'g' for l in r['lines']) and not GAP.search(r['t']))]
    for r in rows:
        r['t'] = re.sub(r'(?<=\S)\s*' + UNKNOWN, '', r['t']).strip()       # unread marks inside a row are noise
        r['t'] = re.sub('^' + UNKNOWN + r'\s*(?=[•–]\s)', '', r['t'])       # ... and so is one in front of a bullet
        # a question number or option letter that is also set with a bullet (a retyped book): the label is enough
        r['t'] = re.sub(r'^(\d{1,2}[.)]?|[A-L][.)]?)\s+[•–]\s+(?=\S)', r'\1 ', r['t'])
    # the header row of an answer grid ("A B C D E F G" over empty cells) is not text
    rows = [r for r in rows if not re.fullmatch(r'[A-L](\s+[A-L]){2,}', r['t'])]
    instr, body = split_instr(rows, lo, hi)
    body = unfold_columns(body, lo, hi)
    body = unfold_side_options(body, lo, hi)
    if g.get('pre'):
        # rows printed before the first "Questions" heading (e.g. a title): keep them only if they look like content
        body = [dict(r, t=fix_text(r['t'])) for r in g['pre'] if not INSTR.match(r['t'])] + body
    itext = ' '.join(r['t'] for r in instr)

    # -------- kind
    kv = [key.get(str(q), {}) for q in range(lo, hi + 1)]
    shows = [k.get('show', '') for k in kv]
    plain = [s for s in shows if s and '(either order)' not in s]
    kind, opts, fig = 'text', None, False
    if 'NOT GIVEN' in itext and 'YES' in itext:
        kind = 'ynng'
    elif 'NOT GIVEN' in itext:
        kind = 'tfng'
    elif (re.search(r'Choose (TWO|THREE|FOUR|FIVE)\b', itext, re.I) and not re.search(r'from the box|next to (the )?[Qq]uestions?', itext)) \
            or (hi > lo and all(k.get('set') for k in kv)):
        kind = 'multi'
    elif re.search(r'heading', itext, re.I):
        kind = 'roman'
    elif re.search(r'letter', itext, re.I) or re.search(r'\b[A-L]\s*[-–—]\s*[A-L]\b', itext):
        kind = 'mcq' if re.search(r'Choose the (correct|best|appropriate) letter|Choose (one|the correct) answer', itext, re.I) else 'match'
    if re.search(r'\b(Label the|Complete the (table|flow-?chart|diagram|chart)|flow-?chart|diagram|map|plan)\b', itext, re.I):
        fig = True
    if force_fig:
        fig = True          # overrides.json "fig": a layout too irregular to rebuild - show the book's own picture
    # the answer key has the last word on the kind
    if plain and all(s in ('TRUE', 'FALSE', 'NOT GIVEN') for s in plain):
        kind = 'tfng'
    elif plain and all(s in ('YES', 'NO', 'NOT GIVEN') for s in plain):
        kind = 'ynng'
    elif plain and all(re.fullmatch(ROMAN, s) for s in plain):
        kind = 'roman'
    elif plain and all(re.fullmatch(r'[A-L]', s) for s in plain) and kind not in ('mcq', 'match', 'multi'):
        kind = 'match'
    elif plain and not all(re.fullmatch(r'[A-L]', s) for s in plain) and kind in ('mcq', 'match', 'roman'):
        kind = 'text'
    if kind == 'match' and not fig:
        # options printed under every question = multiple choice, whatever the instructions were read as
        n_a = sum(1 for r in body if re.match(r'^A[.)]?\s+\S', r['t']))
        if n_a >= max(2, (hi - lo + 1) - 1) and hi > lo:
            kind = 'mcq'
    if kind == 'tfng':
        opts = ['TRUE', 'FALSE', 'NOT GIVEN']
    elif kind == 'ynng':
        opts = ['YES', 'NO', 'NOT GIVEN']
    elif kind == 'roman':
        m = re.search(r'\bi\s*[-–—]\s*(' + ROMAN + r')\b', itext)
        if m:
            n = ROMANS.index(m.group(1)) + 1
        else:
            n = max([ROMANS.index(s) + 1 for s in plain if s in ROMANS]
                    + [sum(1 for r in body if label_of(r['t'], lo, hi, roman=True)[0] == 'r'), 1])
        opts = ROMANS[:n]
    elif kind in ('mcq', 'multi', 'match'):
        opts = letter_range(itext)
        key_letters = [s for s in plain if re.fullmatch(r'[A-L]', s)] + [v.upper() for k in kv for v in k.get('vals', [])]
        if kind == 'mcq' and not opts:
            # how many options does each question have? count the rows between two questions
            found = sorted({m.group(1) for r in body for m in [re.match(r'^([A-L])[.)]?\s+\S', r['t'])] if m})
            top = max(found + key_letters) if found + key_letters else 'C'
            opts = [chr(c) for c in range(ord('A'), ord(max(top, 'C')) + 1)]
        elif not opts:
            found = sorted({m.group(1) for r in body for m in [re.match(r'^([A-L])[.)]?\s+\S', r['t'])] if m})
            top = max(found + key_letters) if found + key_letters else 'C'
            opts = [chr(c) for c in range(ord('A'), ord(top) + 1)]
        if key_letters and max(key_letters) > opts[-1]:
            opts = [chr(c) for c in range(ord('A'), ord(max(key_letters)) + 1)]
    for r in body:
        # a recovered mark in the label position that reads as neither a question number nor a letter ("6" for "B")
        first = r['lines'][0]
        if len(r['lines']) > 1 and first.get('src') in ('g', 't') and len(first['t']) <= 2 and r['t'].startswith(first['t'] + ' '):
            tok = first['t']
            ok = (re.fullmatch(r'[A-L]', tok) and (not opts or kind == 'roman' or tok in opts or kind in ('tfng', 'ynng', 'text'))) \
                or (tok.isdigit() and lo <= int(tok) <= hi) or (kind == 'roman' and as_roman(tok)) or tok in '•-'
            if not ok:
                r['t'] = UNKNOWN + r['t'][len(tok):]
        elif len(r['lines']) > 1 and len(first['t']) <= 2 and not re.search(r'\w', first['t']) and first['t'] not in '•-–' \
                and r['t'].startswith(first['t'] + ' ') and kind != 'text':
            r['t'] = UNKNOWN + r['t'][len(first['t']):]      # "<", "*": a label read as a symbol
        if kind in ('mcq', 'multi') and r['t'].startswith('• '):
            r['t'] = UNKNOWN + r['t'][1:]            # choices have no bullets: this is an option letter read as one
    if kind != 'text':
        body = [r for r in body if not re.fullmatch(r'[.…·_\s]+', r['t'])]      # rows of dots only: borders, rules
    limit = None
    m = re.search(r'(ONE WORD(?: AND/OR A NUMBER| ONLY)?|NO MORE THAN [A-Z]+ WORDS?(?: AND/OR A NUMBER)?|[A-Z]+ WORDS? AND/OR A NUMBER|ONLY ONE WORD|A NUMBER)', itext)
    if m:
        limit = m.group(1)

    out = {'from': lo, 'to': hi, 'kind': kind, 'instr': clean_instr(instr)}
    if opts:
        out['opts'] = opts
    if limit:
        out['limit'] = limit
    if hi > lo and kind == 'multi':
        out['pick'] = hi - lo + 1

    # -------- a table, map, diagram or flow-chart: shown as the picture from the book, with answer boxes
    if fig and body:
        crops = []
        for p in sorted({r['page'] for r in body}):
            rs = [r for r in body if r['page'] == p]
            y0 = max(0, min(r['y'] for r in rs) - 0.012)
            y1 = min(0.95, max(r['y1'] for r in rs) + 0.012)
            x0 = max(0, min(r['x'] for r in rs) - 0.03)
            x1 = min(1, max(r['x1'] for r in rs) + 0.03)
            crops.append({'page': p, 'box': [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]})
        if kind == 'text' and not force_fig and book and re.search(r'\btable\b', itext, re.I):
            # a table the layout model read cell by cell - and that passes its checks - is shown as a real table
            from tables import build_table
            # the word the line OCR saw in front of each gap ("max" before "1 ......"), to tell the gap from
            # the same number used as plain text elsewhere in the table ("Level 1")
            anchors = {}
            for r in body:
                for m in re.finditer(r"([A-Za-z][A-Za-z'’-]*)\W*\s(\d{1,2})\s*(?:[.…·]\s?){2,}", r['t']):
                    if lo <= int(m.group(2)) <= hi:
                        anchors.setdefault(int(m.group(2)), set()).add(m.group(1).lower())
            table = build_table(book, crops, lo, hi, anchors)
            if table:
                out['table'] = table
                out['rows'] = []
                return out
        out['fig'] = crops
        labels = {}
        for r in body:
            for m in re.finditer(r'(?<![\d£$])(\d{1,2})[.)]?\s+(.+?)(?=\s+\d{1,2}[.)]?\s+\D|$)', r['t']):
                q = int(m.group(1))
                if lo <= q <= hi and q not in labels:
                    lab = GAP.sub(' ', m.group(2)).strip(' .…')
                    labels[q] = re.sub(r'\s+', ' ', lab)
        out['rows'] = [{'n': q, 'lab': labels.get(q, ''), 'ctl': 1} for q in range(lo, hi + 1)]
        return out

    x_base = min([r['x'] for r in body] or [0.07])
    _BOX[:] = [x_base, max([r['x1'] for r in body] or [0.93])]
    warn = []          # places where the structure was inferred with less than full certainty (reported by check.py)
    if kind == 'text':
        rows_out = parse_text(body, lo, hi, x_base)
        if framed(book, body):
            out['frame'] = 1
    elif kind in ('mcq', 'multi'):
        rows_out = parse_choice(body, lo, hi, x_base, opts, kind == 'multi', warn)
    elif kind in ('tfng', 'ynng'):
        rows_out = parse_statements(body, lo, hi, x_base)
    else:
        has_gaps = sum(1 for r in body if GAP.search(r['t']) and not re.match(r'^\d{1,2}[.)]?\s', r['t']) and len(r['t']) > 30)
        if kind == 'match' and (has_gaps >= 2 or re.search(r'Complete the (summary|notes|text|paragraph|passage)', itext)):
            # a summary completed with letters from a word list: gaps in running text plus a box of options
            box, text_rows, tails = [], [], []
            for r in body:
                cols = split_option_columns(r, opts)
                kd, val, rest = label_of(r['t'], lo, hi)
                if cols:
                    box += [{'i': 0, 'o': None if a == UNKNOWN else a, 't': [b], 'box': 1, '_x': l['x'], '_y': l['y']} for a, b, l in cols]
                elif kd == 'o' and val in opts and rest and not GAP.search(rest) and len(rest) < 60:
                    box.append({'i': 0, 'o': val, 't': [rest], 'box': 1, '_x': r['x'], '_y': r['y']})
                elif box and not GAP.search(r['t']) and len(r['t']) < 70 and kd != 'n':
                    tails.append(r)             # under the box: the second line of one or more options
                else:
                    text_rows.append(r)
            text_rows += attach_box_tails(box, tails)
            box = order_box(box, opts)
            fit_options(box, opts)
            for e in box:
                e.pop('_x', None); e.pop('_y', None)
            rows_out = parse_text(text_rows, lo, hi, x_base) + [e for e in box if e.get('o')]
        else:
            rows_out = parse_match(body, lo, hi, x_base, opts, key_roman=(kind == 'roman'))
    rows_out = merge_wrapped(rows_out)
    # questions that were not found get a plain answer row after the previous question, so the test stays usable
    present = set()
    for r in rows_out:
        if 'n' in r:
            present.add(r['n'])
        if 'q' in r:
            present.add(r['q'])
        present.update(s['g'] for s in r.get('t', []) if isinstance(s, dict))
    for q in range(lo, hi + 1):
        if q in present or kind == 'multi':
            continue
        at = len(rows_out)
        for k, row in enumerate(rows_out):
            if row.get('n') == q - 1 or row.get('q') == q - 1 or any(isinstance(x, dict) and x.get('g') == q - 1 for x in row.get('t', [])):
                at = k + 1
        rows_out.insert(at, {'n': q, 't': [], 'ctl': 1, 'fb': 1})
    if kind == 'mcq':
        for row in rows_out:
            if 'n' in row and not any(o.get('q') == row['n'] for o in rows_out if 'o' in o):
                row['ctl'] = 1          # options not recognised: letter buttons keep the question answerable
    for row in rows_out:
        row.pop('_x1', None)
    out['rows'] = rows_out
    if warn:
        out['warn'] = warn
    return out
