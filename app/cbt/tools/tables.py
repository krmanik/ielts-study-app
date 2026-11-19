"""A "Complete the table" question as a real table, from the layout model's reading of the page (vl.py).

Line OCR returns a table as loose rows of words; the layout model returns its rows and cells. Its text is not
taken on trust, though - it drops the dots of a gap and now and then writes a word that is not on the page - so
a table is only built when it can be checked: every question number of the group is found exactly once, in
order, and (almost) every word is confirmed by the line OCR of the same page. Otherwise build_table returns
None and the group stays what it was: the picture of the table from the book, with answer boxes.

Output: {"title": str or None, "rows": [[cell, ...], ...]}; a cell is
  {"p": [{"t": segments, "li": 1 for a bullet point}, ...], "h": 1 (heading cell), "cs": colspan, "rs": rowspan, "ex": 1 (worked example)}
where segments are strings and {"g": question number} for an answer gap, as in question rows.
"""
import csv, difflib, html, json, os, re
from collections import Counter
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]")
# a question number standing on its own (not part of a price, a time, a range), with the dots of its gap if any
NUMBER = re.compile(r'(?<![\w£$€.,:/–-])(?P<b>\d{1,2})(?![\w%:/–-]|[.,]\d)(?P<dots>\s*[.…_]{2,}[.…_ ]*)?')
ITEM = re.compile(r'\s*[•●▪‣]\s*|\n+')          # where a cell's text breaks: a bullet point, a dash item ("‣"), a new line


class _Grid(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cell = [], None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.rows.append([])
        elif tag in ('td', 'th'):
            a = dict(attrs)
            self.cell = {'text': '', 'cs': int(a.get('colspan') or 1), 'rs': int(a.get('rowspan') or 1), 'th': tag == 'th'}
            if not self.rows:
                self.rows.append([])
            self.rows[-1].append(self.cell)
        elif tag == 'br' and self.cell is not None:
            self.cell['text'] += '\n'

    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell['text'] += data


def _blocks(book, page):
    p = os.path.join(CACHE, book, f'{page}.vl.json')
    return json.load(open(p))['blocks'] if os.path.exists(p) else None


def _witness(book, page):
    """Words on the page according to the line engines (tesseract, Vision and its runner-up readings)."""
    seen = set()
    p = os.path.join(CACHE, book, f'{page}.tsv')
    if os.path.exists(p):
        with open(p, newline='') as f:
            for r in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
                if r['level'] == '5' and (r.get('text') or '').strip():
                    seen.update(w.lower() for w in WORD.findall(r['text']))
    for ext in ('vjson', 'vraw'):
        p = os.path.join(CACHE, book, f'{page}.{ext}')
        if os.path.exists(p):
            for l in json.load(open(p))['lines']:
                for t in [l['t']] + l.get('alt', []):
                    seen.update(w.lower() for w in WORD.findall(t))
    return seen


def _confirm(text, seen, bad):
    """Check each word of a cell against the line OCR; a near miss takes the confirmed spelling."""
    def fix(m):
        w = m.group(0)
        k = w.lower().replace('’', "'")
        if len(k) < 3 or k in seen or any(p in seen for p in k.split('-') if len(p) > 2):
            return w
        # two lines of a cell run together by the model ("managerHotel"): both halves are words of the page
        for cut in re.finditer(r'(?<=[a-z])(?=[A-Z])', w):
            a, b = w[:cut.start()], w[cut.start():]
            if a.lower() in seen and b.lower() in seen:
                return a + '\n' + b
        # ... also without a capital to show the seam ("blackflieslocal")
        for cut in range(3, len(w) - 2):
            if w[:cut].lower() in seen and w[cut:].lower() in seen and (cut > 3 or len(w) - cut > 3):
                return w[:cut] + '\n' + w[cut:]
        near = difflib.get_close_matches(k, seen, n=1, cutoff=0.8)
        if near:
            return near[0].capitalize() if w[0].isupper() and not w.isupper() else (near[0].upper() if w.isupper() else near[0])
        bad.append(w)
        return w
    return WORD.sub(fix, text)


def _clean(t):
    t = html.unescape(t)
    t = re.sub(r'\$\$?\s*\\text\{([^}]*)\}\s*\$\$?', r'\1', t).replace('$$', ' ')
    t = t.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace('…', '...')
    t = re.sub(r'^\s*Example:?(?=[A-Z0-9])', 'Example ', t)          # "ExampleThe Food Studio"
    t = re.sub(r',(\s*,)+', ',', t)                                  # "8, , sugarcane": the dots of the gap left a comma behind
    return re.sub(r'[ \t]+', ' ', t).strip()


def _segments(text, lo, hi, gaps):
    """Split a cell's text at its answer gaps. `gaps` holds the positions in this text chosen by _choose."""
    segs, pos = [], 0
    for m in NUMBER.finditer(text):
        if m.start() not in gaps:
            continue
        before, end = text[pos:m.start()], m.end()
        # the number is printed in front of a currency sign or an opening quotation mark: "2 £ ......", "5 '......'"
        lead = re.match(r"\s*([£$€'\"])\s*[.…_ ]*", text[end:])
        if lead and (lead.group(1) in '£$€' or re.match(r"\s*['\"]", text[end + lead.end():]) or lead.end() > 2):
            before, end = before.rstrip() + ' ' + lead.group(1), end + lead.end()
        if before.strip():
            before = before if before.endswith(("'", '"', '£', '$', '€', '(')) else before.rstrip() + ' '
            if segs and isinstance(segs[-1], dict) and before.lstrip()[0] not in ',.);:\'"':
                before = ' ' + before.lstrip()
            segs.append(before)
        segs.append({'g': gaps[m.start()]})
        pos = end
    rest = re.sub(r'\s*[.…_]{3,}', '', text[pos:]).strip()          # dots of a gap the model wrote out on their own
    if rest:
        segs.append((' ' if segs and rest[0] not in ',.);:\'"' else '') + rest)
    return [x if isinstance(x, dict) else re.sub(r'[.…_]{3,}\s*', '', x) for x in segs]


def _choose(cells, order, lo, hi, anchors):
    """Which numbers in the table are answer gaps: {(cell, position in its text): q}, or None when it cannot be told.

    A table also holds ordinary numbers ("2 classes", "Level 1"), and the model often drops the dots of a gap,
    so the number alone does not say. Three things do: the line OCR saw dots after the real one and knows the
    word in front of it (`anchors`); the model sometimes kept the dots; and gaps are numbered in order through
    the table. There must be exactly one way to pick lo, lo+1, ... hi in reading order from the numbers that
    pass; no way, or several, means no decision.
    """
    toks = []           # (cell, position, q, dotted, confirmed by the line OCR) in reading order
    for ci in order:
        for m in NUMBER.finditer(cells[ci]):
            q = int(m.group('b'))
            if lo <= q <= hi:
                before = WORD.findall(cells[ci][:m.start()])
                prev = before[-1].lower() if before else ''
                toks.append((ci, m.start(), q, bool(m.group('dots')), bool(prev) and prev in anchors.get(q, ())))
    confirmed = {q for _, _, q, _, c in toks if c}
    has_dots = {q for _, _, q, d, _ in toks if d}

    def ways(strict, limit=2):
        found = []

        def walk(start, q, picked):
            if len(found) >= limit:
                return
            if q > hi:
                found.append(dict(picked)); return
            for k in range(start, len(toks)):
                ci, pos, tq, d, c = toks[k]
                if tq != q or (q in confirmed and not c) or (strict and q in has_dots and not d and q not in confirmed):
                    continue
                walk(k + 1, q + 1, picked + [((ci, pos), q)])
        walk(0, lo, [])
        return found

    for strict in (True, False):
        found = ways(strict)
        if len(found) == 1:
            return found[0]
        if len(found) > 1:
            return None
    return None


def _printed(book, boxes):
    """The words (of three letters and more) that the line OCR read inside the table."""
    from lines import page_lines
    out = []
    for page, (x0, y0, x1, y1) in boxes:
        for l in page_lines(book, page):
            if x0 <= l['x'] + l['w'] / 2 <= x1 and y0 <= l['y'] + l['h'] / 2 <= y1 and l.get('src') == 'v':
                out += [w.lower() for w in WORD.findall(l['t']) if len(w) > 2]
    return out


def _itemise(book, boxes, grid):
    """Put back the breaks inside a cell. The model returns a cell as one run of text; the page shows where a
    bullet point or a new item starts (a list mark in front of the line, or space above it), and the first
    words of that line say where in the cell that is. A line that cannot be placed for certain changes nothing."""
    from lines import page_lines, page_ink, MARK, LEAD_MARK
    tok = re.compile(r"[A-Za-z0-9]+(?:['’][a-z]+)?")
    cells = [c for r in grid for c in r]
    words = [[(m.group(0).lower(), m.start()) for m in tok.finditer(c['text'])] for c in cells]
    marks = ''.join(MARK.values())
    breaks = {}                                     # cell -> {position in its text: (list mark or None, where the line starts)}
    for page, (x0, y0, x1, y1) in boxes:
        ls = [l for l in page_lines(book, page) if x0 - 0.01 <= l['x'] + l['w'] / 2 <= x1 + 0.01 and y0 - 0.005 <= l['y'] + l['h'] / 2 <= y1 + 0.005
              and re.search(r'[A-Za-z0-9]', l['t'])]
        if not ls:
            continue
        ls.sort(key=lambda l: l['y'])
        rules = (page_ink(book, page) or {}).get('v', [])
        height = sorted(l['h'] for l in ls)[len(ls) // 2]
        for i, l in enumerate(ls):
            cy = l['y'] + l['h'] / 2
            # the words after a gap, on the row of the line that holds the gap, start nothing
            if any(p is not l and p['x'] + p['w'] <= l['x'] + 0.01 and abs(p['y'] + p['h'] / 2 - cy) < 0.6 * height
                   and not any(p['x'] + p['w'] - 0.005 <= x <= l['x'] + 0.005 and a - 0.005 <= cy <= b + 0.005 for x, a, b in rules)
                   for p in ls):
                continue
            mark = l.get('bul') or ('dash' if re.match(r'[-–—]\s', l['t']) else None)
            over = [p for p in ls[:i] if p['x'] < l['x'] + l['w'] and l['x'] < p['x'] + p['w'] and p['y'] + p['h'] * 0.5 < l['y']]
            spaced = bool(over) and l['y'] - max(p['y'] for p in over) > 1.55 * height
            toks = [m.group(0).lower() for m in tok.finditer(LEAD_MARK.sub('', l['t']).lstrip(marks + ' '))]
            found = []
            for n in range(min(4, len(toks)), min(8, len(toks)) + 1):       # more words when the first few stand twice
                key = toks[:n]
                found = [(ci, k) for ci, ws in enumerate(words) for k in range(len(ws) - n + 1) if [w for w, _ in ws[k:k + n]] == key]
                if len(found) <= 1:
                    break
            if not toks or len(found) != 1:
                continue
            ci, k = found[0]
            if k == 0 or mark or spaced:
                breaks.setdefault(ci, {})[words[ci][k][1]] = (mark, l.get('tx', l['x']))
    for ci, at in breaks.items():
        t = cells[ci]['text']
        dots = [x for m, x in at.values() if m == 'dot']
        if sum(m == 'dash' for m, _ in at.values()) == 1:
            at = {pos: (None if m == 'dash' else m, None if m == 'dash' else x) for pos, (m, x) in at.items()}
            at = {pos: v for pos, v in at.items() if v != (None, None)}
        for pos in sorted(at, reverse=True):
            mark, x = at[pos]
            if not mark and x is not None and any(abs(x - d) < 0.012 for d in dots):
                mark = 'dot'            # set like the bullet points of its cell: one of them, its mark too faint to measure
            if not mark and pos == 0:
                continue
            while pos and t[pos - 1] in '(\'"£$€':
                pos -= 1
            head = re.sub(r'[\s•●▪–—-]+$', '', t[:pos]) if mark else t[:pos].rstrip()       # the mark itself, as the model wrote it
            t = head + {'dot': '\n• ', 'dash': '\n‣ ', None: '\n'}[mark] + t[pos:]
        cells[ci]['text'] = t.lstrip('\n')


def build_table(book, crops, lo, hi, anchors=None):
    anchors = anchors or {}
    grid, title, pages, boxes = [], None, [], []
    for c in crops:
        blocks = _blocks(book, c['page'])
        if blocks is None:
            return None
        x, y, w, h = c['box']
        inside = [b for b in blocks if x - 0.02 <= (b['b'][0] + b['b'][2]) / 2 <= x + w + 0.02 and y - 0.03 <= (b['b'][1] + b['b'][3]) / 2 <= y + h + 0.02]
        tabs = [b for b in inside if b['l'] == 'table']
        if len(tabs) != 1:
            if not tabs and grid:
                continue                 # the tail of the crop on the next page holds no further table
            return None
        heads = [b for b in inside if b['l'] in ('figure_title', 'paragraph_title', 'doc_title', 'table_title') and b['b'][3] <= tabs[0]['b'][1] + 0.01]
        heads = [b for b in heads if not re.match(r'\s*(Write|Complete|Choose|Questions?)\b', b['t'])]      # an instruction is no title
        if heads and title is None:
            title = _clean(heads[-1]['t'])
        g = _Grid()
        g.feed(tabs[0]['t'])
        rows = [r for r in g.rows if r]
        for r in rows:                   # the dots of a gap returned as a cell of their own: part of the cell before
            for i in range(len(r) - 1, 0, -1):
                if re.fullmatch(r'[\s.…_]+', r[i]['text']) and r[i]['rs'] == 1 and r[i - 1]['rs'] == 1:
                    r[i - 1]['cs'] += r[i]['cs']
                    del r[i]
        boxes.append((c['page'], tabs[0]['b']))
        if grid and rows and sum(c['cs'] for c in rows[0]) != sum(c['cs'] for c in grid[0]):
            return None                  # a second table of another shape
        grid += rows
        pages.append(c['page'])
    if len(grid) < 2 or max(sum(c['cs'] for c in r) for r in grid) < 2:
        return None
    seen = set()
    for p in pages:
        seen |= _witness(book, p)
    bad, total = [], 0
    for r in grid:
        for c in r:
            c['text'] = _confirm(_clean(c['text']), seen, bad)
            total += len(WORD.findall(c['text']))
    if len(bad) > max(1, 0.03 * total):
        return None                      # too much of this reading is not on the page
    for r in grid:
        if any(re.match(r'\s*[,;]', c['text']) for c in r):
            return None                  # a cell cut in two at its gap: the model drew a column that is not there
    if len(grid[0]) > 1 or len(grid) < 3:
        if any(not c['text'].strip() for c in grid[0][1:]) and any(c['text'].strip() for c in grid[0]):
            return None                  # a column without its heading: same fault
    have = Counter(w.lower() for r in grid for c in r for w in WORD.findall(c['text'])) + Counter(w.lower() for w in WORD.findall(title or ''))
    printed, lost = _printed(book, boxes), []
    for w in printed:                    # word for word: "local" twice on the page is "local" twice in the table
        near = [w] if have[w] > 0 else difflib.get_close_matches(w, [k for k, n in have.items() if n > 0], n=1, cutoff=0.8)
        if near:
            have[near[0]] -= 1
        else:
            lost.append(w)
    if len(lost) > max(1, 0.02 * len(printed)):
        return None                      # the model left part of the table out
    _itemise(book, boxes, grid)
    cells = [c for r in grid for c in r]
    texts = [c['text'] for c in cells]
    across = list(range(len(cells)))
    # column by column, for a table numbered downwards (cells placed by their row and running column)
    col_of, k = {}, 0
    for r in grid:
        x = 0
        for c in r:
            col_of[k] = x; x += c['cs']; k += 1
    down = sorted(across, key=lambda i: (col_of[i], i))
    chosen = _choose(texts, across, lo, hi, anchors)
    if chosen is None and anchors and all(anchors.get(q) for q in range(lo, hi + 1)):
        chosen = _choose(texts, down, lo, hi, anchors)       # numbered down the columns: only with every gap confirmed
    if chosen is None:
        return None
    out, k = [], 0
    for r in grid:
        row = []
        for c in r:
            text = c['text']
            cell, shift = {}, 0
            m = re.match(r'^Example:?\s*', text)
            if m and len(text) > m.end():
                cell['ex'] = 1
                shift = m.end()
            here = {pos: q for (ci, pos), q in chosen.items() if ci == k}
            # bullet points inside a cell: cut the text at the bullets, keeping track of where each piece starts
            cell['p'] = []
            pieces, start, mark = [], shift, None
            for mm in ITEM.finditer(text):
                if mm.start() > start:
                    pieces.append((start, mm.start(), mark))
                mark = 'dash' if '‣' in mm.group(0) else 'dot' if mm.group(0).strip() else None
                start = mm.end()
            if start < len(text):
                pieces.append((start, len(text), mark))
            for a0, a1, mark in pieces:
                segs = _segments(text[a0:a1], lo, hi, {pos - a0: q for pos, q in here.items() if a0 <= pos < a1})
                if segs:
                    cell['p'].append({'t': segs, **({'li': mark} if mark else {})})
            if c['cs'] > 1:
                cell['cs'] = c['cs']
            if c['rs'] > 1:
                cell['rs'] = c['rs']
            row.append(cell)
            k += 1
        out.append(row)
    gaps = [s['g'] for r in out for c in r for p in c['p'] for s in p['t'] if isinstance(s, dict)]
    if sorted(gaps) != list(range(lo, hi + 1)):
        return None
    plain = lambda cell: ''.join(x for p in cell['p'] for x in p['t'] if isinstance(x, str)).strip()
    asks = lambda row: any(isinstance(x, dict) for c in row for p in c['p'] for x in p['t'])
    # a first row that is one cell across the whole table is its title
    if len(out) > 2 and len(out[0]) == 1 and not asks(out[0]) and not title:
        title = plain(out[0][0])
        out = out[1:]
    # the heading row: the first row, when it asks nothing
    if not asks(out[0]) and all(len(plain(c).split()) <= 5 and not any(p.get('li') for p in c['p']) for c in out[0]):
        for c in out[0]:
            c['h'] = 1
    return {'title': title, 'rows': out}
