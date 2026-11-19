"""The writing and speaking material, read once and shared by the Anki decks and the app (build.py).

Two sources, both plain text so they are easy to edit:

band9/*.md — one file per sub-deck, name from its '# ' line; text before the first '## ' is the
section's introduction.

    ## Card title
    Q: prompt shown on the front (optional -> makes a "say/write it" card)
    Tip: note shown on the back (optional, repeatable)

    Body paragraphs. {reusable chunk} becomes a gap. [X] = placeholder. **bold**.
    - list lines allowed

cards.txt — '# N Section' lines, then one card per line: `front | back`, ' // ' = new line on the back,
a back line starting with ✗ or ✓ is a wrong or right example.
"""
import glob, hashlib, html, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:48]


def hint(chunk):
    """First letters as hint: 'a double-edged sword' -> 'a d… s…'."""
    out = []
    for w in re.sub(r'\[[^\]]*\]', '[…]', chunk).split():
        out.append(w if len(w) <= 2 or w == '[…]' else w[0] + '…')
    return ' '.join(out)


def inline(s, mode='plain', n=None):
    """One line of source text as HTML. mode: 'plain' (chunks marked .k), 'cloze' (Anki {{cN::…}})."""
    n = n if n is not None else [0]
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)

    def chunk(m):
        c = m.group(1)
        n[0] += 1
        if mode == 'cloze':
            return '{{c%d::%s::%s}}' % (n[0], c, hint(c))
        return '<span class="k" data-h="%s">%s</span>' % (html.escape(hint(c)), c)
    s = re.sub(r'\{([^{}]+)\}', chunk, s)
    return re.sub(r'\[([^\]]+)\]', r'<span class="s">[\1]</span>', s)


def body_html(lines, mode='plain'):
    """Paragraphs and '- ' lists. -> (html, number of chunks)"""
    n, out, ul = [0], [], False
    for ln in lines:
        if ln.startswith('- '):
            if not ul:
                out.append('<ul>')
                ul = True
            out.append('<li>%s</li>' % inline(ln[2:], mode, n))
        else:
            if ul:
                out.append('</ul>')
                ul = False
            if ln.strip():
                out.append('<p>%s</p>' % inline(ln, mode, n))
    if ul:
        out.append('</ul>')
    return ''.join(out), n[0]


def skill_of(name):
    return 'S' if 'Speaking' in name else 'W'


def unique(id_, seen):
    k, i = id_, 2
    while k in seen:
        k, i = f'{id_}-{i}', i + 1
    seen.add(k)
    return k


def band9(folder=os.path.join(HERE, 'band9')):
    """-> [{id, name, title, skill, intro: [lines], items: [{id, title, q, tips: [..], body: [lines]}]}]"""
    out = []
    for path in sorted(glob.glob(os.path.join(folder, '[0-9]*.md'))):
        text = open(path, encoding='utf-8').read()
        name = re.search(r'^# (.+)$', text, re.M).group(1).strip()
        parts = re.split(r'^## ', text, flags=re.M)
        intro = [ln for ln in parts[0].split('\n') if ln.strip() and not ln.startswith('# ')]
        sec = {'id': slug(re.sub(r'^\d+\s*', '', name)), 'name': name, 'title': re.sub(r'^\d+\s*', '', name),
               'skill': skill_of(name), 'intro': intro, 'items': []}
        seen = set()
        for block in parts[1:]:
            lines = block.rstrip().split('\n')
            item = {'title': lines[0].strip(), 'q': '', 'tips': [], 'body': []}
            for ln in lines[1:]:
                if ln.startswith('Q: '):
                    item['q'] = ln[3:]
                elif ln.startswith('Tip: '):
                    item['tips'].append(ln[5:])
                else:
                    item['body'].append(ln)
            while item['body'] and not item['body'][0].strip():
                item['body'].pop(0)
            item['id'] = unique(slug(item['title']), seen)
            sec['items'].append(item)
        out.append(sec)
    return out


def phrases(path=os.path.join(HERE, 'cards.txt')):
    """-> [{id, name, title, skill, items: [{id, front, back: [lines]}]}]"""
    out, sec = [], None
    for ln in open(path, encoding='utf-8').read().strip().splitlines():
        if not ln.strip():
            continue
        if ln.startswith('# '):
            name = ln[2:].strip()
            sec = {'id': 'p-' + slug(re.sub(r'^\d+\s*', '', name)), 'name': name, 'title': re.sub(r'^\d+\s*', '', name),
                   'skill': 'W', 'items': [], '_seen': set()}
            out.append(sec)
            continue
        front, back = (x.strip() for x in ln.split(' | ', 1))
        sec['items'].append({'id': unique(slug(front), sec['_seen']), 'front': front, 'back': back.split(' // ')})
    for s in out:
        del s['_seen']
    return out


def back_html(lines, mark):
    """A phrase card's back. mark('ok'|'no') -> HTML of the tick or cross in front of an example."""
    out = []
    for ln in lines:
        m = re.match(r'^([✗✓])\s*(.*)$', ln)
        if m:
            kind = 'ok' if m.group(1) == '✓' else 'no'
            out.append('<div class="l-ex %s">%s<span>%s</span></div>' % (kind, mark(kind), inline(m.group(2))))
        else:
            out.append('<div>%s</div>' % inline(ln))
    return ''.join(out)


def digest(*paths):
    h = hashlib.sha1()
    for p in paths:
        h.update(open(p, 'rb').read())
    return h.hexdigest()[:10]
