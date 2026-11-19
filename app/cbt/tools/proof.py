#!/usr/bin/env python3
"""Spelling-level proofreading of the OCR text, by comparing the engines with each other.

    python3 tools/proof.py > review.txt        # then decide, and record decisions in fixes/<book>.spelling.json

For every word on a page used by a test that is neither a dictionary word nor used elsewhere in the books,
look at what the other readings say at the same place: Vision without language correction (.vraw), Vision's
runner-up candidates ("alt") and tesseract (.tsv). Output, one line per word:

    AUTO    two independent readings agree on a real word          -> safe to apply
    PICK    some reading offers a real word                        -> needs a look
    ODD     nobody offers a real word (a name, or a shared misreading)

Nothing is changed here: corrections live in fixes/<book>.spelling.json ({"<page>": [["tarming", "farming"]]})
and are applied by lines.py, so they can be reviewed in git like any other change.
"""
import csv, difflib, json, os, re, sys
from collections import Counter, defaultdict
from segment import segment

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
WORD = re.compile(r"[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]")
DICT = {w.strip().lower() for w in open('/usr/share/dict/words')} if os.path.exists('/usr/share/dict/words') else set()
SUFFIXES = (("'s", ''), ('s', ''), ('es', ''), ('ed', ''), ('ed', 'e'), ('ing', ''), ('ing', 'e'), ('ies', 'y'), ('ied', 'y'), ('d', ''), ('ly', ''),
            ('er', ''), ('est', ''), ('ise', 'ize'), ('ised', 'ize'), ('ises', 'ize'), ('ising', 'ize'), ('isation', 'ization'), ('isations', 'ization'),
            ('our', 'or'), ('ours', 'or'), ('ness', ''), ("n't", ''), ('re', 'er'), ('res', 'er'), ('lled', 'l'), ('lling', 'l'), ('mme', 'm'), ('mmes', 'm'))


def in_dict(w):
    l = w.lower().strip("'’-")
    if l in DICT or len(l) == 1:
        return True
    if '-' in l:
        return all(in_dict(p) for p in l.split('-') if p)
    for suf, rep in SUFFIXES:
        if l.endswith(suf) and len(l) > len(suf) + 1 and (l[:-len(suf)] + rep) in DICT:
            return True
    return False


def load(book, page):
    def lines(ext):
        p = os.path.join(CACHE, book, f'{page}.{ext}')
        return json.load(open(p))['lines'] if os.path.exists(p) else []
    words = []
    p = os.path.join(CACHE, book, f'{page}.tsv')
    if os.path.exists(p):
        W = H = 1
        with open(p, newline='') as f:
            for r in csv.DictReader(f, delimiter='\t', quoting=csv.QUOTE_NONE):
                if r['level'] == '1':
                    W, H = int(r['width']), int(r['height'])
                if r['level'] == '5' and (r.get('text') or '').strip():
                    words.append({'t': r['text'].strip(), 'x': int(r['left']) / W, 'y': int(r['top']) / H, 'w': int(r['width']) / W,
                                  'h': int(r['height']) / H, 'conf': float(r['conf'])})
    return lines('vjson'), lines('vraw'), words


def overlap(a, b):
    ix = min(a['x'] + a['w'], b['x'] + b['w']) - max(a['x'], b['x'])
    iy = min(a['y'] + a['h'], b['y'] + b['h']) - max(a['y'], b['y'])
    return ix > 0 and iy > 0.5 * min(a['h'], b['h'])


def aligned(tokens, other):
    """For each token of `tokens`, the token `other` has in its place (or None)."""
    out = [None] * len(tokens)
    sm = difflib.SequenceMatcher(a=[t.lower() for t in tokens], b=[t.lower() for t in other], autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == 'equal' or (op == 'replace' and i2 - i1 == j2 - j1):
            for k in range(i2 - i1):
                out[i1 + k] = other[j1 + k]
    return out


def main(books):
    pages = {}
    for book in books:
        segs, _ = segment(book)
        pages[book] = sorted({r['page'] for s in segs if s['kind'] in ('L', 'R', 'W', 'S', 'LS') for r in s['rows']})
    data = {(b, p): load(b, p) for b in books for p in pages[b]}
    freq = Counter()
    for (b, p), (v, _, _) in data.items():
        for l in v:
            freq.update(w.lower() for w in WORD.findall(l['t']))

    def known(w):
        return in_dict(w) or freq[w.lower()] >= 3

    for (b, p), (v, raw, words) in sorted(data.items(), key=lambda kv: (int(kv[0][0]), kv[0][1])):
        for l in v:
            toks = WORD.findall(l['t'])
            sus = [i for i, w in enumerate(toks) if not known(w) and len(w) > 1]
            if not sus:
                continue
            sources = defaultdict(list)      # token index -> [(source, reading)]
            for r in raw:
                if overlap(l, r):
                    for i, alt in enumerate(aligned(toks, WORD.findall(r['t']))):
                        if alt:
                            sources[i].append(('raw', alt))
            for k, alt_text in enumerate(l.get('alt', [])):
                for i, alt in enumerate(aligned(toks, WORD.findall(alt_text))):
                    if alt:
                        sources[i].append(('alt', alt))
            inside = sorted((w for w in words if overlap(l, w)), key=lambda w: w['x'])
            tess = [t for w in inside for t in WORD.findall(w['t'])]
            for i, alt in enumerate(aligned(toks, tess)):
                if alt:
                    sources[i].append(('tess', alt))
            for i in sus:
                w = toks[i]
                cands = Counter()
                who = defaultdict(set)
                for src, alt in sources[i]:
                    if alt.lower() != w.lower() and known(alt) and difflib.SequenceMatcher(a=w.lower(), b=alt.lower()).ratio() > 0.55:
                        cands[alt] += 1; who[alt].add(src)
                ctx = l['t']
                k = ctx.find(w)
                ctx = ctx[max(0, k - 40):k + len(w) + 30]
                if cands:
                    best, _ = cands.most_common(1)[0]
                    kind = 'AUTO' if len(who[best]) >= 2 and len(cands) == 1 else 'PICK'
                    print(f"{kind}\t{b}\t{p}\t{w}\t{'/'.join(cands)}\t{ctx}")
                elif w[0].islower() or (i and not w[1:].islower()):
                    print(f"ODD\t{b}\t{p}\t{w}\t\t{ctx}")


if __name__ == '__main__':
    main(sys.argv[1:] or sorted(d for d in os.listdir(CACHE) if d.isdigit() and d != '20'))
