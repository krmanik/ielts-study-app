#!/usr/bin/env python3
"""For every question group check.py reports, print the OCR rows the builder saw (page, x, text).

    python3 tools/probs.py [book ...]

This is the worklist for tools/fixes/<book>.json: most problems are one lost label or gap, visible here.
"""
import json, os, re, sys
import build, check
from segment import segment


def main(books):
    for f in sorted(os.listdir(check.DATA)):
        tid = f[:-5]
        book, t = tid.split('-')
        if books and book not in books:
            continue
        T = json.load(open(os.path.join(check.DATA, f)))
        segs = None
        for sk in 'LR':
            for p in T[sk]['parts']:
                for g in p['groups']:
                    items = []
                    check.check_group(g, items)
                    if not items:
                        continue
                    segs = segs or segment(book)[0]
                    seg = next(s for s in segs if s['kind'] == sk and s['test'] == int(t) and s['n'] == p['n'])
                    rows = seg['rows']
                    if sk == 'R':
                        _, _, rows = build.passage(rows, p['from'])
                    print(f"\n##### {tid} {sk}{p['n']} Q{g['from']}-{g['to']} [{g['kind']}] opts={''.join(g.get('opts') or []) if g['kind'] in ('mcq','multi','match') else ''}")
                    for _, msg in items:
                        print('   !', msg.split('] ', 1)[-1][:110])
                    for gg in build.split_groups(rows, p['from'], p['to']):
                        if gg['from'] != g['from']:
                            continue
                        for r in gg['rows']:
                            print(f"   p{r['page']} x{r['x']:.2f} | " + ' ¦ '.join(l['t'] + ('' if l['src'] == 'v' else '[' + l['src'] + ']') for l in r['lines']))


if __name__ == '__main__':
    main(sys.argv[1:])
