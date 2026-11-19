#!/usr/bin/env python3
"""Build the test data for the IELTS Test Centre from the OCR cache + hand-checked answer keys.

    python3 tools/build.py            # -> data/index.json, data/t/<book>-<test>.json

Inputs: tools/cache/<book>/<page>.vjson|.tsv (OCR, see README), tools/keys/<book>.txt (answer keys),
tools/overrides.json (optional hand fixes), the audio folders in ../../Cambridge IELTS 11-21.
"""
import glob, itertools, json, os, re, statistics, subprocess, sys
from segment import segment
import lines as lines_mod
from lines import reading_order, rows as make_rows, UNKNOWN
from groups import build_group, fix_text, GAP, INSTR, ROMAN

HERE = os.path.dirname(os.path.abspath(__file__))
CBT = os.path.dirname(HERE)
SRC = os.path.join(CBT, '..', '..', 'Cambridge IELTS 11-21')
BOOKS = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21']
WORDS = set()
if os.path.exists('/usr/share/dict/words'):
    WORDS = {w.strip().lower() for w in open('/usr/share/dict/words')}

# ---------------------------------------------------------------- answer keys

def norm(s):
    """Must match norm() in js/mark.js."""
    s = s.lower().replace('’', "'").replace('‘', "'")
    s = re.sub(r'(\d),(\d{3})', r'\1\2', s)
    s = re.sub(r'(\d):(\d)', r'\1.\2', s)
    s = re.sub(r'[-–—]', ' ', s)
    s = re.sub(r'^[\s.,;:!?"\']+|[\s.,;:!?"\']+$', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def expand(s):
    m = re.search(r'\(([^()]*)\)', s)
    if m:
        out = expand(s[:m.start()] + s[m.end():])
        for alt in m.group(1).split('/'):
            alt = alt.strip()
            if alt and alt != '-':
                out += expand(s[:m.start()] + alt + s[m.end():])
            elif alt == '-':
                out += expand(s[:m.start()] + '-' + s[m.end():])
        return out
    res = []
    for alt in re.split(r'\s+/\s+|\s+OR\s+', s):
        toks = alt.split()
        opts = [t.split('/') if '/' in t and not re.fullmatch(r'\d+/\d+', t) else [t] for t in toks]
        for combo in itertools.islice(itertools.product(*opts), 64):
            res.append(' '.join(combo))
    return res


def parse_keys(book):
    keys = {}
    cur = None
    for line in open(os.path.join(HERE, 'keys', f'{book}.txt')):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = re.match(r'@(\d)\s+([LR])', line)
        if m:
            cur = keys.setdefault(int(m.group(1)), {}).setdefault(m.group(2), {})
            continue
        m = re.match(r'(\d+)&(\d+)\s+(.+)', line)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            vals = [v.strip() for v in m.group(3).split(',')]
            for q in (a, b):
                cur[str(q)] = {'show': ' / '.join(vals) + ' (either order)', 'set': [a, b], 'vals': [norm(v) for v in vals]}
            continue
        m = re.match(r'(\d+)\s+(.+)', line)
        q, raw = int(m.group(1)), m.group(2).strip()
        alts = sorted({norm(a) for a in expand(raw)} - {''})
        cur[str(q)] = {'show': raw, 'a': alts}
    for t, sk in keys.items():
        for s, d in sk.items():
            assert len(d) == 40, (book, t, s, len(d))
    return keys

# ---------------------------------------------------------------- text helpers

HEAD = re.compile(r'^[\W_]{0,3}Questions?\s+(\d{1,2})(?:\s*(?:[-–—~]|and|to)\s*(\d{1,2}))?(?!\d)')


def join_lines(prev, nxt):
    if prev.endswith('-') and nxt[:1].islower():
        w1 = re.findall(r'(\w+)-$', prev)
        w2 = re.findall(r'^(\w+)', nxt)
        # "non-" and "self-" keep their hyphen in these books, though the word list also has "nonnative"
        if w1 and w2 and WORDS and (w1[0] + w2[0]).lower() in WORDS and w1[0].lower() not in ('non', 'self'):
            return prev[:-1] + nxt
        return prev + nxt
    return prev + ' ' + nxt


# ---------------------------------------------------------------- question groups

def split_groups(rows, lo, hi):
    """Split rows of a question region into groups by 'Questions a-b' headings."""
    groups, cur = [], {'from': lo, 'to': hi, 'rows': [], 'implicit': True}
    groups.append(cur)
    for r in rows:
        m = HEAD.match(r['t'])
        if m and re.match(r'^\s*[.,;]', r['t'][m.end():]) :
            m = None      # "...next to Questions 25-30." continues the instructions
        if m and lo <= int(m.group(1)) <= hi:
            a = int(m.group(1)); b = int(m.group(2) or a)
            if not (a <= b <= hi):
                b = a
            cur = {'from': a, 'to': b, 'rows': [], 'head': r}
            groups.append(cur)
            rest = r['t'][m.end():].strip()
            if rest:
                cur['rows'].append(dict(r, t=rest))
            continue
        cur['rows'].append(r)
    if len(groups) > 1 and groups[0].get('implicit'):
        if groups[1]['from'] == groups[0]['from']:
            pre = groups.pop(0)['rows']
            if pre:
                groups[0]['pre'] = pre
        else:
            groups[0]['to'] = groups[1]['from'] - 1
    return [g for g in groups if g['rows'] or g.get('pre')]


# ---------------------------------------------------------------- reading passages

def passage(rows, part_lo, forced_title=None):
    """Split a reading segment into passage blocks and question rows."""
    hs = sorted(r['h'] for r in rows if len(r['t']) > 20) or [0.016]
    med = statistics.median(hs)
    start = 0
    for i, r in enumerate(rows):
        if re.match(r'^You should spend about', r['t']):
            start = i + 1
            if i + 1 < len(rows) and re.match(r'^(Passage|Reading Passage) \d', rows[i + 1]['t']):
                start = i + 2
            break
    def prose(r):
        t = r['t']
        return (len(t) > 40 and not HEAD.match(t) and not INSTR.match(t) and not re.match(r'^(\d{1,2}\b|' + ROMAN + r'[.)]?\s)', t)
                and not GAP.search(t))
    def open_end(r):
        return not re.search(r'[.?!\'"]$', r['t'].strip())
    B = None
    for i in range(start, len(rows) - 2):
        run = rows[i:i + 4]
        if prose(rows[i]) and sum(prose(x) for x in run) >= 3 and sum(open_end(x) for x in run) >= 2:
            B = i; break
    title_rows = []
    title_i = B if B is not None else start

    def titleish(r):
        t = r['t']
        return (len(t) < 100 and not HEAD.match(t) and not INSTR.match(t) and not re.match(r'^(\d|List of|[A-L]\s)', t)
                and not re.search(r'[,;:]$', t) and not t[:1].islower())
    if B is not None and B - 1 >= start and titleish(rows[B - 1]):
        title_i = B - 1
        title_rows = [rows[B - 1]]
        if B - 2 >= start and titleish(rows[B - 2]) and len(rows[B - 2]['t']) < 70:
            r2, r1 = rows[B - 2], rows[B - 1]
            if r2['h'] > r1['h'] * 1.2:
                title_i = B - 2; title_rows = [r2]          # title + subtitle
            elif abs(r2['h'] - r1['h']) < med * 0.3 and r2['h'] > med * 1.3:
                title_i = B - 2; title_rows = [r2, r1]      # title wrapped over two rows
    if forced_title:
        kt = _k(forced_title)
        for i in range(start, len(rows)):
            kr = _k(rows[i]['t'])
            if len(kr) >= 6 and (kt.startswith(kr[:14]) or kr.startswith(kt[:14])) and not HEAD.match(rows[i]['t']):
                title_i = i; title_rows = [rows[i]]
                acc = kr
                j = i + 1
                while j < len(rows) and len(acc) < len(kt) and _k(rows[j]['t']) and _k(rows[j]['t']) in kt:
                    title_rows.append(rows[j]); acc += _k(rows[j]['t']); j += 1
                break
    no_title = not title_rows
    end = len(rows)
    for i in range(title_i + 1, len(rows)):
        if HEAD.match(rows[i]['t']):
            end = i; break
    q_rows = rows[start:title_i] + rows[end:]
    p_rows = rows[title_i:end]
    # rebuild passage text from lines in column order
    lines = [l for r in p_rows for l in r['lines'] if not re.fullmatch(r'[.…·_\s]+', l['t'])]     # dotted rules
    pages = sorted({l['page'] for l in lines})
    ordered = []
    for p in pages:
        ordered.extend(reading_order([l for l in lines if l['page'] == p]))
    title = ''
    if p_rows and not no_title:
        tl = [l for r in title_rows for l in r['lines']]
        title = fix_text(' '.join(l['t'] for l in tl))
        ordered = [l for l in ordered if l not in tl]
    # a short mark in the margin, left of the text column, is a paragraph letter - even when it was misread
    # ("4" for A, "Fr" for F): fill_labels names it from its place in the sequence
    from collections import Counter
    for p in pages:
        on_page = [l for l in ordered if l['page'] == p]
        xs = Counter(round(l['x'], 2) for l in on_page if len(l['t']) > 40)
        if not xs:
            continue
        col_x = min([x for x, n in xs.items() if n >= max(3, max(xs.values()) // 4)] or [min(xs)])
        for l in on_page:
            t = l['t'].strip()
            if len(t) <= 2 and l['x'] < col_x - 0.015 and l['x'] > col_x - 0.09 and not re.fullmatch(r'[A-L]', t) and not t.startswith('*'):
                l['t'] = UNKNOWN
    # put margin letters right before the text line they label
    letters = [l for l in ordered if re.fullmatch(r'[A-L][.)]?', l['t'].strip()) or l['t'].strip() == UNKNOWN]
    for L in letters:
        cands = [l for l in ordered if l is not L and l['page'] == L['page'] and l['x'] > L['x'] and abs(l['y'] - L['y']) < 0.012 and len(l['t']) > 3]
        if cands:
            tgt = min(cands, key=lambda l: (abs(l['y'] - L['y']), l['x']))
            ordered.remove(L)
            ordered.insert(ordered.index(tgt), L)
    # footnotes ("* guild: an association of ...") sit at the foot of a page, in the middle of the text flow
    notes, body_lines, in_note = [], [], None
    for l in ordered:
        if re.match(r'^\*+\s*\S', l['t']) and l['y'] > 0.5:
            in_note = l; notes.append([l]); continue
        if in_note is not None and l['page'] == in_note['page'] and l['y'] > in_note['y'] and l['h'] < med * 0.95:
            notes[-1].append(l); continue
        in_note = None
        body_lines.append(l)
    # the strapline under a title: one or two short centred lines before the text proper
    sub = []
    long_lines = [l for l in body_lines if len(l['t']) > 50]
    if long_lines:
        left = min(l['x'] for l in long_lines)
        right = max(l['x'] + l['w'] for l in long_lines)
        while len(sub) < 3 and len(body_lines) > 5:
            l = body_lines[0]
            ml, mr = l['x'] - left, right - (l['x'] + l['w'])
            centred = ml > 0.05 and mr > 0.05 and abs(ml - mr) < 0.04
            if not (centred and len(l['t']) < 100 and not re.fullmatch(r'[A-L]|' + UNKNOWN, l['t'].strip())):
                break
            sub.append(body_lines.pop(0))
    blocks = paragraphs(body_lines, med)
    if sub:
        blocks.insert(0, {'text': re.sub(r'\s+', ' ', ' '.join(fix_text(l['t']) for l in sub)).strip(), 'sub': 1})
    for n in notes:
        blocks.append({'text': re.sub(r'\s+', ' ', ' '.join(l['t'] for l in n)).strip(), 'fn': 1})
    return title_case(title), blocks, q_rows


def paragraphs(lines, med):
    blocks = []
    cur = None
    prev = None
    nexts = {id(a): b for a, b in zip(lines, lines[1:])}
    col_w = statistics.median([l['w'] for l in lines if len(l['t']) > 25] or [0.4])
    pitches = [b['y'] - a['y'] for a, b in zip(lines, lines[1:])
               if a['page'] == b['page'] and abs(a['x'] - b['x']) < 0.1 and 0.005 < b['y'] - a['y'] < 0.05]
    pitch = statistics.median(pitches) if pitches else 0.02
    for l in lines:
        t = fix_text(l['t'])
        if not t:
            continue
        label = None
        if t == UNKNOWN:
            t = '?'             # a paragraph letter that is on the page but could not be read (named in fill_labels)
        if re.fullmatch(r'[A-L?]', t) or re.fullmatch(r'[A-L][.)]?', t):
            pending = t[0]
            cur = {'label': pending, 'text': ''}
            blocks.append(cur); prev = l; continue
        m = re.match(r'^([A-L])\s+([A-Z"\'‘(].*)$', t)
        if m and len(t) > 20:
            nxt = nexts.get(id(l))
            hanging = nxt is not None and nxt['page'] == l['page'] and 0 < nxt['y'] - l['y'] < 0.05 and nxt['x'] - l['x'] > 0.015
            if hanging or (prev is not None and (l['x'] < prev['x'] - 0.01 or (cur and cur['text'].rstrip()[-1:] in '.?!"\''))):
                label, t = m.group(1), m.group(2)
        new = cur is None or label is not None
        if not new and prev is not None and cur['text']:
            same_col = abs(l['x'] - prev['x']) < 0.1 and l['page'] == prev['page'] and l['y'] > prev['y']
            dy = l['y'] - prev['y']
            ended = cur['text'].rstrip()[-1:] in '.?!"\')' and prev['w'] < col_w * 0.86
            if same_col and dy > pitch * 1.45:
                new = True
            elif same_col and l['x'] - prev['x'] > 0.012 and ended:
                new = True                     # indented first line
            elif ended and not same_col and (l['x'] - min(prev['x'], l['x'])) > 0.012:
                new = True
            elif ended and same_col and prev['w'] < col_w * 0.7:
                new = True
            if cur.get('label') and not cur['text']:
                new = False
        if new:
            cur = {'text': t}
            if label:
                cur['label'] = label
            if l['h'] > med * 1.2 and len(t) < 70 and not re.search(r'[.?!]$', t):
                cur['h'] = 1
            blocks.append(cur)
        else:
            cur['text'] = join_lines(cur['text'], t) if cur['text'] else t
        prev = l
    out = []
    for b in blocks:
        if not b.get('text'):
            continue
        b['text'] = re.sub(r'\s+', ' ', b['text']).strip()
        if b.get('h') and (len(b['text']) > 80 or re.search(r'[.?!,;]$', b['text'])):
            del b['h']
        prev = out[-1] if out else None
        if (prev and not b.get('label') and not b.get('h') and not prev.get('h')
                and not re.search(r'[.?!:"\'”’)]$', prev['text']) and re.match(r'^[a-z(,;\-–]', b['text'])):
            prev['text'] = join_lines(prev['text'], b['text'])   # split at a column or page break
            continue
        out.append(b)
    return out


def _k(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def strip_title(blocks, title):
    """Remove the title (and short title-like rows) that ended up at the top of the passage text."""
    words = title.split()
    out = list(blocks)
    while out and len(out[0]['text']) < 120 and _k(out[0]['text']) and (_k(out[0]['text']) in _k(title) or _k(title).startswith(_k(out[0]['text'])[:15])):
        out.pop(0)
    if out:
        t = out[0]['text']
        kt = _k(title)
        # title glued to the start of the first paragraph
        for n in range(len(words), 1, -1):
            pre = ' '.join(words[:n])
            if _k(t).startswith(_k(pre)) and len(_k(pre)) >= len(kt) * 0.95:
                cut = 0; acc = ''
                for i, ch in enumerate(t):
                    if ch.isalnum():
                        acc += ch.lower()
                    if acc == _k(pre):
                        cut = i + 1; break
                rest = t[cut:].lstrip(' :-–')
                if rest[:1].isupper() or rest[:1] in '\'"‘“':
                    out[0] = dict(out[0], text=rest)
                break
    return out


def fill_labels(blocks, groups):
    """Recover paragraph letters (A, B, C...) that OCR missed, using 'has six paragraphs, A-F' in the questions."""
    last = None
    for g in groups:
        m = re.search(r'has \w+ (?:paragraphs|sections),?\s*(?:labelled\s*)?A\s*[-–—]\s*([B-L])', ' '.join(g['instr']))
        if m:
            last = m.group(1); break
    if not last:
        for b in blocks:
            if b.get('label') == '?':
                del b['label']
        return blocks
    body = [b for b in blocks if not b.get('h') and not b.get('fn') and not b.get('sub')]
    n_want = ord(last) - ord('A') + 1
    marked = [b for b in body if b.get('label')]
    if len(marked) == n_want:
        # as many margin marks as there are paragraphs: they are A, B, C... in order, however each was read
        for i, blk in enumerate(marked):
            blk['label'] = chr(ord('A') + i)
        return blocks
    # an unread letter is the missing one if the letters around it leave exactly that hole; otherwise it was not a letter
    for i, b in enumerate(body):
        if b.get('label') != '?':
            continue
        before = [x['label'] for x in body[:i] if x.get('label') and x['label'] != '?']
        after = [x['label'] for x in body[i + 1:] if x.get('label') and x['label'] != '?']
        want = chr(ord(before[-1]) + 1) if before else 'A'
        if want <= last and (not after or want < after[0]) and want not in before:
            b['label'] = want
        else:
            del b['label']
    for b in body:
        m = re.match(r'^4\s+(?=[A-Z])', b['text'])
        if m and not b.get('label') and not any(x.get('label') == 'A' for x in body):
            b['label'] = 'A'; b['text'] = b['text'][m.end():]
    n = ord(last) - ord('A') + 1
    # inside a lettered section, an unlabelled block that continues the sentence belongs to it
    merged = []
    for b in body:
        p = merged[-1] if merged else None
        if p is not None and p.get('label') and not b.get('label') and not re.search(r'[.?!"\'”’)]$', p['text']):
            p['text'] = join_lines(p['text'], b['text']); b['_drop'] = 1
            continue
        merged.append(b)
    body = merged
    blocks = [b for b in blocks if not b.get('_drop')]
    # letters must run A, B, C...: repair duplicates and impossible letters (OCR reads B as I, etc.)
    prev = -1
    for b in body:
        if not b.get('label'):
            continue
        k = ord(b['label']) - ord('A')
        if k <= prev or k >= n:
            k = prev + 1
            if k >= n:
                del b['label']; continue
            b['label'] = chr(ord('A') + k)
        prev = k
    idx = {b['label']: i for i, b in enumerate(body) if b.get('label')}
    if not idx and len(body) == n:
        for i, b in enumerate(body):
            b['label'] = chr(ord('A') + i)
        return blocks
    if not idx:
        return blocks
    anchors = sorted((i, ord(l) - ord('A')) for l, i in idx.items())
    # before the first anchor
    i0, k0 = anchors[0]
    if i0 >= k0:
        for d in range(1, k0 + 1):
            body[i0 - d].setdefault('label', chr(ord('A') + k0 - d))
    # between anchors
    for (i1, k1), (i2, k2) in zip(anchors, anchors[1:]):
        if i2 - i1 == k2 - k1:
            for d in range(1, i2 - i1):
                body[i1 + d].setdefault('label', chr(ord('A') + k1 + d))
    # after the last anchor
    iz, kz = anchors[-1]
    if len(body) - 1 - iz == n - 1 - kz:
        for d in range(1, n - kz):
            body[iz + d].setdefault('label', chr(ord('A') + kz + d))
    return blocks


def title_case(t):
    if not t or not t.isupper():
        return t
    small = {'a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'at', 'by', 'from', 'with', 'is'}
    words = t.lower().split()
    return ' '.join(w if (i and w in small) else w[:1].upper() + w[1:] for i, w in enumerate(words))

# ---------------------------------------------------------------- transcripts

SPEAKER = re.compile(r"^([A-Z][A-Za-z'’ .]{1,24}|[A-Z]{2,}(?: [A-Z]+)?|[A-Z][\w'’./ -]{0,24}\([\w'’ ./-]{1,28}\)|Speaker \d):\s*")


MARK = re.compile(r'^[QO0CG(]\s?(\d{1,2})(?:\s*(?:[/&,–-]|and)\s*(\d{1,2}))?[.)]?$')


def transcript(rows, lo=1, hi=40):
    """Audioscript paragraphs. The book prints "Q12" in the margin where an answer is given; these become
    markers ("marks": [[character position, [question numbers]]]) so the review screen can point at them."""
    paras, cur, prev = [], None, None
    pending_speaker = None
    for r in rows:
        # margin markers are their own OCR fragment: "Q12", "Q21/22", and misreadings such as "06" for Q6
        qs, keep = [], []
        for l in r['lines']:
            m = MARK.match(l['t'].strip())
            if m and l['x'] > 0.6 and all(lo <= int(x) <= hi for x in m.groups() if x):
                qs += [int(x) for x in m.groups() if x]
            else:
                keep.append(l['t'])
        t = fix_text(' '.join(keep))
        t = re.sub(r'\bExample\b\s*$', '', t).strip()
        for m in re.finditer(r'\bQ\s?(\d{1,2})\b(?:\s*(?:[/&]|and)\s*(\d{1,2})\b)?', t):
            qs += [int(x) for x in m.groups() if x and lo <= int(x) <= hi]
        t = re.sub(r'\s*\bQ\s?\d{1,2}\b(\s*([/&]|and)\s*\d{1,2})?', '', t).strip()
        if not t and not qs:
            continue
        if not t and cur is not None:
            cur['q'] = cur['q'] + qs
            cur.setdefault('marks', []).append([len(cur['t']), qs])
            continue
        if not t:
            continue
        if r['x'] < 0.16:               # a speaker's name in small capitals, as tesseract reads it: "russ: You mean ..."
            t = re.sub(r'^[a-z]{2,12}:(?=\s|$)', lambda m: m.group(0).upper(), t)
        m = SPEAKER.match(t)
        spk = None
        if m and (m.group(1).isupper() or r['x'] < 0.16):
            spk = m.group(1).upper(); t = t[m.end():]
        if not t and spk:
            pending_speaker = spk; continue
        if pending_speaker and not spk:
            spk, pending_speaker = pending_speaker, None
        gap = (r['y'] - prev['y1']) if prev and prev['page'] == r['page'] else 0
        if spk or cur is None or gap > 0.014:
            cur = {'t': t, 'q': qs}
            if spk:
                cur['s'] = spk
            paras.append(cur)
        else:
            cur['t'] = join_lines(cur['t'], t)
            cur['q'] = cur['q'] + qs
        if qs:
            cur.setdefault('marks', []).append([len(cur['t']), qs])
        prev = r
    for p in paras:
        if not p['q']:
            del p['q']
    # a talk printed as one unbroken block (retyped transcripts): break it into readable paragraphs at sentence ends
    out = []
    for p in paras:
        if len(p['t']) < 1400 or p.get('marks'):
            out.append(p); continue
        rest, first = p['t'], True
        while len(rest) > 900:
            cut = max(rest.rfind('. ', 300, 800), rest.rfind('? ', 300, 800))
            if cut < 0:
                break
            piece = {'t': rest[:cut + 1]}
            if first and p.get('s'):
                piece['s'] = p['s']
            out.append(piece); first = False
            rest = rest[cut + 2:]
        last = {'t': rest}
        if first and p.get('s'):
            last['s'] = p['s']
        out.append(last)
    return out

# ---------------------------------------------------------------- writing & speaking

def writing(rows, n):
    text, fig_rows, after = [], [], False
    for r in rows:
        t = fix_text(r['t'])
        if after:
            fig_rows.append(r); continue
        if text and r['y'] - text[-1]['y1'] < 0.012 and r['page'] == text[-1]['page'] and not re.match(r'^(Write at least|You should spend)', t):
            text[-1]['t'] = join_lines(text[-1]['t'], t); text[-1]['y1'] = r['y1']
        else:
            text.append({'t': t, 'y1': r['y1'], 'page': r['page']})
        if re.match(r'^Write at least', t):
            after = True
    out = {'n': n, 'text': [x['t'] for x in text]}
    if n == 1 and not fig_rows and text:
        # a chart with no text of its own (a picture): everything under the task down to the foot of the page
        out['fig'] = [{'page': text[-1]['page'], 'box': [0.04, round(min(0.9, text[-1]['y1'] + 0.01), 4), 0.92, round(0.93 - min(0.9, text[-1]['y1'] + 0.01), 4)]}]
    if n == 1 and fig_rows:
        crops = []
        for p in sorted({r['page'] for r in fig_rows}):
            rs = [r for r in fig_rows if r['page'] == p]
            y0 = max(0, min(r['y'] for r in rs) - 0.02)
            y1 = min(0.94, max(r['y1'] for r in rs) + 0.03)
            crops.append({'page': p, 'box': [0.04, round(y0, 4), 0.92, round(y1 - y0, 4)]})
        out['fig'] = crops
    last = max([x['page'] for x in text] or [0])
    out['pages'] = sorted({r['page'] for r in rows if r['page'] <= last})
    # anything printed after the task on later pages is a model answer (books that print them with the test)
    out['after'] = sorted({r['page'] for r in rows if r['page'] > last})
    return out


def speaking(rows):
    parts, cur = [], None
    page3 = None
    for r in rows:
        t = fix_text(r['t'])
        if page3 is not None and r['page'] > page3 and not t.endswith('?'):
            break                                   # what follows Part 3 on later pages is not the test (model answers)
        m = re.match(r'^PART\s*([123])\b', t)
        if m and m.group(1) == '3':
            page3 = r['page']
        if m:
            cur = {'n': int(m.group(1)), 'items': []}
            parts.append(cur); continue
        if cur is None:
            continue
        if re.match(r'^(Test \d+|LISTENING|READING|WRITING|SECTION \d|PART \d Questions)\b', t):
            break                                   # the next test starts on this page
        if re.fullmatch(r'[\W\d]*', t) or re.search(r'\d{6,}', t) or (t[:1].islower() and cur['n'] != 2 and not (cur['items'] and cur['items'][-1].get('q'))):
            continue
        if cur['n'] == 2 and r['x'] > 0.6:
            continue  # the side note "You will have to talk about the topic..."
        if cur['n'] == 2 and r['lines'] and r['lines'][0]['x'] < 0.6 and len(r['lines']) > 1:
            t = fix_text(' '.join(l['t'] for l in r['lines'] if l['x'] < 0.6))
        it = cur['items']
        t = re.sub(r'^•\s*', '', t)
        t = re.sub(r'^\d{1,2}[.)]\s+(?=[A-Z])', '', t)             # "1. How much walking ..." in a retyped book
        if re.match(r'^Please answer the questions', t):
            continue
        if re.match(r'^(The examiner asks|EXAMPLE$|Example questions:?$|Discussion topics:?$)', t):
            continue
        if it and it[-1].get('q') and not it[-1]['q'].rstrip().endswith(('?', ']')) and not t.endswith(':'):
            it[-1]['q'] = join_lines(it[-1]['q'], t); continue
        if cur['n'] == 2:
            if it and r['x'] > 0.15 and not t.startswith(('You should say', 'and ')) and it[-1].get('c') and r['y'] - it[-1]['y1'] < 0.02 and it[-1]['t'][-1:] not in ':' and not it[-1].get('b'):
                it[-1]['t'] = join_lines(it[-1]['t'], t); it[-1]['y1'] = r['y1']; continue
            bullet = r['x'] > 0.15 and it and any(x['t'].startswith('You should say') for x in it) and not t.startswith('and ')
            if it and not bullet and r['y'] - it[-1]['y1'] < 0.02 and not t.startswith(('You should say', 'and ')) and not it[-1].get('b') and it[-1]['t'][-1:] != ':':
                it[-1]['t'] = join_lines(it[-1]['t'], t); it[-1]['y1'] = r['y1']; continue
            it.append({'c': 1, 't': t, 'y1': r['y1'], **({'b': 1} if bullet else {})})
            continue
        if '?' in t or re.match(r'^(What|Why|How|Do|Does|Did|Is|Are|Which|Who|When|Where|Can|Could|Would|Should|In what|Have|Has)\b', t):
            it.append({'q': t})
        else:
            it.append({'topic': t})
    for p in parts:
        for i in p['items']:
            i.pop('y1', None)
    speaking.last_page = page3 if page3 is not None else max([r['page'] for r in rows] or [0])
    return parts

# ---------------------------------------------------------------- audio

def audio_map(book):
    """(test, part) -> URL path of the recording, relative to the cbt folder.

    Most books have one file per part. Where a part is split over several files (book 21: C21T1P1.1.mp3,
    C21T1P1.2.mp3) they are joined, without re-encoding, into media/<book>/T<t>P<p>.mp3.
    """
    found = {}
    for f in sorted(glob.glob(os.path.join(SRC, book, '*', '*.mp3')) + glob.glob(os.path.join(SRC, book, '*', '*.m4a'))):
        name = os.path.basename(f)
        if name.startswith('._'):
            continue
        m = (re.search(r'Test[ _-]?(\d)[ _-]*(?:Section|Part|audio)[ _-]?(\d)', name, re.I) or
             re.search(r'\b\d\d\.(\d)\.(\d)\b', name) or
             re.search(r'section\s*(\d)\s*-?\s*part\s*(\d)', name, re.I) or
             re.search(r'T(\d)[SP](\d)(?:\.(\d))?\.\w+$', name))
        if not m:
            print('  ! unmatched audio', name); continue
        t, p = int(m.group(1)), int(m.group(2))
        if book == '12' and t > 4:
            t -= 4
        seq = int(m.group(3) or 0) if m.re.groups >= 3 else 0
        found.setdefault((t, p), []).append((seq, f))
    out = {}
    for (t, p), files in found.items():
        files = [f for _, f in sorted(files)]
        if len(files) == 1:
            out[(t, p)] = 'audio/' + os.path.relpath(files[0], SRC)
        else:
            out[(t, p)] = join_audio(book, t, p, files)
    return out


def join_audio(book, t, p, files):
    rel = f'media/{book}/T{t}P{p}.mp3'
    dst = os.path.join(CBT, rel)
    if not os.path.exists(dst) or os.path.getmtime(dst) < max(os.path.getmtime(f) for f in files):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        lst = dst + '.txt'
        with open(lst, 'w') as fh:
            for f in files:
                fh.write("file '" + os.path.abspath(f).replace("'", "'\\''") + "'\n")
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', dst],
                           capture_output=True, text=True)
        os.remove(lst)
        if r.returncode:
            print('  ! could not join', rel, r.stderr.strip()[:200])
            return 'audio/' + os.path.relpath(files[0], SRC)
        print('  joined', rel, 'from', len(files), 'files')
    return rel

# ---------------------------------------------------------------- main

def rows_of(seg):
    return seg['rows'] if seg else []


def main():
    os.makedirs(os.path.join(CBT, 'data', 't'), exist_ok=True)
    overrides = {}
    op = os.path.join(HERE, 'overrides.json')
    if os.path.exists(op):
        overrides = json.load(open(op))
    as_fig = set(overrides.get('fig', []))      # "17-4:L4:31": show this question group as the picture from the book
    index = {'books': []}
    problems = []
    for book in BOOKS:
        print('book', book, flush=True)
        segs, labels = segment(book)
        keys = parse_keys(book)
        audio = audio_map(book)
        by = {}
        for s in segs:
            by.setdefault((s['kind'], s['test'], s['n']), []).append(s)
        import pymupdf
        pdf = pymupdf.open(glob.glob(os.path.join(SRC, book, '*.pdf'))[0])
        ratio = round(pdf[20].rect.height / pdf[20].rect.width, 4)
        binfo = {'id': book, 'name': f'Cambridge IELTS {book}', 'tests': []}
        for t in range(1, 5):
            tid = f'{book}-{t}'
            label = f'Test {labels[t - 1] or t}' if t - 1 < len(labels) else f'Test {t}'
            T = {'id': tid, 'book': book, 'n': t, 'label': label, 'ratio': ratio, 'L': {'parts': []}, 'R': {'parts': []}, 'W': {'tasks': []}, 'S': {}}
            # ---- listening
            for p in range(1, 5):
                seg = (by.get(('L', t, p)) or [None])[0]
                lo, hi = 10 * (p - 1) + 1, 10 * p
                groups = [build_group(g, keys[t]['L'], f"{tid}:L{p}:{g['from']}" in as_fig, book) for g in split_groups(rows_of(seg), lo, hi)]
                sseg = (by.get(('LS', t, p)) or [None])[0]
                part = {'n': p, 'from': lo, 'to': hi, 'groups': groups,
                        'pages': sorted({r['page'] for r in rows_of(seg)}),
                        'audio': audio.get((t, p)),
                        'script': transcript(rows_of(sseg), lo, hi) if sseg else None,
                        'scriptPages': sorted({r['page'] for r in rows_of(sseg)})}
                if not part['audio']:
                    problems.append(f'{tid} L{p}: no audio')
                if not sseg:
                    problems.append(f'{tid} L{p}: no transcript in PDF')
                T['L']['parts'].append(part)
            # ---- reading
            for p in range(1, 4):
                seg = (by.get(('R', t, p)) or [None])[0]
                rs = rows_of(seg)
                lo, hi = {1: (1, 13), 2: (14, 26), 3: (27, 40)}[p]
                for r in rs[:4]:
                    m = re.search(r'Questions\s*(\d+)\s*[-–]\s*(\d+)', r['t'])
                    if m:
                        lo, hi = int(m.group(1)), int(m.group(2)); break
                fixed = overrides.get('titles', {}).get(f'{tid}:{p}')
                title, blocks, qrows = passage(rs, lo, fixed) if rs else ('', [], [])
                if fixed:
                    title = fixed
                    blocks = strip_title(blocks, fixed)
                groups = [build_group(g, keys[t]['R'], f"{tid}:R{p}:{g['from']}" in as_fig, book) for g in split_groups(qrows, lo, hi)]
                blocks = fill_labels(blocks, groups)
                T['R']['parts'].append({'n': p, 'from': lo, 'to': hi, 'title': title, 'passage': blocks, 'groups': groups,
                                        'pages': sorted({r['page'] for r in rs})})
                if len(blocks) < 3:
                    problems.append(f'{tid} R{p}: passage looks short ({len(blocks)} blocks)')
            # ---- writing
            for n in (1, 2):
                seg = (by.get(('W', t, n)) or [None])[0]
                task = writing(rows_of(seg), n)
                ms = by.get(('M', t, n)) or []
                nxt = (by.get(('W', t, 2)) or [None])[0] if n == 1 else None
                stop = min([r['page'] for r in rows_of(nxt)] or [10 ** 6])
                task['samplePages'] = sorted({r['page'] for s in ms for r in s['rows']}) or [p for p in task['after'] if p < stop]
                del task['after']
                T['W']['tasks'].append(task)
            # ---- speaking
            seg = (by.get(('S', t, 1)) or [None])[0]
            sparts = speaking(rows_of(seg))
            T['S'] = {'parts': sparts, 'pages': sorted({r['page'] for r in rows_of(seg) if r['page'] <= speaking.last_page + 1}
                                                       if len({r['page'] for r in rows_of(seg)}) > 2 else {r['page'] for r in rows_of(seg)})}
            # ---- keys + per-question type
            T['key'] = {'L': keys[t]['L'], 'R': keys[t]['R']}
            for sk in ('L', 'R'):
                covered = set()
                for part in T[sk]['parts']:
                    for g in part['groups']:
                        covered.update(range(g['from'], g['to'] + 1))
                missing = sorted(set(range(1, 41)) - covered)
                if missing:
                    problems.append(f'{tid} {sk}: questions not in any group {missing}')
            ov = overrides.get('paths', {}).get(tid)
            if ov:
                apply_overrides(T, ov)
            json.dump(T, open(os.path.join(CBT, 'data', 't', f'{tid}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
            binfo['tests'].append({'id': tid, 'n': t, 'label': label,
                                   'titles': [p['title'] for p in T['R']['parts']],
                                   'audio': all(p['audio'] for p in T['L']['parts'])})
        index['books'].append(binfo)
    json.dump(index, open(os.path.join(CBT, 'data', 'index.json'), 'w'), ensure_ascii=False, indent=1)
    print('\n'.join(problems) or 'no problems')
    if lines_mod.FIX_MISSES:
        print('hand fixes that no longer match the OCR text (tools/fixes):')
        print('\n'.join('  ' + m for m in sorted(set(lines_mod.FIX_MISSES))))


def apply_overrides(T, ov):
    """overrides.json: {"11-1": {"R.parts.0.title": "...", ...}} - dotted paths, list indexes 0-based."""
    for path, val in ov.items():
        cur = T
        parts = path.split('.')
        for p in parts[:-1]:
            cur = cur[int(p)] if p.isdigit() else cur[p]
        last = parts[-1]
        cur[int(last) if last.isdigit() else last] = val


if __name__ == '__main__':
    main()
