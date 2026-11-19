#!/usr/bin/env python3
"""The phone app as a folder of plain files, for a static host such as GitHub Pages.

The repository itself cannot be published as it is: the recordings and page pictures are not in git,
and two links in it (app/audio, app/cbt/audio) point at folders that are not there, which stops a
Pages build. This gathers exactly what the phone screen (m.html) needs into ../../site:

    index.html              sends the visitor on to cbt/m.html
    js/sync.js
    cbt/m.html …            the app: scripts, styles, icons, service worker, the text of every test
    cbt/media/m/            the smaller recordings (tools/mobile_audio.py makes them first)
    cbt/pages/<book>/       only the book pictures that questions, writing tasks and sample answers show

    python3 tools/static_site.py                 # build ../../site (about 540 MB) and check it
    python3 tools/static_site.py --serve 8800    # … and try it at http://localhost:8800/
    python3 tools/static_site.py --publish       # … and push it to the gh-pages branch of origin
    python3 tools/static_site.py --code-into DIR # only the code, text and decks, over a checkout of gh-pages
                                                 # (the publish workflow: no recordings or pictures there)

--publish replaces the gh-pages branch with one commit holding the folder (no history, so the
branch does not grow by 540 MB each time). After the first time only changed files are uploaded. Then, once, on github.com: Settings → Pages → Deploy
from a branch → gh-pages, / (root). A Pages site is open to anyone who has its address, also
when the repository is private.

Served this way there is no serve.py behind the page: m.html is marked data-host="static", the app
then never asks for /api/…, and progress is exchanged through GitHub instead (js/ghsync.js).
"""
import filecmp, functools, glob, http.server, json, os, re, shutil, subprocess, sys, time

CBT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))      # app/cbt
APP = os.path.dirname(CBT)
REPO = os.path.dirname(APP)
SITE = os.path.join(REPO, 'site')
IMPORT = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}/[^'"]+)\1''')    # as in sw.js

INDEX = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="0; url=cbt/m.html"><title>IELTS</title><a href="cbt/m.html">Open the app</a></html>
'''


def exact(path):
    """Does `path` exist with exactly this spelling? A Mac does not mind capitals; GitHub Pages does."""
    path = os.path.normpath(path)
    while path != os.path.dirname(path):
        parent, name = os.path.split(path)
        if name not in os.listdir(parent):
            return False
        path = parent
    return True


def copy(src, rel):
    dst = os.path.join(SITE, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    same = os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src)
    if same:   # small files (code, text) by content: in a fresh checkout every file looks newer than its source
        same = filecmp.cmp(src, dst, shallow=False) if os.path.getsize(src) < 5e6 else os.path.getmtime(dst) >= os.path.getmtime(src)
    if not same:
        shutil.copy2(src, dst)
    return rel


def build(code_only=False):
    """code_only: refresh scripts, styles, test text and decks in SITE and leave its media alone."""
    problems, keep = [], set()

    def add(src, rel):
        if not exact(src):
            problems.append(f'missing (or spelled with different capitals): {os.path.relpath(src, REPO)}')
            return
        keep.add(copy(src, rel))

    # the app: follow the imports from the entry script, as the service worker does
    seen, todo = set(), [os.path.join(CBT, 'js', 'm', 'main.js')]
    while todo:
        f = os.path.normpath(todo.pop())
        if f in seen:
            continue
        seen.add(f)
        if not exact(f):
            problems.append(f'imported but missing (or different capitals): {os.path.relpath(f, REPO)}')
            continue
        add(f, os.path.relpath(f, APP))
        todo += [os.path.join(os.path.dirname(f), m.group(2)) for m in IMPORT.finditer(open(f).read())]
    for rel in ['sw.js', 'manifest.webmanifest', 'css/cbt.css', 'css/m.css', 'data/index.json', 'data/learn.json',
                'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']:
        add(os.path.join(CBT, rel), 'cbt/' + rel)
    # the Anki decks the Learn page offers (writing/build.py makes them)
    for f in sorted(glob.glob(os.path.join(CBT, 'decks', '*.apkg'))):
        add(f, 'cbt/decks/' + os.path.basename(f))

    # the page, marked as served without a server and kept out of search engines
    page = open(os.path.join(CBT, 'm.html')).read()
    marked = page.replace('<html lang="en" class="m">', '<html lang="en" class="m" data-host="static">')
    marked = marked.replace('<title>', '<meta name="robots" content="noindex,nofollow">\n  <title>', 1)
    if marked.count('data-host="static"') != 1 or 'noindex' not in marked:
        problems.append('m.html: could not mark the page as static (its <html> or <title> line changed)')
    for rel, text in (('cbt/m.html', marked), ('index.html', INDEX), ('.nojekyll', '')):
        dst = os.path.join(SITE, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst) or open(dst).read() != text:
            with open(dst, 'w') as f:
                f.write(text)
        keep.add(rel)

    # the tests, with their recordings and the pictures they show
    if code_only:
        for t in sorted(glob.glob(os.path.join(CBT, 'data', 't', '*.json'))):
            add(t, 'cbt/data/t/' + os.path.basename(t))
        print(f'{len(keep)} code and text files refreshed in {SITE}')
        for p in problems:
            print('  PROBLEM:', p)
        return not problems
    try:
        sizes = json.load(open(os.path.join(CBT, 'media', 'm', 'manifest.json')))
    except OSError:
        sizes = {'audio': {}}
        problems.append('media/m/manifest.json is missing: run tools/mobile_audio.py first')
    else:
        add(os.path.join(CBT, 'media', 'm', 'manifest.json'), 'cbt/media/m/manifest.json')
    for t in sorted(glob.glob(os.path.join(CBT, 'data', 't', '*.json'))):
        add(t, 'cbt/data/t/' + os.path.basename(t))
        T = json.load(open(t))
        pages = set()
        for p in T['L']['parts']:
            small = sizes['audio'].get(p.get('audio'))
            if small:
                add(os.path.join(CBT, small[0]), 'cbt/' + small[0])
            elif p.get('audio'):
                problems.append(f"{T['id']} Listening part {p['n']}: no smaller recording (run tools/mobile_audio.py)")
            for g in p['groups']:
                pages.update(f['page'] for f in g.get('fig') or [])
        for p in T['R']['parts']:
            for g in p['groups']:
                pages.update(f['page'] for f in g.get('fig') or [])
        for task in T['W']['tasks']:
            pages.update(f['page'] for f in task.get('fig') or [])
            pages.update(task.get('samplePages') or [])
        for n in sorted(pages):
            add(os.path.join(CBT, 'pages', T['book'], f'{n}.jpg'), f"cbt/pages/{T['book']}/{n}.jpg")

    # nothing left over from an earlier build, and nothing GitHub would refuse
    total = 0
    for root, dirs, files in os.walk(SITE):
        dirs[:] = [d for d in dirs if d != '.git']
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, SITE)
            if rel not in keep:
                os.remove(full)
                continue
            if os.path.islink(full):
                problems.append(f'{rel} is a link; Pages wants real files')
            size = os.path.getsize(full)
            total += size
            if size > 95e6:
                problems.append(f'{rel} is {size / 1e6:.0f} MB; GitHub refuses files over 100 MB')
    if total > 1e9:
        problems.append(f'the folder is {total / 1e9:.2f} GB; a Pages site may be at most 1 GB')
    print(f'{len(keep)} files, {total / 1e6:.0f} MB in {os.path.relpath(SITE, os.getcwd())}')
    for p in problems:
        print('  PROBLEM:', p)
    return not problems


def git(*a, cwd=SITE, check=True):
    r = subprocess.run(['git', *a], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode:
        sys.exit(f"git {' '.join(a)} failed:\n{r.stderr.strip() or r.stdout.strip()}")
    return r.stdout.strip()


def publish():
    """Push the folder to the gh-pages branch of origin as a single commit.

    The folder keeps a git store of its own (site/.git, about as large again as the folder) holding
    what was published last, so that only new and changed files are uploaded the next time.
    """
    origin = git('remote', 'get-url', 'origin', cwd=REPO)
    m = re.search(r'github\.com[:/]([\w.-]+)/([\w.-]+?)(?:\.git)?/?$', origin)
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_NO_LAZY_FETCH': '1'}
    if not os.path.isdir(os.path.join(SITE, '.git')):
        git('init', '-q', '-b', 'gh-pages')
        git('remote', 'add', 'origin', origin)
    git('add', '-A')
    tree = git('write-tree')

    # What is on GitHub now. It can be built on only if this store holds every file of it; otherwise
    # everything is sent.
    tip = (git('ls-remote', 'origin', 'refs/heads/gh-pages').split() or [None])[0]
    known = False
    if tip:
        if git('cat-file', '-t', tip, check=False) != 'commit' and git('rev-parse', '-q', '--verify', 'refs/heads/gh-pages', check=False):
            # the publish workflow adds commits on top of the last one sent from here: fetching them is small
            subprocess.run(['git', 'fetch', '-q', 'origin', 'gh-pages'], cwd=SITE, capture_output=True, env=env)
        if git('cat-file', '-t', tip, check=False) != 'commit':       # fetch the commit itself, without its files
            subprocess.run(['git', 'fetch', '-q', '--depth=1', '--filter=tree:0', 'origin', 'gh-pages'], cwd=SITE, capture_output=True, env=env)
        r = subprocess.run(['git', 'rev-list', '--objects', '--missing=print', tip], cwd=SITE, capture_output=True, text=True, env=env)
        known = r.returncode == 0 and '?' not in r.stdout
    if known:
        git('update-ref', 'refs/remotes/origin/gh-pages', tip)
        if git('rev-parse', tip + '^{tree}') == tree:
            print('GitHub already has exactly this; nothing to publish.')
            return
    else:
        git('update-ref', '-d', 'refs/remotes/origin/gh-pages', check=False)
    commit = git('commit-tree', tree, '-m', f"Phone app, {time.strftime('%Y-%m-%d %H:%M')}")
    print('pushing to', origin, '(branch gh-pages):', 'only what changed …' if known else 'everything, about 540 MB …', flush=True)
    if subprocess.run(['git', 'push', '--force', 'origin', f'{commit}:refs/heads/gh-pages'], cwd=SITE, env=env).returncode:
        sys.exit('the push failed; nothing was published')
    git('update-ref', 'refs/remotes/origin/gh-pages', commit)
    git('update-ref', 'refs/heads/gh-pages', commit)
    if m:
        print(f'\nPublished. If Pages is not switched on yet, on github.com/{m.group(1)}/{m.group(2)}: Settings → Pages → Deploy from a branch → gh-pages, / (root).\n'
              f'Address:  https://{m.group(1).lower()}.github.io/{m.group(2)}/   (GitHub takes a minute or two to bring a new version up)')


if __name__ == '__main__':
    if '--code-into' in sys.argv:
        SITE = os.path.abspath(sys.argv[sys.argv.index('--code-into') + 1])
        if not os.path.isfile(os.path.join(SITE, 'cbt', 'm.html')):
            sys.exit(f'{SITE} is not a checkout of the published site (no cbt/m.html): publish from the Mac once first')
        sys.exit(0 if build(code_only=True) else 'problems, see above')
    ok = build()
    if not ok:
        sys.exit('Not publishable yet: see the problems above.')
    if '--publish' in sys.argv:
        publish()
    elif '--serve' in sys.argv:
        port = int(sys.argv[sys.argv.index('--serve') + 1]) if sys.argv[-1].isdigit() else 8800
        print(f'http://localhost:{port}/  (Ctrl+C to stop)')
        http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)).serve_forever()
