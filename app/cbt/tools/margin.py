#!/usr/bin/env python3
"""Find paragraph letters (A, B, C...) printed in the margin beside reading passages.

Both OCR engines tend to skip a lone bold letter, so we OCR a narrow strip just left of each text column
and keep single capital letters. Results are cached in cache/<book>/<page>.margin.json and merged in lines.py.

    python3 tools/margin.py /path/to/ocr_png_dir     # needs the grayscale page PNGs from render.py
"""
import json, os, subprocess, sys, tempfile
from collections import Counter
from PIL import Image
import numpy as np
from segment import segment

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')


def column_starts(lines):
    xs = Counter(round(l['x'], 2) for l in lines if len(l['t']) > 35)
    starts = []
    for x, n in xs.most_common():
        if n < 4:
            break
        if all(abs(x - s) > 0.05 for s in starts):
            starts.append(x)
    return starts


def blobs(img):
    """Dark blobs in a narrow strip: (x0, y0, x1, y1) in pixels."""
    a = np.asarray(img.convert('L')) < 165
    rows = a.any(axis=1)
    # close small vertical gaps so a faint letter is one blob
    r2 = rows.copy()
    for k in range(1, 5):
        r2[:-k] |= rows[k:] & rows[:-k]
    idx = np.where(rows)[0]
    for a0, b0 in zip(idx, idx[1:]):
        if 1 < b0 - a0 <= 5:
            r2[a0:b0] = True
    rows = r2
    out, y = [], 0
    H = len(rows)
    while y < H:
        if rows[y]:
            y0 = y
            while y < H and rows[y]:
                y += 1
            band = a[y0:y]
            cols = np.where(band.any(axis=0))[0]
            if len(cols):
                out.append((int(cols[0]), y0, int(cols[-1]) + 1, y))
        y += 1
    return out


def ocr_strip(img):
    res = []
    for x0, y0, x1, y1 in blobs(img):
        h, w = y1 - y0, x1 - x0
        if not (18 <= h <= 90 and 10 <= w <= 45) or x1 >= img.width - 2:
            continue
        crop = img.crop((x0, y0, x1, y1))
        canvas = Image.new('L', (w + 60, h + 60), 255)
        canvas.paste(crop.convert('L'), (30, 30))
        canvas = canvas.resize((canvas.width * 3, canvas.height * 3))
        votes = Counter()
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'c.png')
            canvas.save(p)
            for psm in ('10', '8', '7', '13'):
                t = subprocess.run(['tesseract', p, 'stdout', '--psm', psm, '-c', 'tessedit_char_whitelist=ABCDEFGHIJKL'],
                                   capture_output=True, text=True).stdout.strip()
                if len(t) == 1:
                    votes[t] += 1
        if votes:
            t, n = votes.most_common(1)[0]
            if n >= 2:
                res.append({'t': t, 'x': x0, 'y': y0, 'w': w, 'h': h, 'conf': 90})
    return res


def main(png_dir):
    for book in sorted(d for d in os.listdir(CACHE) if d.isdigit() and os.path.isdir(os.path.join(png_dir, d))):
        segs, _ = segment(book)
        pages = sorted({r['page'] for s in segs if s['kind'] == 'R' for r in s['rows']})
        for p in pages:
            out_path = os.path.join(CACHE, book, f'{p}.margin.json')
            if os.path.exists(out_path):
                continue
            v = json.load(open(os.path.join(CACHE, book, f'{p}.vjson')))
            img = Image.open(os.path.join(png_dir, book, f'{p}.png'))
            W, H = img.size
            found = []
            for x0 in column_starts(v['lines']):
                a, b = max(0, x0 - 0.06), x0 - 0.006
                if b <= a:
                    continue
                strip = img.crop((int(a * W), 0, int(b * W), H))
                for w in ocr_strip(strip):
                    found.append({'t': w['t'], 'x': a + w['x'] / W, 'y': w['y'] / H, 'w': w['w'] / W, 'h': w['h'] / H, 'conf': w['conf']})
            json.dump(found, open(out_path, 'w'))
            if found:
                print(book, p, ''.join(f['t'] for f in found), flush=True)


if __name__ == '__main__':
    main(sys.argv[1])
