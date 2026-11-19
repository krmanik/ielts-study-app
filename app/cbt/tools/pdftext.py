#!/usr/bin/env python3
"""Use a PDF's own text layer instead of OCR, for a book that is digital text rather than a scan.

    python3 tools/pdftext.py 20

Writes cache/<book>/<page>.vjson in the same shape as vocr (lines with normalised boxes), so the rest of the
pipeline does not care where the text came from. Book 20 here is a retyped copy, not the printed book: its
conventions are brought into line with the others on the way ("(7)……" -> "7 ……", "14." -> "14", "A." -> "A").
"""
import glob, json, os, re, sys
import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
SRC = os.path.join(HERE, '..', '..', '..', 'Cambridge IELTS 11-21')
HEADER = re.compile(r'^(CAMBRIDGE|Cambridge University Press|978-1-009)')


def normalise(t):
    t = t.replace(' ', ' ').replace('’', "'").replace('‘', "'")
    t = re.sub(r'\s+', ' ', t).strip()
    t = re.sub(r'\(\s*(\d{1,2})\s*\)\s*[.…]*', r' \1 ............ ', t)          # (7)………  ->  7 ............
    t = re.sub(r'^(\d{1,2})\.\s*(?=\S)', r'\1 ', t)                               # "14. reference" -> "14 reference"
    t = re.sub(r'^([A-L])\.(\s+|$)', r'\1 ', t)                                   # "A." -> "A"
    t = re.sub(r'^Questions?\s+(\d{1,2})\s*[-–]\s*(\d{1,2})', r'Questions \1-\2', t)
    t = re.sub(r'^\d{1,2}\s*[-–]\s*\d{1,2}\s+(?=Which)', '', t)                   # "21 – 22 Which TWO ..." (number repeated)
    t = re.sub(r'^(PART)\s*(\d)\s+(Questions)', r'\1 \2 \3', t)
    if re.fullmatch(r'\d{1,2}\s*[-–]\s*\d{1,2}', t):
        return ''                                                                     # "17 - 18" alone on a line
    return re.sub(r'\s+', ' ', t).strip()


def main(book):
    path = glob.glob(os.path.join(SRC, book, '*.pdf'))[0]
    out = os.path.join(CACHE, book)
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, '*')):
        os.remove(f)                    # OCR output for this book, if any, would only add noise
    doc = pymupdf.open(path)
    for i, page in enumerate(doc):
        W, H = page.rect.width, page.rect.height
        lines = []
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                text = normalise(''.join(s['text'] for s in line['spans']))
                if not text or HEADER.match(text) or re.fullmatch(r'Column \d|Test ?\d|Reading|Listening|Writing', text):
                    continue
                x0, y0, x1, y1 = line['bbox']
                size = max(s['size'] for s in line['spans'])
                bold = any('Bold' in s['font'] for s in line['spans'])
                lines.append({'t': text, 'x': x0 / W, 'y': y0 / H, 'w': (x1 - x0) / W, 'h': (y1 - y0) / H, 'c': 1,
                              'size': round(size, 1), 'bold': bold})
        json.dump({'w': W, 'h': H, 'lines': lines, 'source': 'pdf text layer'}, open(os.path.join(out, f'{i}.vjson'), 'w'), ensure_ascii=False)
    print(book, len(doc), 'pages')


if __name__ == '__main__':
    for b in sys.argv[1:]:
        main(b)
