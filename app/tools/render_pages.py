"""Render every PDF page to a web JPEG (app/pages) and a grayscale OCR PNG (work dir)."""
import sys, os, fitz
from concurrent.futures import ProcessPoolExecutor

PDF = os.path.join(os.path.dirname(__file__), '..', '..',
                   'The Official Cambridge Guide to IELTS (Full Ebook+Audio)',
                   'The Official cambridge guide to IELTS.PDF')
OUT = os.path.join(os.path.dirname(__file__), '..', 'pages')
WORK = sys.argv[1]

def job(rng):
    d = fitz.open(PDF)
    for i in rng:
        p = d[i]
        web = os.path.join(OUT, f'p{i:03d}.jpg')
        if not os.path.exists(web):
            p.get_pixmap(dpi=165).save(web, jpg_quality=78)
        ocr = os.path.join(WORK, f'p{i:03d}.png')
        if not os.path.exists(ocr):
            p.get_pixmap(dpi=300, colorspace=fitz.csGRAY).save(ocr)
    return len(rng)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
    n = fitz.open(PDF).page_count
    chunks = [range(k, n, 8) for k in range(8)]
    with ProcessPoolExecutor(8) as ex:
        print(sum(ex.map(job, chunks)), 'pages')
