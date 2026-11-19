"""Fused OCR lines for one page: Apple Vision lines (clean text) + tesseract words that Vision dropped
(lone question numbers, single answer letters, dotted answer gaps).

Coordinates are normalised to 0..1, origin top-left.
"""
import csv, json, os, re

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache')
UNKNOWN = '\ufffd'      # a character that is on the page but could not be read (see glyphs.py)

WATERMARK = re.compile(r'(ielts\s*resources|leltsresources|cambridgematerials|ieltsxpress|cambridge_library|'
                       r'^@|www\.|\.org\b|\.com\b|t\.me|telegram|ielts\s*material)', re.I)
# the names stamped on the scans; anything else that merely looks like an address ("dan1068@market.com" in a
# form to be completed) is only a watermark in the margins of the page
STAMP = re.compile(r'(ielts\s*resources|leltsresources|cambridgematerials|ieltsxpress|cambridge_library|t\.me|telegram|ielts\s*material)', re.I)


STRAY = re.compile(r'[ạẠỊịồẾằỗ®]+')
ARTEFACT = re.compile(r"[ạẠỊịồẾằỗ®]|[a-z.,:;)]i(?=[A-Z][a-z])")


MARK = {'dot': '•', 'dash': '–'}
LEAD_MARK = re.compile(r'^(?:[^\w\s(\'"£$€+]|[eo°])\s+')      # a list mark as OCR read it
PLUS = '\uff0b'           # a "+" that starts a line and is text, not a bullet (fix_text turns it back into "+")
_INK_THR = {}


def _attach_ink(book, page, lines):
    """Add to each Vision line what ink.py measured on the page image: 'bul' (a list mark stands before it),
    'tx' (where its text starts), 'bold' (every word of it is bold). Returns False when the page has no measurements."""
    path = os.path.join(CACHE, book, f'{page}.ink.json')
    if not os.path.exists(path):
        return False
    ink = json.load(open(path))
    if book not in _INK_THR:
        from ink import bold_threshold
        _INK_THR[book] = bold_threshold(book)
    by = {(r['x'], r['y']): r for r in ink['lines']}
    for l in lines:
        r = by.get((l['x'], l['y']))
        if r is None:
            continue
        l['tx'] = r['tx']
        if r.get('bul'):
            l['bul'], l['bx'] = r['bul'], r['bx']
        if ink.get('reg') and r.get('wmin'):
            l['bm'] = round(r['wmin'] / ink['reg'] - _INK_THR[book], 3)     # how far past the bold threshold
            l['bold'] = l['bm'] >= 0
    return True


def page_ink(book, page):
    """Rules and frames on a page (see ink.py): {'h': [...], 'v': [...], 'boxes': [...]}, or None."""
    path = os.path.join(CACHE, book, f'{page}.ink.json')
    if not os.path.exists(path):
        return None
    d = json.load(open(path))
    from ink import frames
    return {'h': d['h'], 'v': d['v'], 'boxes': frames(d['h'], d['v'])}


def _tess_words(book, page):
    path = os.path.join(CACHE, book, f'{page}.tsv')
    out = []
    if not os.path.exists(path):
        return out, 1, 1
    W = H = 1
    with open(path, newline='') as f:
        for r in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
            if r['level'] == '1':
                W, H = int(r['width']), int(r['height'])
            if r['level'] != '5' or not (r.get('text') or '').strip():
                continue
            out.append({'t': r['text'].strip(), 'conf': float(r['conf']), 'line': (r['block_num'], r['par_num'], r['line_num']),
                        'x': int(r['left']), 'y': int(r['top']), 'w': int(r['width']), 'h': int(r['height'])})
    for w in out:
        w['x'] /= W; w['w'] /= W; w['y'] /= H; w['h'] /= H
    return out, W, H


def _overlaps(w, l):
    pad = l['h'] * 0.35
    return not (w['x'] + w['w'] < l['x'] - 0.004 or w['x'] > l['x'] + l['w'] + 0.004 or
                w['y'] + w['h'] < l['y'] - pad or w['y'] > l['y'] + l['h'] + pad)


def _same_row(w, l):
    """Is word w part of line l? It must share the line's row, not merely sit close under it: the last word
    of a paragraph, alone on the next row, is exactly what Vision drops and tesseract still has."""
    if w['x'] + w['w'] < l['x'] - 0.004 or w['x'] > l['x'] + l['w'] + 0.004:
        return False
    iy = min(w['y'] + w['h'], l['y'] + l['h']) - max(w['y'], l['y'])
    return iy > 0.3 * min(w['h'], l['h'])


def _mid_row(w, l):
    """The same question by the middle of the word: stricter, because Vision draws its line boxes tall enough
    to reach into the row below (and looser for an underlined word, whose box tesseract draws to the rule)."""
    if w['x'] + w['w'] < l['x'] - 0.004 or w['x'] > l['x'] + l['w'] + 0.004:
        return False
    return l['y'] + 0.15 * l['h'] <= w['y'] + w['h'] / 2 <= l['y'] + 0.85 * l['h']


def _skipped(ws, vlines):
    """Is this tesseract line one that Vision skipped altogether? Its words then sit between two Vision lines,
    touching the box of the one above, and are not the words of that line."""
    ws = [w for w in ws if re.search(r'[A-Za-z]{2}', w['t'])]
    if len(ws) < 3:
        return False
    key = lambda t: re.sub(r'[^a-z0-9]', '', t.lower())
    between = new = 0
    for w in ws:
        near = [l for l in vlines if _same_row(w, l)]
        if not any(_mid_row(w, l) for l in near):
            between += 1
            if key(w['t']) not in {key(x) for l in near for x in l['t'].split()}:
                new += 1
    return between >= 0.8 * len(ws) and new >= 0.5 * len(ws)


def _covered(g, l):
    """Is box g mostly inside line l? (stricter than _overlaps: a label on the next row down must survive)"""
    ix = min(g['x'] + g['w'], l['x'] + l['w']) - max(g['x'], l['x'])
    iy = min(g['y'] + g['h'], l['y'] + l['h']) - max(g['y'], l['y'])
    return ix > 0 and iy > 0 and ix * iy > 0.3 * g['w'] * g['h']


def _useful(w):
    t = w['t']
    if re.fullmatch(r'\d{1,2}[.,]?', t) or re.fullmatch(r'[A-L]', t):
        return w['conf'] >= 35
    if re.fullmatch(r'[.…_]{3,}[,.;]?', t) or re.fullmatch(r'\d{1,2}[.…_]{2,}', t):
        return w['conf'] >= 10 or True
    if re.fullmatch(r'(i{1,3}|iv|vi{0,3}|ix|x|xi{0,3})', t):
        return w['conf'] >= 50
    return w['conf'] >= 80 and len(t) >= 2 and re.search(r'[A-Za-z0-9]', t)


def _split_columns(lines, words):
    """On a page set in two columns, Vision now and then returns a line of the left column and the line beside
    it as one. Tesseract's word boxes show where the right column starts: cut the line there."""
    left = [l for l in lines if l['w'] > 0.25 and l['x'] + l['w'] <= 0.56]
    right = sorted(l['x'] for l in lines if l['w'] > 0.25 and l['x'] >= 0.44)
    if len(left) < 4 or len(right) < 4:
        return lines
    rx = right[len(right) // 2]             # where the lines of the right column start
    out = []
    for l in lines:
        toks = l['t'].split()
        cut = None
        if l['x'] < rx - 0.2 and l['x'] + l['w'] > rx + 0.2 and len(toks) >= 2:
            ws = sorted((w for w in words if _mid_row(w, l)), key=lambda w: w['x'])
            gaps = sorted(ws[k]['x'] - ws[k - 1]['x'] - ws[k - 1]['w'] for k in range(1, len(ws)))
            for k in range(1, len(ws)):
                a, b = ws[k - 1]['x'] + ws[k - 1]['w'], ws[k]['x']
                if abs(b - rx) < 0.008 and b - a > max(0.012, 1.8 * gaps[len(gaps) // 2]):
                    cut = (k, a, b)
        if cut is None:
            out.append(l); continue
        k, a, b = cut
        if len(toks) != len(ws):            # the engines count the words differently: cut where the gutter falls in the text
            at = len(l['t']) * ((a + b) / 2 - l['x']) / l['w']
            pos, k = 0, len(toks) - 1
            for i, t in enumerate(toks):
                pos += len(t) + 1
                if pos > at:
                    k = max(1, i + (1 if pos - at < len(t) / 2 else 0)); break
        out.append({**l, 't': ' '.join(toks[:k]), 'w': a - l['x']})
        out.append({**l, 't': ' '.join(toks[k:]), 'x': b, 'w': l['x'] + l['w'] - b})
    return out


def page_lines(book, page):
    with open(os.path.join(CACHE, book, f'{page}.vjson')) as f:
        v = json.load(f)
    lines = [{'t': l['t'].strip(), 'x': l['x'], 'y': l['y'], 'w': l['w'], 'h': l['h'], 'src': 'v', 'c': l.get('c', 1)} for l in v['lines'] if l['t'].strip()]
    words, _, _ = _tess_words(book, page)
    lines = _split_columns(lines, words)
    has_ink = _attach_ink(book, page, lines)
    # Vision is better on most lines, but when it is unsure and tesseract is confident, take tesseract's reading
    for l in lines:
        if l['c'] >= 0.5 or len(l['t']) < 12:
            continue
        inside = [w for w in words if l['x'] - 0.01 <= w['x'] + w['w'] / 2 <= l['x'] + l['w'] + 0.01 and l['y'] - l['h'] * 0.3 <= w['y'] + w['h'] / 2 <= l['y'] + l['h'] * 1.3]
        if len(inside) >= 3 and sum(w['conf'] for w in inside) / len(inside) > 75:
            inside.sort(key=lambda w: (round((w['y'] + w['h'] / 2) * 200), w['x']))
            l['t'] = ' '.join(w['t'] for w in inside)
    # Vision turns a quotation mark next to a full stop into nonsense ("ViennaỊThat", ".iThus"): tesseract reads
    # those places correctly, so take its words for just that stretch of the line
    for l in lines:
        if not ARTEFACT.search(l['t']):
            continue
        out, pos = [], 0
        for tok in re.finditer(r'\S+', l['t']):
            t = tok.group(0)
            if not ARTEFACT.search(t):
                out.append(t); continue
            x0 = l['x'] + l['w'] * tok.start() / len(l['t']) - 0.008
            x1 = l['x'] + l['w'] * tok.end() / len(l['t']) + 0.008
            mid = lambda w: w['x'] + w['w'] / 2
            inside = sorted((w for w in words if x0 <= mid(w) <= x1 and l['y'] - l['h'] * 0.3 <= w['y'] + w['h'] / 2 <= l['y'] + l['h'] * 1.3),
                            key=lambda w: w['x'])
            got = ' '.join(w['t'] for w in inside)
            if inside and min(w['conf'] for w in inside) >= 60 and not ARTEFACT.search(got):
                out.append(got)
            else:
                out.append(STRAY.sub(' ', t).strip())      # no better reading: at least drop the nonsense characters
        l['t'] = ' '.join(x for x in out if x)
    # blobs of ink that no OCR line accounts for (glyphs.py): lone letters and numbers, dotted gaps
    gp = os.path.join(CACHE, book, f'{page}.glyphs.json')
    if os.path.exists(gp):
        rules = (page_ink(book, page) or {}).get('v', []) if has_ink else []
        for g in json.load(open(gp)):
            if any(_covered(g, l) for l in lines):
                continue
            if g.get('k') == 'glyph' and g['w'] < 0.006 and any(
                    abs(x - (g['x'] + g['w'] / 2)) < 0.005 and y0 - 0.005 <= g['y'] and g['y'] + g['h'] <= y1 + 0.005 for x, y0, y1 in rules):
                continue        # a sliver lying on a rule down the page: the side of a frame, not a character
            t = g['t']
            if t == UNKNOWN:
                # tesseract saw it in context: take its reading if it is a plausible label
                hit = [w for w in words if _overlaps(w, g) and re.fullmatch(r'\d{1,2}[.,]?|[A-L]|[ivx]{1,4}', w['t']) and w['conf'] >= 35]
                if hit:
                    t = hit[0]['t'].rstrip('.,')
            lines.append({'t': t, 'x': g['x'], 'y': g['y'], 'w': g['w'], 'h': g['h'], 'src': 'g', 'c': g.get('n', 0) / 3})
    extra = {}
    vlines = [l for l in lines if l['src'] == 'v']
    by_line = {}
    for w in words:
        if _useful(w):
            by_line.setdefault(w['line'], []).append(w)
    skipped = {k for k, ws in by_line.items() if _skipped(ws, vlines)}
    for w in words:
        if not _useful(w):
            continue
        if w['line'] in skipped:
            continue
        # labels and gaps keep the wider margin (a stray copy of one beside its line does harm); a real word
        # is only a duplicate when it stands on the row of a line that is already there
        wordy = re.search(r'[A-Za-z]{2}', w['t']) is not None
        # ... and a blob of ink (glyphs.py) is no line: on a line Vision skipped, the blobs are its words
        if any(_same_row(w, l) for l in vlines) if wordy else any(_overlaps(w, l) for l in lines):
            continue
        extra.setdefault(w['line'], []).append(w)
    for k in skipped:                   # the whole line, with the words tesseract was less sure of
        extra[k] = [w for w in words if w['line'] == k and w['conf'] >= 50 and not any(_mid_row(w, l) for l in vlines)]
    for ws in extra.values():
        ws.sort(key=lambda w: w['x'])
        # split a tesseract line where words are far apart
        cur = [ws[0]]
        groups = [cur]
        for w in ws[1:]:
            if w['x'] - (cur[-1]['x'] + cur[-1]['w']) > 0.04:
                cur = [w]; groups.append(cur)
            else:
                cur.append(w)
        for g in groups:
            x0 = min(w['x'] for w in g); y0 = min(w['y'] for w in g)
            x1 = max(w['x'] + w['w'] for w in g); y1 = max(w['y'] + w['h'] for w in g)
            found = {'t': ' '.join(w['t'] for w in g), 'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0, 'src': 't'}
            if re.search(r'[A-Za-z]{2}', found['t']):
                lines[:] = [l for l in lines if l['src'] != 'g' or not _covered(l, found)]      # the blobs it accounts for
            lines.append(found)
    mp = os.path.join(CACHE, book, f'{page}.margin.json')
    if os.path.exists(mp):
        for m in json.load(open(mp)):
            if not any(_overlaps(m, l) for l in lines):
                lines.append({'t': m['t'], 'x': m['x'], 'y': m['y'], 'w': m['w'], 'h': m['h'], 'src': 'm'})
    for l in lines:
        l['page'] = page
        l['t'] = clean_text(l['t'])
        if has_ink and l['src'] == 'v':
            # the ink says whether a list mark stands in front of this line; OCR reads the mark as anything
            # ("•", "e", "*", nothing at all) and reads other things as a mark ("+")
            if l.get('bul'):
                l['t'] = MARK[l['bul']] + ' ' + LEAD_MARK.sub('', l['t'])
            elif l['t'].startswith('+ '):
                l['t'] = PLUS + l['t'][1:]
    lines = [l for l in lines if l['t']]
    # a list mark OCR returned as a line of its own belongs to the line it stands in front of
    for b in [l for l in lines if re.fullmatch(r'[•·●▪◦*–—-]', l['t'])]:
        cy = b['y'] + b['h'] / 2
        right = [l for l in lines if l is not b and 0 < l['x'] - b['x'] < 0.09 + b['w'] and len(l['t']) > 1
                 and l['y'] - 0.004 <= cy <= l['y'] + l['h'] + 0.004]
        if not right:
            continue
        tgt = min(right, key=lambda l: l['x'])
        kind = 'dot' if b['t'] in '•·●▪◦*' else 'dash'
        if not tgt.get('bul'):
            if kind == 'dash' and not has_ink:
                continue                # a lone dash with nothing measured may be a minus sign or a rule
            tgt['bul'], tgt['bx'] = kind, b['x']
            tgt['t'] = MARK[kind] + ' ' + LEAD_MARK.sub('', tgt['t'])
        lines.remove(b)
    # ... and so does anything the other engines made of that mark (tesseract reads a bullet as "2", "e", "o")
    for v in [l for l in lines if l.get('bul')]:
        for x in [l for l in lines if l['src'] in ('t', 'g') and l['w'] < 0.02 and abs(l['x'] - v['bx']) < 0.012
                  and l['h'] < 0.45 * v['h']                  # smaller than a character of the line: the mark itself
                  and v['y'] - 0.004 <= l['y'] + l['h'] / 2 <= v['y'] + v['h'] + 0.004]:
            lines.remove(x)
    apply_fixes(book, page, lines)
    return lines


_FIXES = {}
FIX_MISSES = []        # fixes that matched nothing (the OCR cache changed under them); build.py reports these


def apply_fixes(book, page, lines):
    """Hand corrections to the OCR text of one page, from fixes/<book>.json: {"<page>": [op, ...]}.

    ["old", "new"]            replace "old" with "new" in the one line that contains it
    ["+", "anchor", "text"]   add a line with "text" just below the line containing "anchor" (["^", ...] = above)
    ["<", "anchor", "text"]   add a line with "text" just left of the line containing "anchor" (a lost label)
    ["-", "text"]             drop the line containing "text"
    ["*", "Al", "AI"]         replace the word "Al" wherever it stands on the page (a misreading that repeats)
    A key written "=B" matches the line that is exactly "B"; "...#-1" picks the last match on the page, "#1" the second.

    They are applied to the fused lines, so they survive re-running OCR as long as the line still reads the same.
    """
    if book not in _FIXES:
        _FIXES[book] = {}
        # <book>.json: structure (lost labels, lines); <book>.spelling.json: misread words (see proof.py)
        for name in (f'{book}.json', f'{book}.spelling.json'):
            p = os.path.join(os.path.dirname(CACHE), 'fixes', name)
            if os.path.exists(p):
                for page_no, ops in json.load(open(p)).items():
                    _FIXES[book].setdefault(page_no, []).extend(ops)
    for op in _FIXES[book].get(str(page), []):
        if op[0] == '*':
            word, n = re.compile(r'(?<!\w)' + re.escape(op[1]) + r'(?!\w)'), 0
            for l in lines:
                l['t'], k = word.subn(op[2], l['t'])
                n += k
            if not n:
                FIX_MISSES.append(f'{book} p{page}: {op}')
            continue
        key = op[1] if op[0] in ('+', '-', '<', '^', '!') else op[0]
        nth = 0
        m = re.search(r'#(-?\d+)$', key)
        if m:                           # "=A#-1": the last such line on the page (top to bottom), "#1": the second
            nth, key = int(m.group(1)), key[:m.start()]
        if key.startswith('='):         # "=B": the line that is exactly "B"
            key = key[1:]
            hits = [l for l in lines if l['t'] == key]
        else:
            hits = [l for l in lines if key in l['t']]
        hits.sort(key=lambda l: l['y'])
        hit = hits[nth] if -len(hits) <= nth < len(hits) else None
        if hit is None:
            FIX_MISSES.append(f'{book} p{page}: {op}')
            continue
        if op[0] == '!':                # ["!", "anchor", h]: correct the height of a line box OCR drew over several lines
            hit['h'] = op[2]
        elif op[0] in ('+', '^'):
            dy = hit['h'] * (0.8 if op[0] == '+' else -0.8)        # its own row, but before the next printed line
            if len(op) > 3:
                dy = op[3]                                         # explicit offset, as a fraction of the page height
            lines.append({'t': op[2], 'x': hit['x'], 'y': hit['y'] + dy, 'w': hit['w'], 'h': min(hit['h'], 0.016), 'src': 'f', 'page': page})
        elif op[0] == '<':
            w = 0.012 * len(op[2])
            lines.append({'t': op[2], 'x': hit['x'] - w - 0.012, 'y': hit['y'], 'w': w, 'h': hit['h'], 'src': 'f', 'page': page})
        elif op[0] == '-':
            lines.remove(hit)
        else:
            hit['t'] = hit['t'].replace(key, op[1], 1)


WM_TOKEN = re.compile(r'\s*(FB\.com/\S+(\s+Vo\b)?|\S*ieltsxpress\S*|@\S+|\S*cambridge_?library\S*|\S*ielts\s*resources\.org)', re.I)


# Cyrillic and Greek letters that Vision sometimes returns for the Latin ones they look like
HOMOGLYPHS = str.maketrans('АВСЕНКМОРТХаеорсухіјѕΑΒΕΖΗΙΚΜΝΟΡΤΧον', 'ABCEHKMOPTXaeopcyxijsABEZHIKMNOPTXov')


def clean_text(t):
    if len(t) > 25:
        t = WM_TOKEN.sub('', t)
    t = t.translate(HOMOGLYPHS)
    t = t.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    t = t.replace('Oг', 'O2').replace('ﬁ', 'fi').replace('ﬂ', 'fl')
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'\b([Ww])nte\b', r'\1rite', t)
    t = re.sub(r'\bAND\s?[Il1|]\s?OR\b', 'AND/OR', t)          # the slash of "AND/OR" in bold italic capitals
    t = re.sub(r'^Wh?ite (the correct|your answers?|ONE|NO MORE|TWO|THREE)\b', r'Write \1', t)
    t = re.sub(r'\bfetter\b', 'letter', t)
    t = re.sub(r'^[CO0Q]uestions?\b', lambda m: 'Question' + ('s' if m.group(0).endswith('s') else ''), t)
    return t


def is_furniture(l):
    """Running headers/footers and watermarks."""
    t = l['t']
    if re.search(r'\d{9,}', t) or re.fullmatch(r'Listening test audio', t):
        return True         # barcode number and QR-code caption printed on every page of some scans
    if l['y'] > 0.85 and re.search(r'(→|➔|->)?[\s•\W]*\bp\.\s*\d{2,3}\b', t) and len(t) < 40:
        return True         # "-> p. 123" cross-references to the key and audioscript
    if WATERMARK.search(t) and len(t) < 45 and (STAMP.search(t) or l['y'] < 0.13 or l['y'] > 0.87):
        return True
    if l['y'] < 0.075 and re.fullmatch(r'(Test \d|Listening|Reading|Writing|Speaking|Audioscripts|Transcripts|Test \d+\W*)', t, re.I):
        return True
    if l['y'] < 0.13 and l['h'] < 0.02 and re.fullmatch(r'(Test \d|Listening|Reading|Writing|Speaking)', t):
        return True         # the same running heads on scans with a wider top margin (the test's own title is set larger)
    if l['y'] > 0.935 and len(t) < 30 and '..' not in t and (re.search(r'\bp\.\s*\d|^[^A-Za-z]*$|©|UCLES|Cambridge', t) or (l.get('c', 1) < 0.4 and len(t) < 8)):
        return True         # page number, "-> p. 117" cross-reference, copyright line (not real text that reaches the bottom edge)
    if '..' not in t and re.fullmatch(r'\W*\d{1,3}\W*', t) and (
            l['y'] > 0.9 or l['y'] < 0.09 or (l['y'] > 0.85 and l['x'] > 0.78)):
        return True         # page number (a number followed by dots is a gap, even at the foot of a page)
    if (l['y'] > 0.9 or l['y'] < 0.09) and re.fullmatch(r'(\d{1,3}\s+)?(Test \d|Reading|Listening|Writing|Speaking)(\s+\d{1,3})?', t):
        return True
    return False


def rows(lines):
    """Group lines into visual rows (sorted by y, then x)."""
    ls = sorted(lines, key=lambda l: (l['y'] + l['h'] / 2))
    out = []
    for l in ls:
        cy = l['y'] + l['h'] / 2
        for r in out[-3:]:
            if r['page'] == l['page'] and abs(r['cy'] - cy) < 0.55 * min(r['h'], l['h'], 0.02) + 0.002:
                r['lines'].append(l)
                break
        else:
            out.append({'cy': cy, 'h': l['h'], 'page': l['page'], 'lines': [l]})
    for r in out:
        r['lines'].sort(key=lambda l: l['x'])
        r['x'] = r['lines'][0]['x']
        r['y'] = min(l['y'] for l in r['lines'])
        r['y1'] = max(l['y'] + l['h'] for l in r['lines'])
        r['x1'] = max(l['x'] + l['w'] for l in r['lines'])
        r['t'] = ' '.join(l['t'] for l in r['lines'])
        # a stray unread mark or a loose full stop in front of the row says nothing about how the row is set
        debris = lambda l: l['t'] == UNKNOWN or (len(l['t']) <= 2 and not any(c.isalnum() for c in l['t']) and l['t'] not in MARK.values())
        first = next((l for l in r['lines'] if not debris(l)), r['lines'][0])
        if first is not r['lines'][0] and first.get('bul'):
            # nothing is printed in front of a list mark: what OCR put there is debris, and the row starts at the mark
            r['lines'] = r['lines'][r['lines'].index(first):]
            r['t'] = ' '.join(l['t'] for l in r['lines'])
            r['x'] = first['x']
        r['tx'] = first.get('tx', first['x'])          # where the text starts (after a list mark)
        r['bul'] = first.get('bul')
        r['mx'] = first.get('bx', first['x'])          # where the row starts: its list mark, or its text
        margins = [l['bm'] for l in r['lines'] if 'bm' in l]
        r['bm'] = min(margins) if margins else None    # None: not measured
        r['bold'] = r['bm'] >= 0 if margins else None
    return out


def reading_order(lines):
    """Order lines on one page, handling two-column bands (passages)."""
    if not lines:
        return []
    ls = sorted(lines, key=lambda l: l['y'])
    out, band = [], []

    def flush():
        if not band:
            return
        left = [l for l in band if l['x'] + l['w'] <= 0.56]
        right = [l for l in band if l['x'] >= 0.44]
        if len(left) >= 4 and len(right) >= 4 and len(left) + len(right) == len(band):
            out.extend(sorted(left, key=lambda l: (l['y'], l['x'])))
            out.extend(sorted(right, key=lambda l: (l['y'], l['x'])))
        else:
            out.extend(sorted(band, key=lambda l: (l['y'], l['x'])))
        band.clear()

    for l in ls:
        # a line across the gutter ends a band: full-width text, or a title centred over two columns (which
        # must not make the columns under it read as one)
        if l['x'] < 0.44 and l['x'] + l['w'] > 0.56:
            flush(); out.append(l)
        else:
            band.append(l)
    flush()
    return out
