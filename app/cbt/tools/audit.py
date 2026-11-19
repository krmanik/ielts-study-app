#!/usr/bin/env python3
"""Go through every part of every test and compare what the app shows with a second, independent reading of
the same pages (PaddleOCR-VL, see vl.py). Reports words the app lost and words the two readings disagree on.

    python3 tools/audit.py                 # every part that has been read by vl.py: summary per test
    python3 tools/audit.py 14-3            # one test, with each finding
    python3 tools/audit.py --tsv out.tsv   # all findings as a table (kind, test, part, page, app, other, context)

A finding is only reported when a third reading (tesseract, or Vision's other candidates) backs the second
one, because the layout model also invents words now and then:

    LOST   words on the page that are not on the screen           (a line OCR dropped)
    DIFF   a word the app reads differently from both other readings (a misreading: "modem" for "modern")

Nothing is changed here; corrections go to fixes/<book>.spelling.json or fixes/<book>.json as usual.
"""
import csv, difflib, glob, html, json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
CBT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, 'cache')
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]|\d[\d,.]*\d|\d")
SKIP_BLOCKS = {'header', 'footer', 'number', 'image', 'header_image', 'footer_image', 'aside_text', 'chart', 'seal'}
# wording the builder leaves out on purpose (the computer test has no answer sheet) and page furniture
BOILER = re.compile(r'(in\s+box(es)?\s+\d+\s*([-–—]|and)?\s*\d*\s+on\s+your\s+answer\s+sheet|on\s+your\s+answer\s+sheet|write\s+your\s+answers?|'
                    r'you\s+should\s+spend\s+about\s+\d+\s+minutes\s+on\s+.{0,40}?which\s+(are|is)\s+based\s+on\s+reading\s+passage\s+\d(\s+(below|on\s+pages?[\s\d,and]+))?|'
                    r'you\s+should\s+spend\s+about\s+\d+\s+minutes\s+on\s+this\s+task|next\s+to\s+questions?\s+\d+\s*([-–—]\s*\d+)?|'
                    r'reading\s+passage\s+\d|writing\s+task\s+\d|questions?\s+\d+\s*(([-–—]|and)\s*\d+)?|\b(part|section)\s+\d|'
                    r'^\s*(listening|reading|writing|speaking|example)\s*$|test\s+\d|ielts\w*\.?\w*|'
                    r'the\s+image\s+provided\s+does\s+not\s+contain\s+any\s+text[^.]*\.?)', re.I | re.S | re.M)


def norm(w):
    return w.lower().replace('’', "'").strip("'-")


def words(text):
    """Normalised words; a hyphenated word counts as its parts, so a word broken at a line end compares equal."""
    return [p for w in WORD.findall(text) for p in norm(w).split('-') if p]


def app_text(part, sk):
    """Everything the app shows for a part, as (passage text, question text)."""
    passage = ' '.join([part.get('title') or ''] + [b['text'] for b in part.get('passage', [])]) if sk == 'R' else ''
    q = []
    for g in part['groups']:
        q += g.get('instr', [])
        for r in g['rows']:
            q += [s for s in r.get('t', []) if isinstance(s, str)]
            if r.get('lab'):
                q.append(r['lab'])
        if g.get('table'):
            q.append(g['table'].get('title') or '')
            q += [x for row in g['table']['rows'] for cell in row for para in cell['p'] for x in para['t'] if isinstance(x, str)]
    return passage, ' '.join(q)


def vl_blocks(book, page):
    p = os.path.join(CACHE, book, f'{page}.vl.json')
    if not os.path.exists(p):
        return None
    out = []
    for b in json.load(open(p))['blocks']:
        if b['l'] in SKIP_BLOCKS or not b['t']:
            continue
        t = b['t']
        if b['l'] == 'table':
            t = re.sub(r'</t[dh]>|</tr>', ' \n ', t)
            t = re.sub(r'<[^>]+>', ' ', t)
        t = html.unescape(t)
        t = re.sub(r'\$\$?\s*\\text\{([^}]*)\}\s*\$\$?', r'\1', t).replace('$$', ' ')     # headings it wraps as formulas
        out.append({'l': b['l'], 'b': b['b'], 't': t})
    return out


def witnesses(book, page):
    """Words of the page as the line engines read them, for a third opinion: Counter of normalised words."""
    seen = Counter()
    p = os.path.join(CACHE, book, f'{page}.tsv')
    if os.path.exists(p):
        with open(p, newline='') as f:
            for r in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
                if r['level'] == '5' and (r.get('text') or '').strip() and float(r['conf']) >= 60:
                    seen.update(words(r['text']))
    for ext in ('vraw', 'vjson'):
        p = os.path.join(CACHE, book, f'{page}.{ext}')
        if os.path.exists(p):
            for l in json.load(open(p))['lines']:
                seen.update(set(words(l['t'])) | {w for a in l.get('alt', []) for w in words(a)})
    return seen


def audit_part(T, sk, part):
    """[(kind, page, app word, other word, context)] for one part, or None when its pages have not been read."""
    book = T['book']
    blocks, wit = [], Counter()
    # what is shown as a picture of the page (a map, a diagram) is not text on the screen: leave it out
    pictures = [(c['page'], c['box']) for g in part['groups'] for c in g.get('fig') or []]

    def pictured(page, b):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        return any(pg == page and x <= cx <= x + w and y <= cy <= y + h for pg, (x, y, w, h) in pictures)

    for page in part['pages']:
        bs = vl_blocks(book, page)
        if bs is None:
            return None
        blocks += [(page, b) for b in bs if not pictured(page, b['b'])]
        wit.update(witnesses(book, page))
    # a page is shared with the part before or after it: their words are on the screen too, one part along
    app = Counter()
    for other_sk in 'LR':
        for q in T[other_sk]['parts']:
            if q is part or set(q['pages']) & set(part['pages']):
                passage, questions = app_text(q, other_sk)
                app += Counter(words(passage)) + Counter(words(questions))
    for task in T['W']['tasks']:
        if set(task['pages']) & set(part['pages']):
            app += Counter(words(' '.join(task['text'])))
    skip_pages = {n for t in T['W']['tasks'] for n in t['pages']} | set(T['S'].get('pages') or [])
    seq = []                                     # (word, page) of the second reading, in reading order
    for page, b in blocks:
        if page in skip_pages and page != part['pages'][0]:
            continue                             # the writing task that follows on the last page: not this part
        seq += [(w, page) for w in words(BOILER.sub(' ', b['t']))]
    other = Counter(w for w, _ in seq)
    missing = other - app                        # on the page more often than on the screen
    extra = app - other
    passage, questions = app_text(part, sk)
    mine = words(passage) + words(questions)
    # line the two readings up, so that each word missing from the screen is seen next to what stands in its place
    sm = difflib.SequenceMatcher(a=mine, b=[w for w, _ in seq], autojunk=False)
    out, used = [], Counter()
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op not in ('insert', 'replace'):
            continue
        theirs = seq[j1:j2]
        ours = mine[i1:i2] if op == 'replace' else []
        for k, (w, page) in enumerate(theirs):
            if used[w] >= missing[w] or len(w) < 2 or not wit[w]:
                continue                         # on the screen somewhere else, or nobody else saw it
            ctx = ' '.join(x for x, _ in seq[max(0, j1 + k - 4):j1 + k + 5])
            twin = ours[k] if len(ours) == len(theirs) else None
            if twin and extra[twin] and difflib.SequenceMatcher(a=w, b=twin).ratio() >= 0.5:
                out.append(('DIFF', page, twin, w, ctx))
            elif w.isalpha() and len(w) >= 3:
                out.append(('LOST', page, '', w, ctx))
            else:
                continue
            used[w] += 1
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    tsv = sys.argv[sys.argv.index('--tsv') + 1] if '--tsv' in sys.argv else None
    if tsv in args:
        args.remove(tsv)
    rows, done, total = [], 0, 0
    for f in sorted(glob.glob(os.path.join(CBT, 'data', 't', '*.json'))):
        T = json.load(open(f))
        if args and not any(T['id'].startswith(a) for a in args):
            continue
        per = Counter()
        for sk in 'LR':
            for part in T[sk]['parts']:
                total += 1
                res = audit_part(T, sk, part)
                if res is None:
                    continue
                done += 1
                for kind, page, a, b, c in res:
                    per[kind] += 1
                    rows.append((kind, T['id'], f'{sk}{part["n"]}', page, a, b, c))
                    if args:
                        print(f'{kind}  {T["id"]} {sk}{part["n"]} p{page}  {a or "-":18} {b:18} | {c}')
        if per:
            print(f'{T["id"]}: ' + ', '.join(f'{k} {v}' for k, v in sorted(per.items())))
    print(f'\n{done} of {total} parts compared (the rest have not been read by vl.py yet); '
          + ', '.join(f'{k} {v}' for k, v in sorted(Counter(r[0] for r in rows).items())))
    if tsv:
        with open(tsv, 'w', newline='') as fh:
            w = csv.writer(fh, delimiter='\t')
            w.writerow(['kind', 'test', 'part', 'page', 'app', 'other', 'context'])
            w.writerows(rows)


if __name__ == '__main__':
    main()
