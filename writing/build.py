#!/usr/bin/env python3
"""Build the writing/speaking material from band9/*.md and cards.txt (see content.py for the format):

    app/cbt/decks/IELTS_Band9.apkg     Band 9 deck: model answers as "say it" + cloze cards
    app/cbt/decks/IELTS_Writing.apkg   phrase deck: one card per rule/phrase
    app/cbt/data/learn.json            the same material for the app's Learn pages

    python3 build.py              # needs genanki (pip install genanki); without it only learn.json is written
    python3 build.py --json       # only learn.json

Note, model and deck IDs never change, so re-importing a rebuilt deck updates the cards and keeps their
review history. Icons are Lucide (ISC), read from app/cbt/js/icons.js, inlined so cards work offline.
"""
import json, os, re, sys

import content as C

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
CBT = os.path.join(REPO, 'app', 'cbt')
DECKS = os.path.join(CBT, 'decks')
LEARN = os.path.join(CBT, 'data', 'learn.json')

ICONS = {k: json.loads(v) for k, v in re.findall(
    r'^\s*"([\w-]+)": ("(?:[^"\\]|\\.)*"),?$', open(os.path.join(CBT, 'js', 'icons.js'), encoding='utf-8').read(), re.M)}


def svg(name, cls='i'):
    return ('<svg class="%s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>') % (cls, ICONS[name])


SKILL_ICON = {'W': 'pen-line', 'S': 'mic'}

# ----------------------------------------------------------------------------------------------- Anki
CSS = """
.card { --bg:#f7f7f8; --surface:#fff; --ink:#18181b; --ink-2:#52525b; --muted:#71717a; --line:#e4e4e7;
  --accent:#2563eb; --accent-soft:#eff4ff; --chunk:#fef3c7; --ok:#15803d; --no:#b91c1c; --ph:#b45309;
  font: 18px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--bg);
  text-align: left; margin: 0; padding: 20px 16px 40px; -webkit-font-smoothing: antialiased; }
.nightMode.card, .night_mode .card, .card.nightMode { --bg:#18181b; --surface:#232327; --ink:#f4f4f5; --ink-2:#d4d4d8;
  --muted:#a1a1aa; --line:#3f3f46; --accent:#7aa7ff; --accent-soft:#1e2a44; --chunk:#4a3b0f; --ok:#4ade80; --no:#f87171; --ph:#fbbf24; }
.wrap { max-width: 680px; margin: 0 auto; }
.i { width: 1.1em; height: 1.1em; vertical-align: -.18em; flex: none; }
.head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; letter-spacing: .02em;
  color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 3px 10px 3px 8px; }
.t { font-size: 14px; color: var(--muted); font-weight: 500; }
.q { font-size: 21px; line-height: 1.4; font-weight: 650; margin: 4px 0 14px; letter-spacing: -.01em; }
.how { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
hr#answer { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
.a { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 6px 18px; line-height: 1.7; }
.a p { margin: .7em 0; } .a ul { margin: .6em 0; padding-left: 1.2em; } .a li { margin: .25em 0; }
.k { background: var(--chunk); border-radius: 4px; padding: 0 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.s { color: var(--ph); font-weight: 500; }
.cloze { font-weight: 700; color: var(--accent); background: var(--accent-soft); border-radius: 4px; padding: 0 4px; }
.tip { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 12px 14px; border-radius: 12px;
  background: var(--surface); border: 1px dashed var(--line); color: var(--ink-2); font-size: 15px; }
.tip .i { color: #ca8a04; margin-top: 3px; }
.front { font-size: 22px; font-weight: 650; line-height: 1.4; margin: 6px 0 4px; }
.l-ex { display: flex; gap: 8px; align-items: flex-start; margin: .35em 0; }
.l-ex .i { margin-top: .32em; } .l-ex.ok .i { color: var(--ok); } .l-ex.no .i { color: var(--no); } .l-ex.no span { color: var(--ink-2); }
.back > div { margin: .45em 0; }
"""

FRONT_HEAD = '<div class="head"><span class="chip">{{Sec}}</span><span class="t">{{Title}}</span></div>'


def anki():
    import genanki
    answer = genanki.Model(
        1739201101, 'IELTS Band9 Answer',
        fields=[{'name': 'Title'}, {'name': 'Prompt'}, {'name': 'Answer'}, {'name': 'Tip'}, {'name': 'Sec'}],
        templates=[{'name': 'Say it',
                    'qfmt': '<div class="wrap">' + FRONT_HEAD + '<div class="q">{{Prompt}}</div>'
                            '<div class="how">' + svg('mic') + 'Answer out loud, or plan in 1 minute — then flip.</div></div>',
                    'afmt': '<div class="wrap">' + FRONT_HEAD + '<div class="q">{{Prompt}}</div><hr id="answer">'
                            '<div class="a">{{Answer}}</div>{{#Tip}}<div class="tip">' + svg('lightbulb') + '<div>{{Tip}}</div></div>{{/Tip}}</div>'}],
        css=CSS)
    cloze = genanki.Model(
        1739201102, 'IELTS Band9 Cloze', model_type=genanki.Model.CLOZE,
        fields=[{'name': 'Text'}, {'name': 'Tip'}, {'name': 'Sec'}, {'name': 'Title'}],
        templates=[{'name': 'Cloze',
                    'qfmt': '<div class="wrap">' + FRONT_HEAD + '<div class="a">{{cloze:Text}}</div></div>',
                    'afmt': '<div class="wrap">' + FRONT_HEAD + '<div class="a">{{cloze:Text}}</div>'
                            '{{#Tip}}<div class="tip">' + svg('lightbulb') + '<div>{{Tip}}</div></div>{{/Tip}}</div>'}],
        css=CSS)
    phrase = genanki.Model(
        1607392319, 'IELTS Writing Card', fields=[{'name': 'Front'}, {'name': 'Back'}, {'name': 'Sec'}],
        templates=[{'name': 'Card',
                    'qfmt': '<div class="wrap"><div class="head"><span class="chip">{{Sec}}</span></div><div class="front">{{Front}}</div></div>',
                    'afmt': '<div class="wrap"><div class="head"><span class="chip">{{Sec}}</span></div><div class="front">{{Front}}</div>'
                            '<hr id="answer"><div class="a back">{{Back}}</div></div>'}],
        css=CSS)

    os.makedirs(DECKS, exist_ok=True)
    # Band 9
    decks, total = [], 0
    for i, sec in enumerate(C.band9()):
        deck = genanki.Deck(1739201200 + i, 'IELTS Band 9::' + sec['name'])
        chip = svg(SKILL_ICON[sec['skill']]) + C.html.escape(sec['title'])
        for it in sec['items']:
            tip = '<br>'.join(C.inline(t) for t in it['tips'])
            t = C.html.escape(it['title'], quote=False)
            q = C.inline(it['q']) if it['q'] else ''
            if q:
                deck.add_note(genanki.Note(model=answer, guid=genanki.guid_for('a', sec['name'], it['title']),
                                           fields=[t, q, C.body_html(it['body'])[0], tip, chip]))
            cz, k = C.body_html(it['body'], 'cloze')
            if k:
                front = ('<p class="q">%s</p>' % q if q else '') + cz
                deck.add_note(genanki.Note(model=cloze, guid=genanki.guid_for('c', sec['name'], it['title']),
                                           fields=[front, tip, chip, t]))
            total += (1 if q else 0) + k
        decks.append(deck)
    out = os.path.join(DECKS, 'IELTS_Band9.apkg')
    genanki.Package(decks).write_to_file(out)
    band9 = {'file': 'decks/IELTS_Band9.apkg', 'title': 'IELTS Band 9', 'notes': sum(len(d.notes) for d in decks), 'cards': total}
    print('Band 9:', band9['notes'], 'notes,', total, 'cards ->', os.path.relpath(out, REPO))

    # phrases
    decks = []
    mark = lambda kind: svg('check' if kind == 'ok' else 'x')
    for i, sec in enumerate(C.phrases()):
        d = genanki.Deck(2059400110 + i, 'IELTS Writing::' + sec['name'])
        for it in sec['items']:
            d.add_note(genanki.Note(model=phrase, guid=genanki.guid_for(it['front']),
                                    fields=[C.inline(it['front']), C.back_html(it['back'], mark), svg('pen-line') + C.html.escape(sec['title'])]))
        decks.append(d)
    out = os.path.join(DECKS, 'IELTS_Writing.apkg')
    genanki.Package(decks).write_to_file(out)
    n = sum(len(d.notes) for d in decks)
    print('Writing phrases:', n, 'cards ->', os.path.relpath(out, REPO))
    return [band9, {'file': 'decks/IELTS_Writing.apkg', 'title': 'IELTS Writing phrases', 'notes': n, 'cards': n}]


# ----------------------------------------------------------------------------------------------- app
def learn(decks):
    mark = lambda kind: '<i data-icon="%s"></i>' % ('check' if kind == 'ok' else 'x')
    models = []
    for sec in C.band9():
        items = []
        for it in sec['items']:
            body, k = C.body_html(it['body'])
            items.append({'id': it['id'], 'title': it['title'], 'q': C.inline(it['q']) if it['q'] else '',
                          'tip': '<br>'.join(C.inline(t) for t in it['tips']), 'html': body, 'chunks': k})
        models.append({'id': sec['id'], 'title': sec['title'], 'skill': sec['skill'], 'kind': 'model',
                       'intro': C.body_html(sec['intro'])[0], 'items': items})
    cards = []
    for sec in C.phrases():
        cards.append({'id': sec['id'], 'title': sec['title'], 'skill': sec['skill'], 'kind': 'cards',
                      'items': [{'id': it['id'], 'front': C.inline(it['front']), 'back': C.back_html(it['back'], mark)}
                                for it in sec['items']]})
    doc = {'version': C.digest(*sorted(__import__('glob').glob(os.path.join(HERE, 'band9', '*.md'))), os.path.join(HERE, 'cards.txt')),
           'decks': decks,
           'groups': [{'id': 'models', 'title': 'Band 9 model answers', 'sections': models},
                      {'id': 'phrases', 'title': 'Writing rules & phrases', 'sections': cards}]}
    with open(LEARN, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print('learn.json:', sum(len(s['items']) for g in doc['groups'] for s in g['sections']), 'items,',
          round(os.path.getsize(LEARN) / 1024), 'KB ->', os.path.relpath(LEARN, REPO))


def main():
    decks = []
    if '--json' not in sys.argv:
        try:
            decks = anki()
        except ImportError:
            print('genanki not installed: skipping the .apkg files (pip install genanki)')
    if not decks and os.path.exists(LEARN):      # keep the deck list an earlier full build wrote
        decks = json.load(open(LEARN, encoding='utf-8')).get('decks', [])
    learn(decks)


if __name__ == '__main__':
    main()
