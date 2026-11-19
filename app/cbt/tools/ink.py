#!/usr/bin/env python3
"""What the print looks like, measured from the ink: which words are bold, where the bullets are, and the
ruled lines and frames of boxes and tables.

OCR returns characters, not typography, so headings came out plain on one page and bold on the next, and
bullets appeared on some rows only. These are facts about the page image, so they are measured, not guessed:

  weight   stroke thickness of each word against the height of its letters; bold is about 1.4x regular
  bullets  a compact mark in the margin just left of where a line's text starts
  rules    long thin horizontal / vertical runs of ink; four that meet are a frame (a notes box, a table)

    python3 tools/ink.py /path/to/ocr_png_dir [book ...]

Writes cache/<book>/<page>.ink.json:
  {"reg": regular weight on this page, "lines": [{"x","y","w","h" of the OCR line it describes,
     "wt": weight, "tok": [[first char, last char + 1, weight], ...], "bul": "dot"|"dash", "tx": x where the text starts}],
   "h": [[x0, y, x1], ...], "v": [[x, y0, y1], ...], "boxes": [[x0, y0, x1, y1], ...]}       (all 0..1)
"""
import json, os, re, sys
from multiprocessing import Pool

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
BOLD = 1.2           # a line this many times heavier than the page's regular text is bold (see bold_threshold)


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


def runs(mask):
    """Start and end (exclusive) of every run of True in a 1-D array."""
    d = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))


# ---------------------------------------------------------------- weight

ASC = set('bdfhklt') | set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
DESC = set('gjpqy')
XONLY = set('aceimnorsuvwxz')


def x_height(ink, text):
    """Height of a lower-case x in this line, in pixels, and the rows it spans (mean line, base line):
    the band of rows that holds most of the ink."""
    prof = ink.sum(1).astype(float)
    if prof.max() <= 0:
        return 0, 0, 0
    band = np.where(prof > 0.5 * prof.max())[0]
    top, base = band[0], band[-1] + 1
    h = base - top
    letters = [c for c in text if c.isalnum()]
    if letters and not any(c in XONLY or c in DESC for c in letters):
        top = base - h / 1.38      # capitals and figures only: the band is the cap height
        h /= 1.38
    return h, top, base


def half_max(gray):
    """Ink mask of a line cut at half its own contrast, so that stroke width does not depend on how dark the
    ink is: a heading printed in blue, or a faint scan, would otherwise measure thinner than black text."""
    paper = np.percentile(gray, 85)
    lo = float(gray.min())
    core = gray[gray < (paper + lo) / 2]
    dark = float(np.median(core)) if core.size else lo
    return gray < (paper + dark) / 2


def weight(ink):
    """Mean stroke thickness of the ink in a crop, in pixels (4 x the mean distance to the paper)."""
    if ink.sum() < 12:
        return 0
    return 4 * ndimage.distance_transform_edt(ink)[ink].mean() - 2


def tokens(ink, text):
    """Cut a line of ink into its words, matched to the words of the OCR text: [(char0, char1, x0, x1)].

    The text says how many words there are, so the widest gaps in the ink are the spaces between them. When
    the two do not agree (a dotted gap in the row, a misread space) the words are placed by their share of
    the characters instead - good enough to say which stretch of a line is bold.
    """
    words = [(m.start(), m.end()) for m in re.finditer(r'\S+', text)]
    cols = ink.any(0)
    if not words or not cols.any():
        return []
    x0, x1 = np.where(cols)[0][[0, -1]]
    gaps = sorted(((b - a, a, b) for a, b in runs(~cols[x0:x1 + 1])), reverse=True)
    n = len(words) - 1
    if n and len(gaps) >= n and (len(gaps) == n or gaps[n - 1][0] >= 1.6 * max(1, gaps[n][0])):
        cuts = sorted((a + x0, b + x0) for _, a, b in gaps[:n])
        edges = [x0] + [e for c in cuts for e in c] + [x1 + 1]
        return [(w[0], w[1], edges[2 * i], edges[2 * i + 1]) for i, w in enumerate(words)]
    total = len(text) or 1
    span = x1 + 1 - x0
    return [(a, b, int(x0 + span * a / total), int(x0 + span * b / total) + 1) for a, b in words]


# ---------------------------------------------------------------- bullets

def lead_mark(ink_page, x0, x1, y0, y1, xh, top, base):
    """What stands at the start of a line: (kind, x of the mark, x where the text starts).

    kind is 'dot' or 'dash' for a bullet - a compact mark at mid-height with clear space after it, whether OCR
    took it into the line or left it out in the margin - and None for a line that simply starts with text.
    """
    W = ink_page.shape[1]
    xa = max(0, int(x0 - 4.5 * xh))
    xb = min(W, x1)
    band = ink_page[y0:y1, xa:xb]
    cols = band.any(0)
    inside = max(0, x0 - xa - 2)
    first = np.where(cols[inside:])[0]
    text_x = xa + inside + (first[0] if first.size else 0)
    lab, _ = ndimage.label(band[:, :min(band.shape[1], inside + int(2.2 * xh))])
    best = None
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        area = (lab[sl] == k).sum()
        mid = (sl[0].start + sl[0].stop) / 2
        if not (top + 0.1 * xh <= mid <= base - 0.1 * xh):
            continue                        # a full stop, a comma, the dots of a gap, an apostrophe
        blob = lab[sl] == k
        if 0.28 * xh <= w <= 0.9 * xh and 0.28 * xh <= h <= 0.9 * xh and 0.7 < w / h < 1.45 and area > 0.68 * w * h \
                and ndimage.binary_fill_holes(blob).sum() == area:
            kind = 'dot'            # round and solid: a bold capital in the margin (E, C, D) is neither
        elif 0.35 * xh <= w <= 1.2 * xh and h <= 0.22 * xh and area > 0.6 * w * h:
            kind = 'dash'
        else:
            continue
        after = np.where(cols[sl[1].stop:])[0]
        if not after.size or after[0] < 0.3 * xh or after[0] > 6 * xh:
            continue                        # nothing follows it, or it touches the next letter: not a list mark
        nxt = sl[1].stop + after[0]
        if nxt < inside - 0.5 * xh:
            continue                        # something else stands between the mark and the text
        if best is None or sl[1].start > best[1] - xa:
            best = (kind, xa + sl[1].start, xa + nxt)
    return best or (None, None, text_x)


# ---------------------------------------------------------------- rules and frames

def find_rules(ink):
    """Long straight lines of ink, as (x0, y, x1) across and (x, y0, y1) down, in pixels."""
    H, W = ink.shape
    L = W // 14
    # a scan is never perfectly square: thicken by a pixel either side so a slightly sloping rule stays whole
    across = ndimage.binary_opening(ndimage.binary_dilation(ink, np.ones((3, 1), bool)), np.ones((1, L), bool))
    down = ndimage.binary_opening(ndimage.binary_dilation(ink, np.ones((1, 3), bool)), np.ones((L, 1), bool))
    hs, vs = [], []
    lab, _ = ndimage.label(across)
    for sl in ndimage.find_objects(lab):
        if sl[0].stop - sl[0].start <= 0.012 * H:           # thin: a rule, not a block of solid colour
            hs.append((sl[1].start, (sl[0].start + sl[0].stop) // 2, sl[1].stop))
    lab, _ = ndimage.label(down)
    for sl in ndimage.find_objects(lab):
        if sl[1].stop - sl[1].start <= 0.012 * W:
            vs.append(((sl[1].start + sl[1].stop) // 2, sl[0].start, sl[0].stop))
    return hs, vs


def find_boxes(hs, vs, W, H):
    """Frames: a rule across the top and bottom joined by a rule down each side."""
    tol = 0.006 * W
    boxes = []
    for x0, yt, x1 in hs:
        for xb0, yb, xb1 in hs:
            if yb - yt < 0.02 * H or abs(xb0 - x0) > 2 * tol or abs(xb1 - x1) > 2 * tol:
                continue
            left = any(abs(x - x0) < 2 * tol and y0 < yt + 2 * tol and y1 > yb - 2 * tol for x, y0, y1 in vs)
            right = any(abs(x - x1) < 2 * tol and y0 < yt + 2 * tol and y1 > yb - 2 * tol for x, y0, y1 in vs)
            if left and right:
                boxes.append((x0, yt, x1, yb))
    # of nested candidates sharing a top edge keep the outermost (the inner ones are rows of a table)
    out = []
    for b in sorted(boxes, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1])):
        if not any(o[0] - tol <= b[0] and o[1] - tol <= b[1] and o[2] + tol >= b[2] and o[3] + tol >= b[3] for o in out):
            out.append(b)
    return out


# ---------------------------------------------------------------- one page

def analyse(png, lines):
    gray = np.asarray(Image.open(png).convert('L'))
    H, W = gray.shape
    thr = min(200, max(110, otsu(gray[::4, ::4])))
    ink = gray < thr
    out = []
    for l in lines:
        x0, y0 = max(0, int(l['x'] * W) - 2), max(0, int(l['y'] * H) - 3)
        x1, y1 = min(W, int((l['x'] + l['w']) * W) + 3), min(H, int((l['y'] + l['h']) * H) + 4)
        text = l['t']
        if ink[y0:y1, x0:x1].sum() < 20:
            continue
        crop = half_max(gray[y0:y1, x0:x1])
        xh, top, base = x_height(crop, text)
        if xh < 6:
            continue
        rec = {'x': l['x'], 'y': l['y'], 'w': l['w'], 'h': l['h'], 'xh': round(xh / H, 5)}
        kind, bx, tx = lead_mark(ink, x0, x1, y0, y1, xh, top, base)
        if kind:
            rec['bul'] = kind
            rec['bx'] = round(bx / W, 5)
        rec['tx'] = round(tx / W, 5)
        # weight of each word; the text is measured without a bullet OCR took into the line
        words = text.split()
        skip = len(words[0]) + 1 if kind and len(words) > 1 and not any(c.isalnum() for c in words[0]) else 0
        from_x = max(0, tx - x0) if kind else 0
        tok_w = []
        for a, b, tx0, tx1 in tokens(crop[:, from_x:], text[skip:]):
            if not any(c.isalnum() for c in text[skip + a:skip + b]):
                continue
            wt = weight(crop[:, from_x + tx0:from_x + tx1])
            if wt > 0:
                tok_w.append([skip + a, skip + b, round(wt / xh, 4)])
        if tok_w:
            rec['tok'] = tok_w
            rec['wt'] = round(float(np.average([t[2] for t in tok_w], weights=[t[1] - t[0] for t in tok_w])), 4)
            # the lightest real word: a heading is bold throughout, a line with one bold figure in it is not
            words3 = [t[2] for t in tok_w if sum(c.isalpha() for c in text[t[0]:t[1]]) >= 3]
            rec['wmin'] = min(words3) if words3 else rec['wt']
        out.append(rec)
    hs, vs = find_rules(ink)
    boxes = find_boxes(hs, vs, W, H)
    body = [t[2] for r in out for t in r.get('tok', []) if t[1] - t[0] >= 3]
    return {
        'reg': regular(body),
        'lines': out,
        'h': [[round(a / W, 5), round(y / H, 5), round(b / W, 5)] for a, y, b in hs],
        'v': [[round(x / W, 5), round(a / H, 5), round(b / H, 5)] for x, a, b in vs],
        'boxes': [[round(a / W, 5), round(b / H, 5), round(c / W, 5), round(d / H, 5)] for a, b, c, d in boxes],
    }


def regular(weights):
    """The weight of ordinary text on a page: the most common value among its words."""
    if len(weights) < 8:
        return None
    w = np.asarray(weights)
    hist, edges = np.histogram(w, bins=np.arange(0.08, 0.5, 0.01))
    k = int(np.argmax(np.convolve(hist, [1, 2, 1], 'same')))
    near = w[(w > edges[k] - 0.02) & (w < edges[k] + 0.03)]
    return round(float(np.median(near)), 4)


def frames(h, v):
    """Frames on a page, from its rules (0..1 coordinates as stored): [[x0, y0, x1, y1], ...].

    A frame is two rules down of the same length joined by a rule across. Three sides are enough: a box of
    notes that runs over a page break has no bottom on the first page and no top on the second.
    """
    tx, ty = 0.012, 0.009
    sides = [s for s in v if s[2] - s[1] > 0.02]
    out = []
    for xl, a0, a1 in sides:
        for xr, b0, b1 in sides:
            if xr - xl < 0.15 or abs(a0 - b0) > 2 * ty or abs(a1 - b1) > 2 * ty:
                continue
            y0, y1 = min(a0, b0), max(a1, b1)
            if any(x0 <= xl + tx and x1 >= xr - tx and y0 - ty <= y <= y1 + ty for x0, y, x1 in h):
                out.append([xl, y0, xr, y1])
    keep = []
    for b in sorted(out, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1])):          # outermost first: the rest are cells
        if not any(o[0] - tx <= b[0] and o[1] - ty <= b[1] and o[2] + tx >= b[2] and o[3] + ty >= b[3] for o in keep):
            keep.append(b)
    return keep


_THR = {}


def bold_threshold(book):
    """How much heavier than regular a word must be to count as bold in this book.

    Every scan thickens strokes by its own amount (a soft scan narrows the difference between the two
    weights), so the cut is found per book: lines pile up around 1.0 (regular) and again around the book's
    bold weight, and the threshold is the bottom of the valley between the two piles.
    """
    if book not in _THR:
        vals = []
        d = os.path.join(CACHE, book)
        for f in os.listdir(d) if os.path.isdir(d) else []:
            if not f.endswith('.ink.json'):
                continue
            page = json.load(open(os.path.join(d, f)))
            if not page.get('reg'):
                continue
            vals += [l['wmin'] / page['reg'] for l in page['lines'] if l.get('wmin')]
        thr = BOLD
        if len(vals) > 400:
            hist, edges = np.histogram(vals, bins=np.arange(0.7, 2.21, 0.02))
            smooth = np.convolve(hist, [1, 2, 3, 2, 1], 'same').astype(float)
            centre = (edges[:-1] + edges[1:]) / 2
            # walk right from the regular pile: the valley is the first dip that is followed by a rise
            k = int(np.searchsorted(centre, 1.08))
            end = int(np.searchsorted(centre, 1.32))
            while k < end:
                ahead = smooth[k + 1:k + 9]
                if smooth[k] <= smooth[k + 1] and ahead.max() >= 1.2 * smooth[k]:
                    floor = [j for j in range(k, min(end, k + 8)) if smooth[j] <= 1.1 * smooth[k] + 1]
                    thr = round(float(centre[floor].mean()), 3)
                    break
                k += 1
        _THR[book] = thr
    return _THR[book]


def job(args):
    ocr, book, page = args
    out = os.path.join(CACHE, book, f'{page}.ink.json')
    png = os.path.join(ocr, book, f'{page}.png')
    src = os.path.join(CACHE, book, f'{page}.vjson')
    if not os.path.exists(png) or not os.path.exists(src):
        return
    lines = [l for l in json.load(open(src))['lines'] if l['t'].strip()]
    res = analyse(png, lines)
    json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))


def main():
    ocr = sys.argv[1]
    books = sys.argv[2:] or sorted(d for d in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, d)))
    jobs = []
    for b in books:
        for f in sorted(os.listdir(os.path.join(CACHE, b))):
            if f.endswith('.vjson'):
                jobs.append((ocr, b, f[:-6]))
    with Pool(8) as pool:
        for k, _ in enumerate(pool.imap_unordered(job, jobs, chunksize=4)):
            if k % 200 == 0:
                print(k, '/', len(jobs), flush=True)
    print('done', len(jobs))


if __name__ == '__main__':
    main()
