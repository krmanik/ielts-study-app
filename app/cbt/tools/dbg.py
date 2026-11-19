#!/usr/bin/env python3
"""Show what the builder sees for one part: the OCR rows of each question group, then the structure built from them.

    python3 tools/dbg.py 19-4 L2          # test, L<part> or R<passage>
"""
import json, re, sys
import build
from segment import segment


def main(tid, where):
    book, t = tid.split('-')
    sk, p = where[0], int(where[1])
    segs, _ = segment(book)
    seg = next(s for s in segs if s['kind'] == sk and s['test'] == int(t) and s['n'] == p)
    keys = build.parse_keys(book)[int(t)][sk]
    rows = seg['rows']
    lo, hi = (10 * (p - 1) + 1, 10 * p) if sk == 'L' else {1: (1, 13), 2: (14, 26), 3: (27, 40)}[p]
    if sk == 'R':
        for r in rows[:4]:
            m = re.search(r'Questions\s*(\d+)\s*[-–]\s*(\d+)', r['t'])
            if m:
                lo, hi = int(m.group(1)), int(m.group(2)); break
        _, _, rows = build.passage(rows, lo)
    for g in build.split_groups(rows, lo, hi):
        print(f"\n=== Questions {g['from']}-{g['to']}")
        for r in g['rows']:
            print(f"   p{r['page']} x{r['x']:.3f} y{r['y']:.3f} | " + ' ¦ '.join(f"{l['t']}" + (f"[{l['src']}]" if l['src'] != 'v' else '') for l in r['lines']))
        out = build.build_group(g, keys)
        print('  ->', out['kind'], out.get('opts'), 'fig' if out.get('fig') else '')
        for r in out['rows']:
            print('     ', json.dumps(r, ensure_ascii=False))


if __name__ == '__main__':
    main(*sys.argv[1:3])
