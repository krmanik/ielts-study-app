"""Build app/data/book.json + app/data/search.json from the OCR cache.

Inputs (tools/cache):  lines.json (ocr_lines.py), badges.json (find_badges.py), durations.txt
Run:  python3 tools/build_data.py
"""
import json, os, re
from difflib import SequenceMatcher

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
OUT = os.path.join(HERE, '..', 'data')
LINES = {int(k): v for k, v in json.load(open(os.path.join(CACHE, 'lines.json'))).items()}
BADGES = {int(k): v for k, v in json.load(open(os.path.join(CACHE, 'badges.json'))).items()}
DUR = dict(l.split() for l in open(os.path.join(CACHE, 'durations.txt')) if l.strip())
NPAGES = 398

# The scan is missing printed pages 255-258; everything after is shifted by 4.
MISSING = [255, 256, 257, 258]
def pdf(book):
    if book in MISSING:
        raise ValueError(book)
    return book if book <= 254 else book - 4
def label(i):
    if i == 0: return 'Cover'
    if i in (1, 2): return 'Blurb'
    if i == 397: return 'Back cover'
    return str(i if i <= 254 else i + 4)

# ---------------------------------------------------------------- TOC (from book contents pp3-4)
SKILLS = [
    ('listening', 'Listening', 13, [
        ('Getting ready to listen', 15, [('Understanding the context', 15), ('Using the correct spelling', 16), ('Writing numbers', 17)]),
        ('Following a conversation', 18, [('Identifying the speakers', 18), ('Identifying function', 19), ('Understanding categories', 21)]),
        ('Recognising paraphrase', 22, [('Identifying distractors', 22), ('Recognising paraphrase', 23), ('Selecting from a list', 24)]),
        ('Places and directions', 25, [('Describing a place', 25), ('Following directions', 27), ('Labelling a map', 28)]),
        ('Listening for actions and processes', 29, [('Understanding mechanical parts', 29), ('Describing an action or process', 31), ('Describing a process', 32)]),
        ('Attitude and opinion', 33, [('Identifying attitudes and opinions', 33), ('Persuading and suggesting', 34), ('Reaching a decision', 35)]),
        ('Following a lecture or talk', 36, [('Identifying main ideas', 36), ('Understanding how ideas are connected', 38), ('Understanding an explanation', 38)]),
        ('Contrasting ideas', 39, [('Signposting words', 39), ('Comparing and contrasting ideas', 40), ('Using notes to follow a talk', 41)]),
    ]),
    ('reading', 'Reading', 42, [
        ('Reading strategies', 44, [('Using the features of a Reading passage', 44), ('Skimming a passage and speed reading', 46), ('Global understanding', 47)]),
        ('Descriptive passages', 48, [('Scanning for detail', 48), ('Using words from the passage', 49), ('Notes/flow-chart/diagram completion', 50)]),
        ('Understanding the main ideas', 55, [('Identifying the main idea', 55), ('Understanding the main points', 57), ('Identifying information in a passage', 58)]),
        ('Locating and matching information', 59, [('Identifying types of information', 59), ('Locating and matching information', 60), ('How ideas are connected', 63)]),
        ('Discursive passages', 64, [('Discursive passages', 64), ('Identifying theories and opinions', 66), ('Matching features', 67)]),
        ('Multiple-choice questions', 70, [('Understanding longer pieces of text', 70), ('Different types of multiple choice', 71), ("Identifying a writer's purpose", 72)]),
        ('Opinions and attitudes', 73, [('Argumentative texts', 73), ("Identifying the writer's views/claims", 75), ('Identifying grammatical features', 76)]),
        ('General Training Reading', 78, [('The General Training Reading paper', 78), ('Dealing with multiple texts', 83), ('Understanding work-related texts', 84)]),
    ]),
    ('writing', 'Writing', 91, [
        ('Academic Task 1 – Describing a chart, table or graph', 93, [('Understanding graphs, tables and charts', 93), ('More complex charts', 96), ('Improving your Task Achievement score', 97)]),
        ('Academic Task 1 – Comparing and contrasting graphs and tables', 100, [('Avoiding repetition', 100), ('Comparing and contrasting data', 102), ('Grammatical Accuracy – describing numbers and figures accurately', 104)]),
        ('Academic Task 1 – Describing diagrams', 106, [('Understanding a diagram', 106), ('Describing a process – coherence and cohesion', 107), ('Lexical Resource – being accurate', 108)]),
        ('Academic Task 1 – Describing maps', 110, [('Describing a map', 110), ('Describing changes in a place', 111), ('Grammatical Accuracy', 112)]),
        ('General Training Task 1 – A letter', 113, [('Understanding the task', 113), ('Improving your score', 115), ('Checking and correcting', 117)]),
        ('Task 2 – Getting ready to write', 119, [('Understanding the task', 119), ('Planning and organising your ideas', 120), ('Getting started – writing an introduction', 122)]),
        ('Task 2 – Expressing your ideas clearly', 124, [('Linking ideas – cohesion', 124), ('Lexical Resource – avoiding repetition', 125), ('Expressing a personal view', 127)]),
        ('Task 2 – Checking and correcting', 129, [('Developing your ideas clearly', 129), ('Grammatical Accuracy', 130), ('Assessing your language', 132)]),
    ]),
    ('speaking', 'Speaking', 134, [
        ('The Speaking Test – Part 1', 136, [('Getting ready to speak', 136), ('Part 1 – talking about familiar topics', 137), ('Using the right tense – Grammatical Range and Accuracy', 138)]),
        ('Part 2 – Giving a talk', 140, [('Understanding the task', 140), ('Improving Fluency and Coherence', 142), ('Organising your notes and your talk', 143)]),
        ('Part 3 – Talking about abstract topics', 145, [('Talking about abstract topics', 145), ('Agreeing and disagreeing', 147), ('Improving your Lexical Resource score', 148)]),
        ('Checking, correcting and assessing', 149, [('Dealing with problems', 149), ("Pronunciation, intonation and 'chunking'", 150), ('Assessing yourself and improving your score', 153)]),
    ]),
]
MATCH = {t: 'Academic Writing ' + t[len('Academic '):] for t in [u[0] for u in SKILLS[2][3]] if t.startswith('Academic')}
MATCH.update({t: 'General Training Writing ' + t[len('General Training '):] for t in [u[0] for u in SKILLS[2][3]] if t.startswith('General')})
MATCH.update({t: 'Writing ' + t for t in [u[0] for u in SKILLS[2][3]] if t.startswith('Task 2')})
# Units that only matter for one module (Academic vs General Training)
MODULE_ONLY = {('reading', 8): 'gt', ('writing', 1): 'ac', ('writing', 2): 'ac', ('writing', 3): 'ac',
               ('writing', 4): 'ac', ('writing', 5): 'gt'}

# Practice tests: pdf page indices (verified against OCR headings)
TESTS = [
    dict(n=1, L=[154, 155, 157, 159], R=[160, 163, 167], W=171, S=[172, 172], end=172),
    dict(n=2, L=[173, 174, 175, 176], R=[177, 180, 184], W=188, S=[189, 189], end=189),
    dict(n=3, L=[190, 191, 192, 194], R=[195, 198, 202], W=205, S=[206, 206], end=206),
    dict(n=4, L=[207, 208, 210, 212], R=[213, 216, 220], W=224, S=[225, 225], end=225),
    dict(n=5, L=[226, 227, 229, 231], R=[232, 235, 239], W=244, S=[245, 245], end=245),
    dict(n=6, L=[246, 247, 248, 250], R=[252, None, 255], W=260, S=[261, 261], end=261),
    dict(n=7, L=[262, 263, 265, 267], R=[268, 271, 275], W=279, S=[280, 281], end=281),
    dict(n=8, L=[296, 297, 299, 301], R=[302, 305, 309], W=313, S=[314, 314], end=314),
]
GT_TESTS = [dict(n='A', after=7, R=[282, 286, 290], W=295, end=295),
            dict(n='B', after=8, R=[315, 319, 323], W=328, end=328)]

def norm(s):
    return re.sub(r'[^a-z0-9 ]', '', s.lower().replace('’', "'").replace('—', '-').replace('–', '-'))

def sim(a, b):
    return SequenceMatcher(None, norm(a), norm(b)).ratio()

def find_heading(page, title, num=None, min_ratio=0.62):
    """Best OCR line on `page` matching '<num> <title>' -> (y, ratio)."""
    best = (None, 0)
    for t, x, y, w, h in LINES.get(page, []):
        cand = re.sub(r'^\W*\d\s*', '', t)
        r = max(sim(cand, title), sim(cand[:len(title) + 4], title))
        if r > best[1]:
            best = (y, r)
    return best if best[1] >= min_ratio else (None, best[1])

def reading_order(pages):
    """Lines of two-column pages in reading order: page, column, y."""
    out = []
    for p in pages:
        for t, x, y, w, h in LINES.get(p, []):
            out.append((p, 1 if x > 0.47 else 0, y, x, t))
    return sorted(out)

def locate_seq(pages, titles):
    """Walk `titles` in order through the reading-order lines of `pages`; returns [(page, y) | None]."""
    lines = reading_order(pages); pos = 0; res = []
    for title in titles:
        hit = None
        for k in range(pos, len(lines)):
            p, c, y, x, t = lines[k]
            cand = re.sub(r'^\W*\d\s*', '', t)
            if len(cand) > 3 and max(sim(cand, title), sim(cand[:len(title) + 3], title)) > 0.8:
                hit = (p, y); pos = k + 1; break
        res.append(hit)
    return res

# ---------------------------------------------------------------- build skills tree
modules = []
for key, name, intro, units in SKILLS:
    mod = dict(id=key, title=name, intro=[pdf(intro), pdf(units[0][1]) - 1], units=[])
    for ui, (utitle, ustart, subs) in enumerate(units, 1):
        unit = dict(id=f'{key}-{ui}', n=ui, title=utitle, match=MATCH.get(utitle, utitle), start=pdf(ustart), sections=[],
                    only=MODULE_ONLY.get((key, ui)))
        for si, (stitle, sstart) in enumerate(subs, 1):
            y, _ = find_heading(pdf(sstart), stitle)
            unit['sections'].append(dict(id=f'{key}-{ui}-{si}', n=si, title=stitle, start=pdf(sstart), y=y))
        mod['units'].append(unit)
    modules.append(mod)

# end pages. Units start on a fresh page; sections inside a unit may start mid-page, in which case the
# previous section also shows that shared page.
unit_list = [u for m in modules for u in m['units']]
next_start = {}
for mi, m in enumerate(modules):
    for ui, u in enumerate(m['units']):
        if ui + 1 < len(m['units']):
            next_start[u['id']] = m['units'][ui + 1]['start']
        else:
            next_start[u['id']] = modules[mi + 1]['intro'][0] if mi + 1 < len(modules) else pdf(154)
for u in unit_list:
    u['end'] = next_start[u['id']] - 1
    secs = u['sections']
    for a, b in zip(secs, secs[1:]):
        nb, by = b['start'], b.get('y')
        a['end'] = nb if (nb > a['start'] and (by is None or by > 0.16)) else max(a['start'], nb - 1)
    secs[-1]['end'] = u['end']

def locate_titles(pages, titles, start_title):
    """Sequential walk of titles through pages, beginning after start_title."""
    lines = reading_order(pages); pos = 0; res = []
    def match(t, title):
        cand = re.sub(r'^\W*\d\s*', '', t)
        if len(cand) <= 3:
            return False
        r = max(sim(cand, title), sim(cand[:len(title) + 3], title))
        if len(cand) >= 18:
            r = max(r, sim(cand.rstrip(' -—–'), title[:len(cand.rstrip(' -—–'))]))
        return r > 0.84
    for k, l in enumerate(lines):
        if match(l[4], start_title):
            pos = k + 1; break
    else:
        return [None] * len(titles)
    for title in titles:
        hit = None
        for k in range(pos, min(len(lines), pos + 140)):
            p, c, y, x, t = lines[k]
            if match(t, title):
                hit = (p, y); pos = k + 1; break
        res.append(hit)
    return res

# answer key / scripts locations for each unit + section (one ordered walk per module)
KEY_PAGES = list(range(pdf(366), pdf(387) + 1))
SCRIPT_PAGES = list(range(pdf(333), pdf(340) + 1))
for m in modules:
    objs = [o for u in m['units'] for o in [u] + u['sections']]
    titles = [o.get('match', o['title']) for o in objs]
    for rng, field in ((KEY_PAGES, 'key'), (SCRIPT_PAGES, 'script')):
        if field == 'script' and m['id'] != 'listening':
            continue
        for o, hit in zip(objs, locate_titles(rng, titles, m['title'] + ' skills')):
            if hit:
                o[field] = dict(page=hit[0], y=round(max(0, hit[1] - 0.02), 3))
    for u in m['units']:
        for field in ('key', 'script'):
            if field not in u and field in u['sections'][0]:
                u[field] = u['sections'][0][field]
            for s in u['sections']:
                if field not in s and field in u:
                    s[field] = u[field]
# speaking pronunciation scripts (tracks 34-38) live after listening scripts
for s in modules[3]['units'][3]['sections'][1:2]:
    s['script'] = dict(page=pdf(340), y=0.34)

# ---------------------------------------------------------------- tracks
def line_at(page, y, x):
    best = None
    for t, lx, ly, w, h in LINES.get(page, []):
        d = abs(ly - y) + 0.3 * abs(lx - x)
        if abs(ly - y) < 0.03 and (best is None or d < best[0]):
            best = (d, t)
    return best[1] if best else ''

skill_badges = []   # (page, y, x) in reading order, pages 13-41
for p in sorted(BADGES):
    if 13 <= p <= 41:
        for b in sorted(BADGES[p], key=lambda b: (b['x'] > 0.5, b['y'])):
            skill_badges.append((p, b['y'], b['x'], b['num']))

# Manually verified sequence of badge -> track numbers (OCR noise fixed: '61'->6, '121'->12 ...; p36/p37 replay 27)
SEQ = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 27, 27, 28, 29, 30, 31, 32, 33]
assert len(SEQ) == len(skill_badges), (len(SEQ), len(skill_badges))

tracks = {n: dict(n=n, file=f'Cam{n:02d}.mp3', dur=round(float(DUR[f'Cam{n:02d}']), 1), refs=[]) for n in range(1, 71)}
tracks[1].update(title='Introduction', group='intro')
for (p, y, x, ocr), n in zip(skill_badges, SEQ):
    txt = line_at(p, y, x)
    ex = re.match(r'^\W*(\d\.\d{1,2})', txt)
    tracks[n]['refs'].append(dict(page=p, y=round(y, 4), x=round(x, 4), ex=ex.group(1) if ex else None))
# speaking pronunciation tracks (badges in a different colour; located from OCR text)
for n, p in zip(range(34, 39), [150, 150, 151, 151, 152]):
    for t, x, y, w, h in LINES[p]:
        if re.search(r'[>»)|]\s*%d\b' % n, t):
            ex = re.match(r'^\W*(\d\.\d{1,2})', t)
            tracks[n]['refs'].append(dict(page=p, y=round(y, 4), x=round(x, 4), ex=ex.group(1) if ex else None))
            break
    assert tracks[n]['refs'], n

def unit_of(page):
    for m in modules:
        for u in m['units']:
            if u['start'] <= page <= u['end']:
                return m, u
    return None, None
for n in range(2, 39):
    m, u = unit_of(tracks[n]['refs'][0]['page'])
    ex = tracks[n]['refs'][0]['ex']
    tracks[n].update(group=m['id'], unit=u['id'], title=f"{m['title']} {u['n']} · {u['title']}" + (f' — Ex {ex}' if ex else ''))

# practice test tracks: Test N Section S = 39 + 4(N-1) + (S-1)
for t in TESTS:
    for s in range(4):
        n = 39 + 4 * (t['n'] - 1) + s
        tracks[n].update(group='tests', test=t['n'], section=s + 1, title=f"Test {t['n']} · Listening Section {s + 1}",
                         refs=[dict(page=t['L'][s], y=0.05, x=0.05, ex=None)])

# script pages for tracks: badge anchors on script pages (+ carry-forward for badges the detector missed)
script_anchor = {}
for p in range(pdf(333), pdf(365) + 1):
    for b in sorted(BADGES.get(p, []), key=lambda b: (b['x'] > 0.5, b['y'])):
        if b['num'].isdigit() and 2 <= int(b['num']) <= 70:
            script_anchor.setdefault(int(b['num']), dict(page=p, y=round(max(0, b['y'] - 0.03), 3)))
# test sections: from 'Practice Test N / Listening Section S' headings in scripts
SCRIPT_TEST = locate_seq(list(range(pdf(341), pdf(365))),
                         [x for n in range(1, 9) for x in [f'Practice Test {n}'] + [f'Listening Section {s}' for s in range(1, 5)]])
for n in range(1, 9):
    for s in range(1, 5):
        hit = SCRIPT_TEST[(n - 1) * 5 + s]
        if hit:
            script_anchor[39 + 4 * (n - 1) + s - 1] = dict(page=hit[0], y=round(max(0, hit[1] - 0.02), 3))
last = dict(page=pdf(333), y=0.1)
for n in range(2, 71):
    if n in script_anchor:
        last = script_anchor[n]
    else:
        # fall back to the section heading of the exercise's unit script, else previous anchor
        u = next((u for m in modules for u in m['units'] if u['id'] == tracks[n].get('unit')), None)
        cand = [s.get('script') for s in (u['sections'] if u else []) if s['start'] <= tracks[n]['refs'][0]['page'] <= s['end']]
        if cand and cand[0] and (cand[0]['page'], cand[0]['y']) >= (last['page'], last['y']):
            last = cand[0]
    tracks[n]['script'] = last

# ---------------------------------------------------------------- answer key parsing for practice tests
def section_titles():
    out = []
    for t in TESTS:
        out.append(('T', t['n'], f"Practice Test {t['n']}"))
        out += [('L', t['n'], s, f'Listening Section {s}') for s in range(1, 5)]
        out += [('R', t['n'], s, f'Reading Passage {s}') for s in range(1, 4)]
        out += [('W', t['n'], s, f'Writing Task {s}') for s in range(1, 3)]
        gt = next((g for g in GT_TESTS if g['after'] == t['n']), None)
        if gt:
            out += [('G', gt['n'], s, f'General Training Reading Section {s}') for s in range(1, 4)]
    return out

KEY_TEST_PAGES = list(range(pdf(386), pdf(396) + 1))
lines = reading_order(KEY_TEST_PAGES)
def is_head(t, title):
    return len(t) < len(title) + 6 and sim(t, title) > 0.85

# locate each 'Practice Test N' block first, then search that block's sub-headings inside it only
test_pos = {}
pos = 0
for n in range(1, 9):
    for k in range(pos, len(lines)):
        if is_head(lines[k][4], f'Practice Test {n}'):
            test_pos[n] = k; pos = k + 1; break
heads = []
for item in section_titles():
    if item[0] == 'T':
        n = item[1]; heads.append((test_pos[n], item))
        pos, stop = test_pos[n] + 1, test_pos.get(n + 1, len(lines))
        continue
    for k in range(pos, stop):
        if is_head(lines[k][4], item[-1]):
            heads.append((k, item)); pos = k + 1; break
    else:
        print('   (no key heading)', item)

TSV_DIR = os.path.join(CACHE, 'tsv')
def load_words(page):
    import csv
    out = []; W = H = 1
    for r in csv.reader(open(os.path.join(TSV_DIR, f'p{page:03d}.tsv'), encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE):
        if len(r) < 12 or r[0] == 'level':
            continue
        lvl, x, y, w, h = int(r[0]), *map(int, r[6:10])
        if lvl == 1:
            W, H = w, h
        t = r[11].strip()
        if lvl == 5 and t:
            out.append(dict(t=t, x=x / W, y=y / H, r=(x + w) / W, h=h / H, page=page, col=1 if x / W > 0.47 else 0))
    return [w for w in out if 0.045 < w['y'] < 0.93 and not re.search(r'tailieu|IELTS|materials|^\|$|^Answer$|^key$|^@$', w['t'])]

WORDS = {p: load_words(p) for p in KEY_TEST_PAGES}
FIX = str.maketrans({'I': '1', 'l': '1', 'L': '1', 'Z': '2', 'z': '2', 'S': '5', 'O': '0', 'o': '0', '|': '1', ']': '1'})

def parse_answers(lo, hi, qmin, qmax):
    """Parse the answers for questions qmin..qmax printed between reading-order positions lo and hi."""
    ws = [w for p in WORDS for w in WORDS[p] if lo < (w['page'], w['col'], w['y']) < hi]
    for w in ws:
        w['t'] = w['t'].replace('—', '-').replace('’', "'")
    # 1. split glued label+letter tokens ('24C', '26B', '35&36')
    labels = []
    for w in ws:
        m = re.fullmatch(r'(\d{1,2})(?:\s*[&,]\s*(\d{1,2}))?([A-H])?[:.]?', w['t'])
        if m and qmin <= int(m.group(1)) <= qmax:
            q = int(m.group(1)); q2 = int(m.group(2)) if m.group(2) else q
            if q2 >= q and q2 - q <= 2:
                labels.append(dict(w=w, qs=list(range(q, q2 + 1)), tail=m.group(3)))
    # 2. keep labels that sit at the left of a line cell: nearly aligned (same x) with another label
    def aligned(l):
        return any(o is not l and o['w']['page'] == l['w']['page'] and abs(o['w']['x'] - l['w']['x']) < 0.012 for o in labels)
    labels = [l for l in labels if aligned(l)] or labels
    # 3. drop duplicates: a question keeps its first (reading-order) label
    seen = set(); uniq = []
    for l in sorted(labels, key=lambda l: (l['w']['page'], l['w']['col'], l['w']['x'] > 0, l['w']['y'])):
        if not seen.intersection(l['qs']):
            uniq.append(l); seen.update(l['qs'])
    labels = uniq
    # 4. recover OCR-mangled labels ('IZA' -> 12 A, 'L5G' -> 15 G) that line up with a label column
    cols = sorted({(l['w']['page'], round(l['w']['x'], 2)) for l in labels})
    for w in ws:
        if any(l['w'] is w for l in labels):
            continue
        m = re.fullmatch(r'([0-9IlLZzSO|\]]{1,2})([A-H])?', w['t'])
        if not m or not re.search(r'[IlLZzSO|\]]', m.group(1)):
            continue
        try:
            q = int(m.group(1).translate(FIX))
        except ValueError:
            continue
        if qmin <= q <= qmax and q not in seen and any(p == w['page'] and abs(x - w['x']) < 0.015 for p, x in cols):
            labels.append(dict(w=w, qs=[q], tail=m.group(2))); seen.add(q)
    # 5. assign every other word to the nearest label on its left (same page column), on its line or above
    body = {id(l['w']): [] for l in labels}
    lab_words = {id(l['w']) for l in labels}
    for w in ws:
        if id(w) in lab_words:
            continue
        best = None
        for l in labels:
            lw = l['w']
            if lw['page'] != w['page'] or lw['col'] != w['col'] or lw['x'] > w['x'] + 0.004:
                continue
            dy = w['y'] - lw['y']
            if dy < -0.006:
                continue
            # the owning label is the closest one above/at this line within the nearest sub-column
            key = (0 if dy < 0.008 else 1, -lw['x'], dy)
            if best is None or key < best[0]:
                best = (key, l)
        if best:
            # continuation lines only attach if no other label of that sub-column sits between
            l = best[1]
            between = [o for o in labels if o is not l and o['w']['page'] == w['page'] and abs(o['w']['x'] - l['w']['x']) < 0.015
                       and l['w']['y'] < o['w']['y'] <= w['y'] + 0.004]
            if not between:
                body[id(l['w'])].append(w)
    ans = {}
    for l in labels:
        words = sorted(body[id(l['w'])], key=lambda w: (round(w['y'] * 120), w['x']))
        text = ' '.join(([l['tail']] if l['tail'] else []) + [w['t'] for w in words])
        text = re.split(r'\s\((?=[A-Z…\.\'"‘ ]|In |Also|Jn |The |This )', text)[0]
        text = re.sub(r'\s+', ' ', text).strip(' .;:')
        either = bool(re.search(r'EITHER ORDER|in any order', text, re.I))
        text = re.sub(r'\(?\s*(IN EITHER ORDER|in any order)\s*\)?', '', text, flags=re.I).strip()
        for q in l['qs']:
            ans[q] = dict(a=text, group=l['qs'] if len(l['qs']) > 1 else None) if len(l['qs']) > 1 or either else text
    return ans

answers = {}
for idx, (k, item) in enumerate(heads):
    if item[0] not in ('L', 'R', 'G'):
        continue
    end = heads[idx + 1][0] if idx + 1 < len(heads) else len(lines)
    lo = lines[k][:3]; hi = lines[end][:3] if end < len(lines) else (999, 0, 0)
    kind, tn, sn = item[0], item[1], item[2]
    if kind == 'L':
        qmin, qmax = sn * 10 - 9, sn * 10
    else:
        qmin, qmax = [(1, 14), (13, 28), (26, 40)][sn - 1]
    parsed = parse_answers(lo, hi, qmin, qmax)
    tid = f'gt{tn}' if kind == 'G' else f't{tn}'
    part = 'listening' if kind == 'L' else 'reading'
    answers.setdefault(tid, {}).setdefault(part, {})
    answers[tid][part][sn] = parsed

sec_q = {(tid, sn): list(sec) for tid, parts in answers.items() for sn, sec in parts.get('reading', {}).items()}
# flatten per-section dicts into one {q: answer} per part and apply manual corrections
OVR = json.load(open(os.path.join(HERE, 'key_overrides.json')))
for tid, parts in answers.items():
    for part, secs in list(parts.items()):
        flat_ans = {}
        for sec in secs.values():
            for q, a in sec.items():
                flat_ans[int(q)] = a
        for q, a in OVR.get(tid, {}).get(part, {}).items():
            if '&' in q:
                qs = [int(x) for x in q.split('&')]
                for x in qs:
                    flat_ans[x] = dict(a=a, group=qs)
            else:
                flat_ans[int(q)] = a
        for q, a in list(flat_ans.items()):
            if isinstance(a, str):
                flat_ans[q] = re.sub(r'\s+(Listening|Reading|Task|Writing)$', '', a).strip()
        missing = [q for q in range(1, 41) if q not in flat_ans]
        if missing:
            print('   missing answers', tid, part, missing)
        parts[part] = {str(q): flat_ans[q] for q in sorted(flat_ans)}

# answer-key page (for the "view key" button) per test part
key_loc = {}
for k, item in heads:
    p, c, y, x, t = lines[k]
    kind = item[0]
    tid = (f'gt{item[1]}' if kind == 'G' else f't{item[1]}')
    part = {'T': 'test', 'L': 'listening', 'R': 'reading', 'W': 'writing', 'G': 'reading'}[kind]
    sub = item[2] if len(item) > 3 else 0
    key_loc.setdefault(tid, {}).setdefault(part, {})[sub] = dict(page=p, y=round(max(0, y - 0.02), 3))

tests = []
for t in TESTS:
    tid = f"t{t['n']}"
    L = [dict(n=s + 1, start=t['L'][s], end=(t['L'][s + 1] if s < 3 else t['R'][0] - 1), track=39 + 4 * (t['n'] - 1) + s,
              qs=[s * 10 + 1, s * 10 + 10], key=key_loc[tid]['listening'].get(s + 1), script=tracks[39 + 4 * (t['n'] - 1) + s]['script'])
         for s in range(4)]
    for a in L:
        # section 2..4 may start mid-page: include the start page of next section only if different
        nxt = [x for x in t['L'] + [t['R'][0]] if x and x > a['start']]
        a['end'] = max(a['start'], (nxt[0] if nxt else a['start']) - (0 if a['n'] < 4 else 1))
        if a['n'] < 4 and nxt and nxt[0] == a['start']:
            a['end'] = a['start']
    R = []
    rs = t['R']
    ans = answers.get(tid, {}).get('reading', {})
    for s in range(3):
        start = rs[s]
        if start is None:
            R.append(dict(n=s + 1, missing=True, start=rs[0] + 2, end=rs[0] + 2, qs=[14, 26],
                          key=key_loc[tid]['reading'].get(s + 1)))
            continue
        nxt = next((x for x in rs[s + 1:] if x), t['W'])
        qs = [(1, 13), (14, 26), (27, 40)][s]
        R.append(dict(n=s + 1, start=start, end=nxt - 1 if s < 2 else t['W'] - 1, qs=list(qs),
                      key=key_loc[tid]['reading'].get(s + 1)))
    tests.append(dict(id=tid, n=t['n'], title=f"Practice Test {t['n']}", kind='academic', start=t['L'][0], end=t['end'],
                      listening=L, reading=R,
                      writing=dict(start=t['W'], end=t['W'], key=key_loc[tid].get('writing', {}).get(1)),
                      speaking=dict(start=t['S'][0], end=t['S'][1]),
                      keyStart=key_loc[tid]['test'][0], answers=answers.get(tid, {})))
for g in GT_TESTS:
    tid = f"gt{g['n']}"
    ans = answers.get(tid, {}).get('reading', {})
    R = []
    for s in range(3):
        qs = [(1, 14), (15, 27), (28, 40)][s]
        R.append(dict(n=s + 1, start=g['R'][s], end=(g['R'][s + 1] - 1 if s < 2 else g['W'] - 1), qs=list(qs),
                      key=key_loc.get(tid, {}).get('reading', {}).get(s + 1)))
    tests.append(dict(id=tid, n=g['n'], title=f"General Training Test {g['n']}", kind='gt', after=g['after'],
                      start=g['R'][0], end=g['end'], reading=R, writing=dict(start=g['W'], end=g['W']),
                      answers=answers.get(tid, {})))

# model answers for GT writing are printed after the GT reading keys
# ---------------------------------------------------------------- front/back matter
extras = [
    dict(id='front-contents', title='Contents', start=3, end=4),
    dict(id='front-intro', title='Introduction', start=5, end=6),
    dict(id='front-summary', title='IELTS Summary', start=7, end=12),
    dict(id='scripts', title='Recording Scripts', start=pdf(333), end=pdf(365)),
    dict(id='key', title='Answer Key', start=pdf(366), end=pdf(396)),
    dict(id='sheets', title='Sample Answer Sheets', start=pdf(397), end=396),
]

book = dict(
    title='The Official Cambridge Guide to IELTS', pages=NPAGES,
    labels=[label(i) for i in range(NPAGES)], missing=dict(book=MISSING, after=pdf(254),
                                                             note='Book pages 255–258 (Test 6, Reading Passage 2) are missing from this scan.'),
    modules=modules, tests=tests, extras=extras,
    tracks=[tracks[n] for n in range(1, 71)],
    videos='Speaking units reference DVD videos (not included in the audio folder).',
)
os.makedirs(OUT, exist_ok=True)
json.dump(book, open(os.path.join(OUT, 'book.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
search = [[p, [[t, round(x, 3), round(y, 3), round(w, 3), round(h, 3)] for t, x, y, w, h in LINES[p]
           if not re.search(r'tailieutienganh|giasuIELTS', t)]] for p in range(NPAGES)]
json.dump(search, open(os.path.join(OUT, 'search.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('ok', os.path.getsize(os.path.join(OUT, 'book.json')), 'bytes;',
      sum(len(p) for t in answers.values() for p in t.values()), 'answers')
