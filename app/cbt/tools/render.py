#!/usr/bin/env python3
"""Render every page of the Cambridge IELTS 11-21 PDFs.

Writes display JPEGs to cbt/pages/<book>/<n>.jpg (n = 0-based pdf page index) and grayscale PNGs for
OCR to <ocr_dir>/<book>/<n>.png, plus the PDF's own text layer to <ocr_dir>/<book>/<n>.txt.

    python3 tools/render.py /path/to/ocr_dir
"""
import os, sys, glob
from multiprocessing import Pool
import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
CBT = os.path.dirname(HERE)
SRC = os.path.join(CBT, '..', '..', 'Cambridge IELTS 11-21')
OCR = sys.argv[1]
DISPLAY_W, OCR_W = 1400, 2400


def job(args):
    book, path, i = args
    out = os.path.join(CBT, 'pages', book, f'{i}.jpg')
    ocr = os.path.join(OCR, book, f'{i}.png')
    if os.path.exists(out) and os.path.exists(ocr):
        return
    d = pymupdf.open(path)
    p = d[i]
    w = p.rect.width
    p.get_pixmap(matrix=pymupdf.Matrix(DISPLAY_W / w, DISPLAY_W / w)).save(out, jpg_quality=72)
    p.get_pixmap(matrix=pymupdf.Matrix(OCR_W / w, OCR_W / w), colorspace=pymupdf.csGRAY).save(ocr)
    with open(os.path.join(OCR, book, f'{i}.txt'), 'w') as f:
        f.write(p.get_text())


if __name__ == '__main__':
    jobs = []
    for path in sorted(glob.glob(os.path.join(SRC, '*', '*.pdf'))):
        book = os.path.basename(os.path.dirname(path))
        os.makedirs(os.path.join(CBT, 'pages', book), exist_ok=True)
        os.makedirs(os.path.join(OCR, book), exist_ok=True)
        jobs += [(book, path, i) for i in range(len(pymupdf.open(path)))]
    with Pool(8) as pool:
        for k, _ in enumerate(pool.imap_unordered(job, jobs, chunksize=4)):
            if k % 100 == 0:
                print(k, '/', len(jobs), flush=True)
    print('done', len(jobs))
