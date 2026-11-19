#!/usr/bin/env python3
"""Structural checks on the built test data: every question answerable, options complete, nothing left over.

    python3 tools/check.py            # all tests, one line per problem
    python3 tools/check.py 19-4       # one test
    python3 tools/check.py --summary  # counts per check only

build.py turns OCR into structure with heuristics; this is the safety net that says where they failed.
Exit status is 1 when there are problems, so it can gate a commit.
"""
import glob, json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'data', 't')
ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']
INSTR_LEFTOVER = re.compile(r'^(Complete the|Choose (the|ONE|TWO|THREE|NO)|Write (ONE|NO MORE|the correct|your answers)|Do the following statements|'
                            r'Look at the following|Which (paragraph|section) contains|Label the|Answer the questions below|In boxes \d|'
                            r'NB You may|You may use any letter|Questions? \d)')


def plain(row):
    t = row.get('t') or []
    return ''.join(x for x in t if isinstance(x, str)).strip()


def gaps(row):
    return [x['g'] for x in (row.get('t') or []) if isinstance(x, dict)]


def check_group(g, out):
    lo, hi, kind = g['from'], g['to'], g['kind']
    qs = list(range(lo, hi + 1))
    rows = g['rows']
    tag = f'Q{lo}' + (f'-{hi}' if hi > lo else '')

    def bad(code, msg):
        out.append((code, f'{tag} [{kind}{"/fig" if g.get("fig") else ""}] {msg}'))

    if not g.get('instr'):
        bad('no-instr', 'no instructions')
    elif not re.match(r'^(Complete|Choose|Write|Answer|Label|Do the|Look at|Match|Classify|Reading Passage|The |Which|What|'
                      r'Select|Identify|According|How|Why|Who|Where|When|In which|Read|TRUE|YES)', g['instr'][0]):
        bad('odd-instr', f'instructions start oddly: {g["instr"][0][:50]!r}')
    for w in g.get('warn', []):
        bad('uncertain', w)
    for r in rows:
        if r.get('fb'):
            bad('not-found', f'question {r["n"]} was not located in the text')
        if INSTR_LEFTOVER.match(plain(r)) and 'o' not in r and 'n' not in r:
            bad('instr-in-body', f'instruction text among the questions: {plain(r)[:60]!r}')
        if '……' in (r.get('t') or []):
            bad('stray-gap', f'gap without a question number: {plain(r)[:60]!r}')
    if g.get('fig'):
        return
    if g.get('table'):
        seq = [x['g'] for row in g['table']['rows'] for cell in row for para in cell['p'] for x in para['t'] if isinstance(x, dict)]
        if sorted(seq) != qs:
            bad('table-gaps', f'table has gaps {sorted(seq)} for questions {lo}-{hi}')
        widths = {sum(cell.get('cs', 1) for cell in row) for row in g['table']['rows'] if not any(cell.get('rs') for cell in row)}
        if len(widths) > 1 and not any(cell.get('rs') for row in g['table']['rows'] for cell in row):
            bad('table-shape', f'rows of the table have different numbers of cells: {sorted(widths)}')
        return
    answerable = set()
    for r in rows:
        answerable.update(gaps(r))
        if r.get('ctl') and 'n' in r:
            answerable.add(r['n'])
        if 'q' in r:
            answerable.add(r['q'])
    if kind == 'multi':
        answerable.update(qs)
    for q in qs:
        if q not in answerable:
            bad('no-control', f'question {q} has nothing to answer with')
    opts = g.get('opts') or []
    if kind == 'text':
        n = sum(len(gaps(r)) for r in rows) + sum(1 for r in rows if r.get('ctl'))
        if n != len(qs):
            bad('gap-count', f'{n} gaps for {len(qs)} questions')
        seq = [x for r in rows for x in (gaps(r) or ([r['n']] if r.get('ctl') else []))]
        if seq != sorted(seq):
            bad('gap-order', f'gaps out of order: {seq}')
    if kind == 'mcq':
        for q in qs:
            letters = [r['o'] for r in rows if r.get('q') == q]
            if letters != opts:
                bad('mcq-options', f'question {q} has options {letters or "none"}, expected {opts}')
            stem = next((plain(r) for r in rows if r.get('n') == q), '')
            if len(stem) < 8:
                bad('mcq-stem', f'question {q} has no stem')
        for r in rows:
            if 'o' in r and len(plain(r)) < 1:
                bad('empty-option', f'option {r["o"]} is empty')
    if kind == 'multi':
        letters = [r['o'] for r in rows if 'o' in r]
        if letters != opts or len(opts) < len(qs) + 2:
            bad('multi-options', f'options {letters or "none"}, expected {opts or "a list"}')
    if kind == 'roman':
        nums = [r['r'] for r in rows if 'r' in r]
        if nums != ROMANS[:len(nums)] or len(nums) < len(qs) or nums != opts:
            bad('headings', f'heading list is {nums}, options {opts}')
    if kind in ('tfng', 'ynng'):
        for q in qs:
            if len(next((plain(r) for r in rows if r.get('n') == q), '')) < 12:
                bad('statement', f'question {q} has no statement')
    if kind in ('match', 'roman'):
        first_opt = next((i for i, r in enumerate(rows) if 'o' in r or 'r' in r), None)
        if first_opt is not None:
            for r in rows[first_opt:]:
                if not any(k in r for k in ('o', 'r', 'n', 'c', 'b')) and plain(r) and not gaps(r):
                    bad('loose-row', f'text after the option list that belongs to nothing: {plain(r)[:50]!r}')
    if kind == 'match':
        letters = [r['o'] for r in rows if 'o' in r]
        about_paras = re.search(r'(paragraph|section)s?\b', ' '.join(g.get('instr', [])), re.I)
        if letters and letters != opts:
            bad('match-options', f'option box is {letters}, expected {opts}')
        if not letters and not about_paras:
            bad('match-no-box', f'no list of options ({opts[0]}-{opts[-1]})' if opts else 'no options')
        gapped = {x for r in rows for x in gaps(r)}
        for q in qs:
            if q not in gapped and len(next((plain(r) for r in rows if r.get('n') == q), '')) < 2:
                bad('match-item', f'question {q} has no text')


def check_test(T):
    out = []

    def add(where, items):
        out.extend((code, f'{T["id"]} {where}: {msg}') for code, msg in items)

    for sk in 'LR':
        for p in T[sk]['parts']:
            where = f'{sk}{p["n"]}'
            items = []
            covered = []
            for g in p['groups']:
                covered += range(g['from'], g['to'] + 1)
                check_group(g, items)
            if covered != list(range(p['from'], p['to'] + 1)):
                items.append(('coverage', f'groups cover {covered[:1]}..{covered[-1:]} ({len(covered)}), part is {p["from"]}-{p["to"]}'))
            if sk == 'L':
                if not p.get('audio'):
                    items.append(('no-audio', 'no recording'))
                if not p.get('script'):
                    items.append(('no-script', 'no transcript'))
                else:
                    marked = {q for para in p['script'] for q in para.get('q', [])}
                    missing = [q for q in range(p['from'], p['to'] + 1) if q not in marked]
                    if missing and len(missing) < 10:
                        items.append(('script-marks', f'transcript has no marker for {missing}'))
            else:
                if not p.get('title'):
                    items.append(('no-title', 'passage has no title'))
                blocks = [b for b in p['passage'] if not b.get('fn') and not b.get('sub')]
                if len(blocks) < 4:
                    items.append(('short-passage', f'only {len(blocks)} paragraphs'))
                words = sum(len(b['text'].split()) for b in blocks)
                if not 550 <= words <= 1250:
                    items.append(('passage-length', f'{words} words'))
                m = re.search(r'has \w+ (?:paragraphs|sections),?\s*(?:labelled\s*)?A\s*[-–—]\s*([B-L])', ' '.join(t for g in p['groups'] for t in g['instr']))
                if m:
                    want = [chr(c) for c in range(ord('A'), ord(m.group(1)) + 1)]
                    got = [b['label'] for b in blocks if b.get('label')]
                    if got != want:
                        items.append(('para-letters', f'paragraph letters {"".join(got) or "none"}, expected {"".join(want)}'))
                for b in blocks:
                    if re.search(r'\bQuestions? \d+\s*[-–]\s*\d+|READING PASSAGE|^\d{1,3}$', b['text']):
                        items.append(('passage-junk', f'question text inside the passage: {b["text"][:60]!r}'))
            add(where, items)
    items = []
    for t in T['W']['tasks']:
        txt = ' '.join(t['text'])
        if 'Write at least' not in txt or len(txt) < 120:
            items.append(('writing', f'task {t["n"]} prompt looks incomplete ({len(txt)} chars)'))
        if t['n'] == 1 and not t.get('fig'):
            items.append(('writing', 'task 1 has no chart'))
    parts = T['S'].get('parts') or []
    if [p['n'] for p in parts] != [1, 2, 3]:
        items.append(('speaking', f'parts {[p["n"] for p in parts]}'))
    else:
        if not any(i.get('c') for i in parts[1]['items']):
            items.append(('speaking', 'part 2 has no cue card'))
        for p in (parts[0], parts[2]):
            if sum(1 for i in p['items'] if i.get('q')) < 3:
                items.append(('speaking', f'part {p["n"]} has fewer than 3 questions'))
    add('W/S', items)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    files = sorted(glob.glob(os.path.join(DATA, '*.json')))
    if args:
        files = [f for f in files if any(os.path.basename(f).startswith(a) for a in args)]
    problems = []
    figs = tabs = 0
    for f in files:
        T = json.load(open(f))
        problems += check_test(T)
        figs += sum(1 for sk in 'LR' for p in T[sk]['parts'] for g in p['groups'] if g.get('fig'))
        tabs += sum(1 for sk in 'LR' for p in T[sk]['parts'] for g in p['groups'] if g.get('table'))
    if '--summary' not in sys.argv:
        for _, msg in problems:
            print(msg)
    counts = Counter(code for code, _ in problems)
    print(f'\n{len(files)} tests, {len(problems)} problems' + (': ' + ', '.join(f'{k} {v}' for k, v in counts.most_common()) if counts else ''))
    print(f'{figs} question groups are shown as page images (maps, diagrams, tables too irregular to rebuild); {tabs} tables are real tables')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
