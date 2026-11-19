#!/usr/bin/env python3
"""A second, layout-aware reading of the pages with PaddleOCR-VL-1.6 (a 0.9B document model that runs on
Apple Silicon through MLX, about 20 s a page on an M4).

It returns what line OCR cannot: the blocks of a page in reading order (paragraphs kept whole across their
wrapped lines) and tables as rows and cells. It is used for three things - tables shown as real tables
(tables.py), words the line OCR lost or misread (audit.py), and nothing else: it also invents text now and
then ("The image provided does not contain any text"), so it is never taken on its own word.

    ../../.venv-ocr/bin/python tools/vl.py /path/to/ocr_png_dir            # tables first, then every test page
    ../../.venv-ocr/bin/python tools/vl.py /path/to/ocr_png_dir 16 17      # only these books
    ../../.venv-ocr/bin/python tools/vl.py /path/to/ocr_png_dir --tables   # only pages with a table or flow-chart

Blocks are read one at a time. mlx-vlm can batch several (about a third faster), but batched the model was
seen to drop a row from a long table, and the server then failed outright ("broadcast_shapes") after a few
hundred pages. A page that fails is tried once more and otherwise left for the next run.
`--tables --redo` reads the table pages again.

Resumable: pages already read are skipped. Writes cache/<book>/<page>.vl.json:
  {"blocks": [{"l": label, "b": [x0, y0, x1, y1] (0..1), "t": text, or the table as HTML}]}   in reading order

Setup (once), from the repository root:
    uv venv .venv-ocr --python 3.12
    uv pip install --python .venv-ocr/bin/python paddlepaddle==3.2.1 "paddleocr[doc-parser]" "mlx-vlm>=0.3.11"
"""
import atexit, glob, json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CBT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, 'cache')
MODEL = 'PaddlePaddle/PaddleOCR-VL-1.6'
PORT = 8111
URL = f'http://127.0.0.1:{PORT}/'


def server_ready():
    try:
        with urllib.request.urlopen(URL + 'health', timeout=3) as r:
            return MODEL in r.read().decode()
    except Exception:
        return False


def start_server():
    """The model itself runs in mlx-vlm's server (GPU); start one for the length of this run if none is up."""
    if server_ready():
        return
    print('starting the model server ...', flush=True)
    log = open(os.path.join(CACHE, 'vl-server.log'), 'w')
    proc = subprocess.Popen([sys.executable, '-m', 'mlx_vlm.server', '--host', '127.0.0.1', '--port', str(PORT),
                             '--model', MODEL], stdout=log, stderr=subprocess.STDOUT)
    atexit.register(proc.terminate)
    for _ in range(600):                # the first run downloads the weights (about 2 GB)
        if server_ready():
            return
        if proc.poll() is not None:
            sys.exit('the model server stopped: see ' + log.name)
        time.sleep(2)
    sys.exit('the model server did not come up')


def wanted(books, tables_only):
    """Pages worth reading, most useful first: tables and flow-charts, questions and passages, transcripts."""
    first, second, third = [], [], []
    for f in sorted(glob.glob(os.path.join(CBT, 'data', 't', '*.json'))):
        T = json.load(open(f))
        if books and T['book'] not in books:
            continue
        for sk in 'LR':
            for p in T[sk]['parts']:
                for g in p['groups']:
                    if g.get('fig') and re.search(r'table|flow-?chart|notes|form', ' '.join(g['instr']), re.I):
                        first += [(T['book'], c['page']) for c in g['fig']]
                second += [(T['book'], n) for n in p['pages']]
                third += [(T['book'], n) for n in p.get('scriptPages') or []]
        for t in T['W']['tasks']:
            third += [(T['book'], n) for n in t['pages']]
        third += [(T['book'], n) for n in T['S'].get('pages') or []]
    order = first if tables_only else first + second + third
    seen, out = set(), []
    for ref in order:
        if ref not in seen:
            seen.add(ref); out.append(ref)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    ocr, books = args[0], set(args[1:])
    tables_only, redo = '--tables' in sys.argv, '--redo' in sys.argv
    todo = [(b, n) for b, n in wanted(books, tables_only) if redo or not os.path.exists(os.path.join(CACHE, b, f'{n}.vl.json'))]
    print(len(todo), 'pages to read', flush=True)
    if not todo:
        return
    start_server()
    from paddleocr import PaddleOCRVL
    pipe = PaddleOCRVL(pipeline_version='v1.6', vl_rec_backend='mlx-vlm-server', vl_rec_server_url=URL,
                       vl_rec_api_model_name=MODEL, vl_rec_max_concurrency=1,
                       use_doc_orientation_classify=False, use_doc_unwarping=False)
    t0, failed = time.time(), 0
    for k, (book, n) in enumerate(todo):
        png = os.path.join(ocr, book, f'{n}.png')
        if not os.path.exists(png):
            continue
        blocks = None
        for attempt in (1, 2):
            try:
                blocks = []
                for res in pipe.predict(png):
                    d = res.json['res']
                    W, H = d['width'], d['height']
                    for b in d['parsing_res_list']:
                        x0, y0, x1, y1 = b['block_bbox']
                        blocks.append({'l': b['block_label'], 'b': [round(x0 / W, 4), round(y0 / H, 4), round(x1 / W, 4), round(y1 / H, 4)],
                                       't': b.get('block_content') or ''})
                break
            except Exception as e:              # one bad page must not end a run of hours
                blocks = None
                print(f'  ! book {book} page {n}: {str(e)[:120]}' + (' - trying again' if attempt == 1 else ' - left for the next run'), flush=True)
                time.sleep(5)
                if not server_ready():
                    start_server()
        if blocks is None:
            failed += 1
            continue
        tmp = os.path.join(CACHE, book, f'{n}.vl.json.tmp')
        json.dump({'blocks': blocks}, open(tmp, 'w'), ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, tmp[:-4])
        if k % 10 == 0:
            done = k + 1
            left = (time.time() - t0) / done * (len(todo) - done)
            print(f'{done}/{len(todo)}  book {book} page {n}  about {left / 60:.0f} min left', flush=True)
    print('done', len(todo) - failed, 'of', len(todo), '' if not failed else f'({failed} failed: run again)')


if __name__ == '__main__':
    main()
