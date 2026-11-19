"""Collapse tesseract TSV output into lines with normalized boxes: {page: [[text, x, y, w, h], ...]}."""
import csv, json, os, sys
from collections import OrderedDict

def load(tsv):
    lines = OrderedDict(); W = H = 1
    for r in csv.reader(open(tsv, encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE):
        if len(r) < 12 or r[0] == 'level':
            continue
        lvl, x, y, w, h = int(r[0]), *map(int, r[6:10])
        if lvl == 1:
            W, H = w, h
        if lvl != 5 or not r[11].strip():
            continue
        k = (r[2], r[3], r[4])
        L = lines.setdefault(k, [[], x, y, x + w, y + h])
        L[0].append(r[11]); L[1] = min(L[1], x); L[2] = min(L[2], y); L[3] = max(L[3], x + w); L[4] = max(L[4], y + h)
    return [[' '.join(t), round(x0 / W, 4), round(y0 / H, 4), round((x1 - x0) / W, 4), round((y1 - y0) / H, 4)]
            for t, x0, y0, x1, y1 in lines.values()]

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    res = {}
    for f in sorted(os.listdir(src)):
        if f.endswith('.tsv'):
            res[int(f[1:4])] = load(os.path.join(src, f))
    json.dump(res, open(out, 'w'))
    print(len(res), 'pages', sum(len(v) for v in res.values()), 'lines')
