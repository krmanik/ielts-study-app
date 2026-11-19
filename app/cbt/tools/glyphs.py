#!/usr/bin/env python3
"""Recover what the OCR engines skip: lone option letters, question numbers, paragraph letters and dotted gaps.

Vision and tesseract both read running text well but drop a single bold "D" or "10" standing on its own, and
often the dotted leader of an answer gap. Instead of trusting them, look at the ink: every dark blob on the
page that no OCR line accounts for, is the size of a character and sits on the same row as some text, is
cropped out and read on its own (tesseract, three page-segmentation modes, majority vote). Runs of orphan
dots become gaps.

    python3 tools/glyphs.py /path/to/ocr_png_dir [book ...]

Writes cache/<book>/<page>.glyphs.json: [{"k": "glyph"|"gap", "t": text or "�" when unreadable,
"x","y","w","h" (0..1), "n": votes}]. lines.py merges these into the page's lines.
"""
import json, os, subprocess, sys, tempfile
from collections import Counter
from multiprocessing import Pool

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
UNKNOWN = '�'
WHITELIST = 'ABCDEFGHIJKLMNOPQ0123456789ivx'


def otsu(a):
    hist = np.bincount(a.ravel(), minlength=256).astype(float)
    total = a.size
    sum_all = np.dot(np.arange(256), hist)
    best, thr, w0, sum0 = -1, 128, 0, 0
    for t in range(256):
        w0 += hist[t]
        if not w0 or w0 == total:
            continue
        sum0 += t * hist[t]
        m0, m1 = sum0 / w0, (sum_all - sum0) / (total - w0)
        var = w0 * (total - w0) * (m0 - m1) ** 2
        if var > best:
            best, thr = var, t
    return thr


def read_token(gray, box):
    x0, y0, x1, y1 = box
    pad = 6
    crop = gray.crop((max(0, x0 - pad), max(0, y0 - pad), min(gray.width, x1 + pad), min(gray.height, y1 + pad)))
    canvas = Image.new('L', (crop.width + 80, crop.height + 80), 255)
    canvas.paste(crop, (40, 40))
    scale = max(1, round(120 / max(1, y1 - y0)))
    canvas = canvas.resize((canvas.width * scale, canvas.height * scale), Image.LANCZOS)
    votes = Counter()
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'c.png')
        canvas.save(p)
        for psm in ('10', '8', '7'):
            t = subprocess.run(['tesseract', p, 'stdout', '--psm', psm, '-c', 'tessedit_char_whitelist=' + WHITELIST],
                               capture_output=True, text=True).stdout.strip().replace(' ', '')
            if 1 <= len(t) <= 4:
                votes[t] += 1
    if not votes:
        return UNKNOWN, 0
    t, n = votes.most_common(1)[0]
    return (t, n) if n >= 2 else (UNKNOWN, n)


def analyse(args):
    book, page, png_dir = args
    out_path = os.path.join(CACHE, book, f'{page}.glyphs.json')
    if os.path.exists(out_path):
        return None
    lines = []
    for ext in ('vjson', 'vraw'):
        p = os.path.join(CACHE, book, f'{page}.{ext}')
        if os.path.exists(p):
            lines += json.load(open(p))['lines']
    gray = Image.open(os.path.join(png_dir, book, f'{page}.png')).convert('L')
    A = np.asarray(gray)
    H, W = A.shape
    long_lines = [l for l in lines if len(l['t']) > 10]
    if not long_lines:
        json.dump([], open(out_path, 'w'))
        return (book, page, 0, 0)
    lh = float(np.median([l['h'] for l in long_lines])) * H       # height of a text line in pixels
    ink = A < min(175, max(105, otsu(A) + 10))
    covered = np.zeros_like(ink)
    for l in lines:
        x0, x1 = int((l['x'] - 0.002) * W), int((l['x'] + l['w'] + 0.002) * W)
        y0, y1 = int((l['y'] - 0.1 * l['h']) * H), int((l['y'] + 1.1 * l['h']) * H)
        covered[max(0, y0):y1, max(0, x0):x1] = True
    lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    if not n:
        json.dump([], open(out_path, 'w'))
        return (book, page, 0, 0)
    area = np.bincount(lab.ravel(), minlength=n + 1)
    cov = np.bincount(lab.ravel(), weights=covered.ravel(), minlength=n + 1)
    glyphs, dots, bars = [], [], []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None or cov[i] > 0.2 * area[i]:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        h, w = y1 - y0, x1 - x0
        if h <= 0.24 * lh and w <= 0.24 * lh and area[i] >= 3:
            dots.append((x0, y0, x1, y1))
        elif 0.38 * lh <= h <= 1.25 * lh and 0.04 * lh <= w <= 1.4 * lh and area[i] > 0.18 * h * w * (0.3 if w > 0.5 * h else 1):
            glyphs.append([x0, y0, x1, y1])
        elif h <= 0.14 * lh and 1.5 * lh <= w <= 12 * lh:
            bars.append((x0, y0, x1, y1))
    # the dot of an "i" belongs to the stem under it
    for d in list(dots):
        for g in glyphs:
            if d[0] >= g[0] - 3 and d[2] <= g[2] + 3 and 0 <= g[1] - d[3] <= 0.35 * lh:
                g[1] = d[1]; dots.remove(d); break
    # ---- dotted leaders (and underlines) = answer gaps
    gaps = []
    dots.sort(key=lambda d: ((d[1] + d[3]) // 2, d[0]))
    rows = []
    for d in sorted(dots, key=lambda d: d[0]):
        cy = (d[1] + d[3]) / 2
        for r in rows:
            if abs(r['cy'] - cy) < 0.15 * lh and 0 < d[0] - r['x1'] < 0.6 * lh:
                r['x1'] = d[2]; r['n'] += 1; r['y0'] = min(r['y0'], d[1]); r['y1'] = max(r['y1'], d[3]); break
        else:
            rows.append({'cy': cy, 'x0': d[0], 'x1': d[2], 'y0': d[1], 'y1': d[3], 'n': 1})
    for r in rows:
        if r['n'] >= 5:
            gaps.append((r['x0'], int(r['y1'] - 0.8 * lh), r['x1'], r['y1']))
    gaps += [(x0, int(y1 - 0.8 * lh), x1, y1) for x0, y0, x1, y1 in bars]

    def near_text(box):
        """On the same row as an OCR line or a gap, and close to it."""
        cy = (box[1] + box[3]) / 2 / H
        for l in lines:
            if l['y'] - 0.3 * l['h'] <= cy <= l['y'] + 1.3 * l['h']:
                gap = max(l['x'] * W - box[2], box[0] - (l['x'] + l['w']) * W)
                if gap < 0.1 * W:
                    return True
        for g in gaps:
            if g[1] - 0.3 * lh <= cy * H <= g[3] + 0.3 * lh and max(g[0] - box[2], box[0] - g[2]) < 0.06 * W:
                return True
        return False

    # ---- group neighbouring orphan glyphs into tokens ("10", "iii")
    glyphs.sort(key=lambda g: g[0])
    tokens = []
    for g in glyphs:
        for t in tokens:
            overlap = min(t[3], g[3]) - max(t[1], g[1])
            if overlap > 0.5 * min(t[3] - t[1], g[3] - g[1]) and 0 <= g[0] - t[2] <= 0.32 * lh:
                t[2] = g[2]; t[1] = min(t[1], g[1]); t[3] = max(t[3], g[3]); t[4] += 1; break
        else:
            tokens.append(g + [1])
    found = []
    for x0, y0, x1, y1, parts in tokens:
        if parts > 4 or not near_text((x0, y0, x1, y1)):
            continue
        t, votes = read_token(gray, (x0, y0, x1, y1))
        found.append({'k': 'glyph', 't': t, 'n': votes, 'x': x0 / W, 'y': y0 / H, 'w': (x1 - x0) / W, 'h': (y1 - y0) / H})
    for x0, y0, x1, y1 in gaps:
        if near_text((x0, y0, x1, y1)) or any(abs((f['y'] + f['h'] / 2) * H - (y0 + y1) / 2) < 0.5 * lh for f in found):
            found.append({'k': 'gap', 't': '............', 'x': x0 / W, 'y': y0 / H, 'w': (x1 - x0) / W, 'h': (y1 - y0) / H})
    json.dump(found, open(out_path, 'w'))
    return (book, page, sum(1 for f in found if f['k'] == 'glyph'), sum(1 for f in found if f['k'] == 'gap'))


def main():
    png_dir = sys.argv[1]
    books = sys.argv[2:] or sorted(d for d in os.listdir(CACHE) if d.isdigit() and os.path.isdir(os.path.join(png_dir, d)))
    jobs = []
    for book in books:
        pages = sorted(int(f[:-6]) for f in os.listdir(os.path.join(CACHE, book)) if f.endswith('.vjson'))
        jobs += [(book, p, png_dir) for p in pages]
    with Pool(8) as pool:
        for k, r in enumerate(pool.imap_unordered(analyse, jobs, chunksize=2)):
            if r and k % 50 == 0:
                print(k, '/', len(jobs), r, flush=True)
    print('done', len(jobs))


if __name__ == '__main__':
    main()
