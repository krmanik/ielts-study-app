"""Find blue 'play' audio badges on page images and OCR the track number beside each."""
import sys, os, json, subprocess, tempfile, re
import numpy as np, fitz
from PIL import Image
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
from blobs import components

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, '..', 'pages')
PDF = os.path.join(HERE, '..', '..', 'The Official Cambridge Guide to IELTS (Full Ebook+Audio)',
                   'The Official cambridge guide to IELTS.PDF')

def is_triangle(m, x, y, w, h):
    sub = m[y:y+h, x:x+w]
    rows = sub.sum(1)
    left = sub[:, :max(2, w//5)].any(1).mean()      # left edge present on most rows
    right = sub[:, -max(2, w//5):].any(1).mean()    # right tip present on few rows
    mid = rows[h//3: 2*h//3].mean(); ends = (rows[:h//6].mean() + rows[-h//6:].mean()) / 2
    return left > 0.75 and right < 0.45 and mid > ends * 1.5

def ocr_digits(page_idx, bbox_px, W, H):
    x, y, w, h = bbox_px
    d = fitz.open(PDF); p = d[page_idx]
    sx, sy = p.rect.width / W, p.rect.height / H
    clip = fitz.Rect((x + w) * sx, (y - h*0.35) * sy, (x + w*3.6) * sx, (y + h*1.35) * sy)
    pix = p.get_pixmap(dpi=500, clip=clip, colorspace=fitz.csGRAY)
    img = Image.frombytes('L', (pix.width, pix.height), pix.samples).point(lambda v: 0 if v < 105 else 255)
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        img.save(f.name)
        out = subprocess.run(['tesseract', f.name, '-', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789'],
                             capture_output=True, text=True).stdout
    os.unlink(f.name)
    return re.sub(r'\D', '', out)

def page(i):
    a = np.asarray(Image.open(os.path.join(PAGES, f'p{i:03d}.jpg')).convert('RGB')).astype(int)
    H, W, _ = a.shape
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = ((b - r > 90) & (b > 160) & (g < 200)) | ((b - g > 45) & (b - r > 30) & (b > 110) & (b < 200) & (r < 140))
    found = []
    for (x, y, w, h, n) in components(m):
        if not (13 <= w <= 30 and 17 <= h <= 34 and 0.35 < n / (w*h) < 0.75 and 0.6 < w/h < 1.2):
            continue
        if not is_triangle(m, x, y, w, h):
            continue
        num = ocr_digits(i, (x, y, w, h), W, H)
        found.append({'x': round(x / W, 4), 'y': round(y / H, 4), 'num': num})
    return i, found

if __name__ == '__main__':
    n = len([f for f in os.listdir(PAGES) if f.endswith('.jpg')])
    res = {}
    with ProcessPoolExecutor(10) as ex:
        for i, f in ex.map(page, range(n)):
            if f: res[i] = f
    json.dump(res, open(sys.argv[1], 'w'), indent=1)
    for i, f in sorted(res.items()):
        print(i, [(b['num'], b['y']) for b in f])
