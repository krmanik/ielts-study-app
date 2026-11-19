"""Split each book into tests and sections by scanning a stream of OCR rows for section markers.

Produces, per book, a list of segments: (kind, test_label, n, rows) where kind is one of
L (listening part n), R (reading passage n), W (writing task n), S (speaking), LS (audioscript part n),
K (answer-key pages for a test), M (model/sample writing answer n).
"""
import glob, os, re
from lines import CACHE, page_lines, is_furniture, rows

PART = re.compile(r'^(PART|SECTION)\s*([1-4])(?!\d)(?!\s*[a-z])')
QFIRST = re.compile(r'Questions?\s*(\d{1,2})')


def book_pages(book):
    return sorted(int(os.path.basename(p)[:-6]) for p in glob.glob(os.path.join(CACHE, book, '*.vjson')))


def stream(book):
    out = []
    for p in book_pages(book):
        ls = [l for l in page_lines(book, p) if not is_furniture(l)]
        # a number alone on its row at the foot (or head) of the page is the page number
        out.extend(r for r in rows(ls) if not ((r['y'] > 0.85 or r['y'] < 0.09) and re.fullmatch(r'\d{1,3}', r['t'])))
    return out


def segment(book):
    S = stream(book)
    segs = []
    cur = None
    test = 0
    labels = []          # printed test numbers (book 12 uses 5-8)
    region = 'front'
    key_test = script_test = None
    expect_part = 1

    def start(kind, t, n, i):
        nonlocal cur
        cur = {'kind': kind, 'test': t, 'n': n, 'rows': []}
        segs.append(cur)

    for i, r in enumerate(S):
        t = r['t']
        t0 = r['lines'][0]['t']
        top = r['y'] < 0.16
        # ----- back matter headings
        if (top or len(t) < 16) and re.search(r'^(Audio\s*scripts|Transcripts)\b', t, re.I) and region in ('tests', 'keys', 'samples', 'scripts') and test >= 4:
            region = 'scripts'
        elif top and re.search(r'answer keys?\b', t, re.I) and test >= 4 and not re.search(r'speaking', t, re.I):
            region = 'keys'
        elif top and re.search(r'^(sample|model)( and sample)?( writing)? answers', t, re.I) and test >= 4:
            region = 'samples'
        elif region != 'front' and re.match(r'^(Sample answer sheets?|Acknowledgements)', t, re.I):
            region = 'end'; cur = None

        if region == 'tests' and re.fullmatch(r'(Answers?|P\d answering ideas|Sample Writing answers?)\s*:?', t, re.I):
            cur = None          # a retyped book prints the key and model answers after each section: not part of it
            continue
        if region in ('front', 'tests'):
            m = PART.match(t)
            if m:
                n = int(m.group(2))
                # must be followed closely by "Questions <first>"
                window = ' '.join(x['t'] for x in S[i:i + 3])
                q = QFIRST.search(window)
                if q and int(q.group(1)) == 10 * (n - 1) + 1:
                    if n == 1:
                        test += 1
                        region = 'tests'
                        lab = None
                        for x in S[max(0, i - 6):i + 3]:
                            mm = re.fullmatch(r'Test\s*(\d)', x['t'])
                            if mm: lab = int(mm.group(1))
                        labels.append(lab)
                    start('L', test, n, i)
                    continue
            if region == 'tests':
                m = re.match(r'READING PASSAGE\s*([1-3])(?!\d)', t0)
                if m:
                    start('R', test, int(m.group(1)), i); continue
                m = re.match(r'WRITING TASK\s*([12])(?!\d)', t0)
                if m:
                    start('W', test, int(m.group(1)), i); continue
                if ((cur and cur['kind'] == 'W' and cur['n'] == 2) or (cur is None and segs and segs[-1]['kind'] == 'W' and segs[-1]['test'] == test)) \
                        and (t == 'SPEAKING' or re.fullmatch(r'PART 1', t)):
                    start('S', test, 1, i)
                    if t == 'SPEAKING':
                        continue
        elif region == 'scripts':
            m = re.match(r'T\s*E\s*S\s*T\s*(\d)(?!\d)', t0) or (len(t) < 8 and re.fullmatch(r'Test\s*(\d)', t))
            if m:
                script_test = int(m.group(1)); continue
            m = re.match(r'(PART|SECTION)\s*([1-4])(?!\d)', t0) or (len(t) < 8 and re.fullmatch(r'(Part|Section)\s*([1-4])', t))
            if m and script_test is None and not any(x['kind'] == 'LS' for x in segs):
                script_test = 1             # no "TEST 1" heading over the first transcript
            if m and script_test is not None:
                n = int(m.group(2))
                if any(x['kind'] == 'LS' and x['test'] == script_test and x['n'] >= n for x in segs):
                    script_test += 1        # the "Test 2" heading was not read: parts starting again means the next test
                start('LS', script_test, n, i); continue
            if top and re.search(r'^(Audio\s*scripts|Transcripts)\b', t, re.I):
                continue
        elif region == 'keys':
            m = re.match(r'T\s*E\s*S\s*T\s*(\d)(?!\d)', t0)
            if m:
                start('K', int(m.group(1)), 0, i); continue
            if top and re.search(r'answer keys?', t, re.I):
                continue
        elif region == 'samples':
            m = re.search(r'TEST\s*(\d)\s*,?\s*WRITING TASK\s*([12])', t, re.I)
            if m:
                start('M', int(m.group(1)), int(m.group(2)), i); continue
            if top and re.search(r'^(sample|model)', t, re.I):
                continue
        if region == 'end':
            continue
        if cur is not None:
            cur['rows'].append(r)
    # map printed test labels (keys/scripts/samples use printed numbers) to 1..4
    lab = {l if l else k + 1: k + 1 for k, l in enumerate(labels)}
    for s in segs:
        if s['kind'] in ('LS', 'K', 'M'):
            s['test'] = lab.get(s['test'], s['test'])
    return segs, labels


if __name__ == '__main__':
    import sys
    for b in sys.argv[1:]:
        segs, labels = segment(b)
        print('== book', b, 'labels', labels)
        for s in segs:
            pages = sorted({r['page'] for r in s['rows']})
            print(f"  {s['kind']:2} T{s['test']} #{s['n']}  pages {pages[0] if pages else '-'}..{pages[-1] if pages else '-'}  rows {len(s['rows'])}  | {s['rows'][0]['t'][:60] if s['rows'] else ''}")
