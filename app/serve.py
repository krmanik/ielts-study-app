#!/usr/bin/env python3
"""Local server for the IELTS Study Suite.

Like `python3 -m http.server`, but supports HTTP Range requests so the browser can seek in the
MP3s (needed for rewind/forward and A–B looping), and follows the `audio` symlink.

It also keeps a copy of your progress on disk, in ../progress, and commits it to git so results
are never lost with the browser's storage:

    GET/PUT /api/state/<name>    one JSON document per app (study-suite, test-centre)
    GET/PUT /api/rec/<id>        speaking recordings
    GET/PUT /api/gitsync         the Test Centre progress on GitHub, shared with the phone app (see GITSYNC)

    python3 serve.py [port]            # default 8765, opens the browser
    python3 serve.py [port] --phone    # also lets a phone on the same Wi-Fi open the Test Centre (see PHONE below)
"""
import datetime, glob, hmac, html, http.server, json, os, re, secrets, socket, ssl, subprocess, sys, tempfile, time
import webbrowser, threading, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
PROGRESS = os.environ.get('IELTS_PROGRESS') or os.path.join(REPO, 'progress')     # override for tests
PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8765)
NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,40}$')
REC_EXT = {'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3'}
AUTOSAVE_IDLE = 300          # seconds without changes before unsaved progress is committed
MAX_BODY = 60 * 1024 * 1024
PHONE = '--phone' in sys.argv
STATE_LOCK = threading.Lock()   # one writer at a time for /api/state, so revisions cannot be skipped


# ---------------------------------------------------------------- PHONE: the Test Centre on a phone
#
# With --phone the server also listens on the Wi-Fi address, over HTTPS, so that a phone can open
# /m (the phone screen of the Test Centre), keep it for offline use and send its results back here.
#
#  - Anything not asked for as "localhost" needs the phone code first (a cookie, set by /cbt/pair), so
#    other people on the same Wi-Fi cannot read the tests or the progress.
#  - Browsers only let a page work offline when it came over HTTPS with a certificate they trust.
#    local-ip.sh publishes one for the names <a-b-c-d>.local-ip.sh, which resolve to a.b.c.d; it is
#    downloaded when the server starts. Its key is public, so it protects against nothing more than
#    a browser's refusal — the phone code is what keeps others out.

KEY_FILE = os.path.join(ROOT, '.phone-key')
CERT_DIR = os.path.join(ROOT, '.cert')
CERT_URL = 'https://local-ip.sh/'
LOCAL_NAMES = {'localhost', '127.0.0.1', '[::1]'}
COOKIE = 'ielts_phone'
PAIR = '/cbt/pair'      # inside the phone app's own folder, so an installed app stays in its window while asking
PUBLIC = ('/cbt/manifest.webmanifest', '/cbt/icons/')     # what a phone fetches without cookies when it adds the app


# ---------------------------------------------------------------- GITSYNC: progress shared through GitHub
#
# The phone app on GitHub Pages cannot reach this Mac, so the two meet on GitHub: one file,
# test-centre.json, on the branch progress-sync of this repository. The phone reads and writes it
# with a token (cbt/js/ghsync.js); this Mac does it here with git and the login git already has,
# so nothing needs setting up on the Mac. The browser does the merging; this only carries the file:
#
#   GET  -> { sha, doc }     the latest commit of the branch and the file in it (both null: no branch yet)
#   PUT  X-Base: <sha>       commit the body on top of <sha> and push it. If the phone pushed in
#                            between, the push is not a fast-forward: 409, and the browser reads,
#                            merges and tries again.
#
# The working tree, HEAD and the index are never touched: the commit is built with git's plumbing.

SYNC_REMOTE = os.environ.get('IELTS_SYNC_REMOTE') or 'origin'      # override for tests
# a server on throw-away progress (IELTS_PROGRESS) must not reach the real branch unless a test remote is named
SYNC_OFF = bool(os.environ.get('IELTS_PROGRESS')) and not os.environ.get('IELTS_SYNC_REMOTE')
SYNC_BRANCH, SYNC_FILE = 'progress-sync', 'test-centre.json'
SYNC_REF = 'refs/ielts/progress-sync'        # where the fetched branch is kept locally
SYNC_LOCK = threading.Lock()


class Unreachable(Exception):
    """GitHub could not be reached, or refused. `quiet`: just no connection, nothing to report."""
    def __init__(self, text, quiet=False):
        super().__init__(text)
        self.quiet = quiet


def _git(*a, data=None, index=None):
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', **({'GIT_INDEX_FILE': index} if index else {})}
    return subprocess.run(['git', '-C', REPO, *a], input=data, capture_output=True, timeout=90, env=env)


def _git_fail(r, what):
    err = r.stderr.decode('utf-8', 'replace').strip()
    quiet = any(s in err for s in ('Could not resolve host', 'Failed to connect', "Couldn't connect", 'Operation timed out', 'Network is unreachable'))
    return Unreachable(f"{what}: {err.splitlines()[-1] if err else 'git failed'}", quiet)


def sync_fetch():
    """-> (sha, file bytes) of the branch on GitHub; (None, None) when it does not exist yet."""
    r = _git('fetch', '-q', '--no-tags', SYNC_REMOTE, f'+refs/heads/{SYNC_BRANCH}:{SYNC_REF}')
    if r.returncode:
        if b"couldn't find remote ref" in r.stderr:
            return None, None
        raise _git_fail(r, 'Could not fetch the progress from GitHub')
    sha = _git('rev-parse', SYNC_REF).stdout.decode().strip()
    f = _git('show', f'{SYNC_REF}:{SYNC_FILE}')
    return sha, (f.stdout if f.returncode == 0 else None)


def sync_push(base, data, message):
    """Commit `data` as the file on top of `base` and push. -> the new sha, or None if the branch has moved on."""
    index = os.path.join(tempfile.gettempdir(), f'ielts-sync-index-{os.getpid()}')      # a scratch index, never the repository's
    try:
        if os.path.exists(index):
            os.remove(index)
        steps = []
        def run(*a, **kw):
            r = _git(*a, **kw)
            steps.append(a[0])
            if r.returncode:
                raise Unreachable(f"git {a[0]}: {r.stderr.decode('utf-8', 'replace').strip()}")
            return r.stdout.decode().strip()
        blob = run('hash-object', '-w', '--stdin', data=data)
        if base:
            run('read-tree', base, index=index)
        run('update-index', '--add', '--cacheinfo', f'100644,{blob},{SYNC_FILE}', index=index)
        tree = run('write-tree', index=index)
        commit = run('commit-tree', tree, *(['-p', base] if base else []), '-m', message)
        r = _git('push', '-q', SYNC_REMOTE, f'{commit}:refs/heads/{SYNC_BRANCH}')
        if r.returncode:
            if any(s in r.stderr for s in (b'non-fast-forward', b'fetch first', b'rejected')):
                return None
            raise _git_fail(r, 'Could not send the progress to GitHub')
        _git('update-ref', SYNC_REF, commit)
        return commit
    finally:
        if os.path.exists(index):
            os.remove(index)


def github_repo():
    """'owner/name' of the GitHub repository this folder is pushed to, or None."""
    try:
        url = subprocess.run(['git', '-C', REPO, 'remote', 'get-url', 'origin'], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r'github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$', url)
    return m.group(1) if m else None


_code = None


def phone_code():
    """The code a phone has to give once. Made on first use and kept, so the phone stays signed in."""
    global _code
    if _code:
        return _code
    _code = _read_code()
    return _code


def _read_code():
    try:
        code = open(KEY_FILE).read().strip()
        if len(code) == 8:
            return code
    except OSError:
        pass
    code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8))    # no 0/O, 1/I
    with open(KEY_FILE, 'w') as f:
        f.write(code + '\n')
    os.chmod(KEY_FILE, 0o600)
    return code


def lan_ip():
    """This Mac's address on the Wi-Fi (no packet is sent: connecting a UDP socket only picks a route)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def tls_context():
    """A TLS context with the local-ip.sh certificate, or None when it cannot be had."""
    os.makedirs(CERT_DIR, exist_ok=True)
    pem, key = os.path.join(CERT_DIR, 'server.pem'), os.path.join(CERT_DIR, 'server.key')

    def days_left():
        try:
            end = ssl.cert_time_to_seconds(ssl._ssl._test_decode_cert(pem)['notAfter'])
            return (end - time.time()) / 86400
        except Exception:
            return -1

    stale = not os.path.exists(key) or days_left() < 10 or time.time() - os.path.getmtime(pem) > 3 * 86400
    if stale:
        try:
            for name, path in (('server.pem', pem), ('server.key', key)):
                data = urllib.request.urlopen(CERT_URL + name, timeout=10).read()
                with open(path + '.tmp', 'wb') as f:
                    f.write(data)
                os.replace(path + '.tmp', path)
            os.chmod(key, 0o600)
        except Exception as e:
            print('  (could not refresh the HTTPS certificate:', e, ')')
    if days_left() <= 0:
        return None
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(pem, key)
        return ctx
    except Exception as e:
        print('  (HTTPS certificate unusable:', e, ')')
        return None


PAIR_PAGE = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IELTS — phone code</title>
<style>
 body{font:17px/1.5 -apple-system,system-ui,Arial,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;color:#16181d}
 form{background:#fff;border:1px solid #dcdfe5;border-radius:14px;padding:26px 22px;width:min(92vw,360px)}
 h1{font-size:21px;margin:0 0 6px} p{margin:0 0 16px;color:#4b5160;font-size:15px}
 input{width:100%;box-sizing:border-box;font:600 24px/1 ui-monospace,Menlo,monospace;letter-spacing:4px;text-align:center;text-transform:uppercase;padding:14px 8px;border:1.5px solid #b9bec8;border-radius:10px}
 button{width:100%;margin-top:14px;font:600 17px/1 inherit;padding:15px;border:0;border-radius:10px;background:#1f5fbf;color:#fff}
 .err{color:#c0362c;font-weight:600}
 @media (prefers-color-scheme: dark){body{background:#121418;color:#eceef2}form{background:#1b1e24;border-color:#2f343e}p{color:#b6bcc8}input{background:#121418;color:#eceef2;border-color:#474e5c}}
</style>
<form method="post" action="__PAIR__">
 <h1>IELTS Test Centre</h1>
 <p>Type the phone code shown in the window that opened on your Mac.</p>
 __ERR__
 <input name="code" maxlength="9" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" autofocus aria-label="Phone code">
 <button>Continue</button>
</form></html>"""


# ---------------------------------------------------------------- progress on disk + git history

class Saver:
    """Writes progress files and commits them to git (only the progress folder, never other work)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.timer = None
        self.pending = None    # commit message waiting for the timer; None = routine autosave
        self.last = None       # (time, message) of the last commit, for the settings page

    def write(self, rel, data, message=None):
        path = os.path.join(PROGRESS, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, path)
        if rel == 'test-centre.json':
            try:
                write_results(json.loads(data))
            except Exception as e:                      # the summary is a convenience, never block a save on it
                print('results summary failed:', e)
        self.schedule(message)

    def schedule(self, message):
        with self.lock:
            if self.timer:
                self.timer.cancel()
            self.pending = message or self.pending
            delay = 1.5 if self.pending else AUTOSAVE_IDLE      # a named save (a finished test) is committed at once
            self.timer = threading.Timer(delay, self.commit)
            self.timer.daemon = True
            self.timer.start()

    def commit(self, message=None):
        with self.lock:
            message = message or self.pending or 'Autosave progress'
            self.pending = None
            if self.timer:
                self.timer.cancel(); self.timer = None
            try:
                git = lambda *a: subprocess.run(['git', '-C', REPO, *a], capture_output=True, text=True, timeout=30)
                if git('rev-parse', '--is-inside-work-tree').stdout.strip() != 'true':
                    return
                git('add', '-A', '--', 'progress')
                if not git('status', '--porcelain', '--', 'progress').stdout.strip():
                    return
                r = git('commit', '-q', '-m', message, '--', 'progress')
                if r.returncode == 0:
                    self.last = (datetime.datetime.now().isoformat(timespec='seconds'), message)
                else:
                    print('git commit failed:', (r.stderr or r.stdout).strip())
            except (OSError, subprocess.SubprocessError) as e:
                print('git not available:', e)


SAVER = Saver()
SKILLS = {'L': 'Listening', 'R': 'Reading', 'W': 'Writing', 'S': 'Speaking'}


def write_results(state):
    """progress/RESULTS.md: one line per finished Test Centre attempt, newest first."""
    rows = []
    for a in sorted((a for a in state.get('attempts', {}).values() if a.get('finished')), key=lambda a: -a['finished']):
        book, _, test = str(a.get('test', '')).partition('-')
        res = a.get('result') or {}
        full = len(a.get('parts') or []) == {'L': 4, 'R': 3, 'W': 2, 'S': 3}.get(a.get('skill'), 0)
        score = f"{res['score']}/{res['total']}" if 'score' in res else ''
        band = res.get('band', (a.get('self') or {}).get('band'))
        when = datetime.datetime.fromtimestamp(a['finished'] / 1000).strftime('%Y-%m-%d %H:%M')
        mins = round((a.get('elapsed') or 0) / 60)
        scope = 'full' if full else 'part ' + ', '.join(str(p) for p in a.get('parts') or [])
        rows.append(f"| {when} | Cambridge {book} Test {test} | {SKILLS.get(a.get('skill'), a.get('skill'))} | {scope} | "
                    f"{a.get('mode', '')} | {score} | {band if band is not None else ''} | {mins} min |")
    head = ['# IELTS Test Centre results', '',
            'Written automatically by `app/serve.py` every time progress is saved. The full data (answers, essays,',
            'highlights, settings) is in `test-centre.json`; speaking recordings are in `recordings/`.', '',
            '| Finished | Test | Skill | Scope | Mode | Score | Band | Time |', '|---|---|---|---|---|---|---|---|']
    with open(os.path.join(PROGRESS, 'RESULTS.md'), 'w') as f:
        f.write('\n'.join(head + rows) + '\n')


class Handler(http.server.SimpleHTTPRequestHandler):
    # Python maps .m4a to audio/mp4a-latm, which browsers refuse to play
    # Connections are kept open between requests: a page is some eighty small files, and over HTTPS
    # a new connection for each would cost a handshake every time.
    protocol_version = 'HTTP/1.1'
    timeout = 30                 # an idle connection is dropped after this long
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.m4a': 'audio/mp4',
                      '.webmanifest': 'application/manifest+json'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        if self.path.split('?')[0].endswith(('.js', '.css', '.html', '/')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    # ---- /api: progress saved on disk
    def api(self, method):
        parts = urllib.parse.urlsplit(self.path).path.strip('/').split('/')
        if parts == ['api', 'phone'] and method == 'GET' and self.local():
            return self.reply(200, {'on': PHONE, 'url': PHONE_URL, 'offline': PHONE_TLS, 'code': phone_code() if PHONE else None,
                                    'repo': github_repo()})
        if parts == ['api', 'gitsync'] and self.local():
            return self.gitsync(method)
        if len(parts) != 3 or parts[1] not in ('state', 'rec') or not NAME.match(parts[2]):
            return self.reply(404, {'error': 'not found'})
        kind, name = parts[1], parts[2]
        if method == 'GET':
            if kind == 'state':
                path = os.path.join(PROGRESS, name + '.json')
                if not os.path.exists(path):
                    return self.reply(200, None)
                return self.reply_bytes(200, open(path, 'rb').read(), 'application/json')
            found = glob.glob(os.path.join(PROGRESS, 'recordings', name + '.*'))
            if not found:
                return self.reply(404, {'error': 'no such recording'})
            ctype = next((k for k, v in REC_EXT.items() if found[0].endswith('.' + v)), 'application/octet-stream')
            return self.reply_bytes(200, open(found[0], 'rb').read(), ctype)
        # writes: only from pages served by this server (a web page elsewhere must not be able to post here)
        origin = self.headers.get('Origin')
        if origin and urllib.parse.urlsplit(origin).netloc != (self.headers.get('Host') or ''):
            return self.reply(403, {'error': 'forbidden'})
        n = int(self.headers.get('Content-Length') or 0)
        if not 0 < n <= MAX_BODY:
            return self.reply(413, {'error': 'bad size'})
        body = self.rfile.read(n)
        message = urllib.parse.unquote(self.headers.get('X-Commit-Message') or '')
        message = re.sub(r'\s+', ' ', message).strip()[:140] or None
        if kind == 'state':
            try:
                doc = json.loads(body)
            except ValueError:
                return self.reply(400, {'error': 'not JSON'})
            # A document saved with X-Rev is shared between devices: a save must be based on the
            # revision on disk, or the sender gets that copy back (409) to merge and try again.
            with STATE_LOCK:
                try:
                    cur = json.load(open(os.path.join(PROGRESS, name + '.json')))
                except (OSError, ValueError):
                    cur = None
                base = self.headers.get('X-Rev')
                shared = isinstance(cur, dict) and 'rev' in cur
                if shared and str(cur['rev']) != base:
                    return self.reply(409, cur)
                if base is not None and isinstance(doc, dict):
                    doc['rev'] = (cur.get('rev', 0) if isinstance(cur, dict) else 0) + 1
                data = json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True).encode() + b'\n'
                SAVER.write(name + '.json', data, message)
            return self.reply(200, {'ok': True, 'lastCommit': SAVER.last, 'rev': doc.get('rev') if isinstance(doc, dict) else None})
        ext = REC_EXT.get((self.headers.get('Content-Type') or '').split(';')[0].strip(), 'webm')
        SAVER.write(os.path.join('recordings', f'{name}.{ext}'), body, message)
        self.reply(200, {'ok': True, 'lastCommit': SAVER.last})

    def gitsync(self, method):
        """The progress file on GitHub, for this Mac's browser only (see GITSYNC)."""
        if SYNC_OFF:
            return self.reply(503, {'error': 'GitHub sync is off: IELTS_PROGRESS is set (a test server)', 'quiet': True})
        try:
            with SYNC_LOCK:
                if method == 'GET':
                    sha, data = sync_fetch()
                    return self.reply(200, {'sha': sha, 'doc': json.loads(data) if data else None, 'repo': github_repo()})
                origin = self.headers.get('Origin')
                if origin and urllib.parse.urlsplit(origin).netloc != (self.headers.get('Host') or ''):
                    return self.reply(403, {'error': 'forbidden'})
                n = int(self.headers.get('Content-Length') or 0)
                if not 0 < n <= MAX_BODY:
                    return self.reply(413, {'error': 'bad size'})
                doc = json.loads(self.rfile.read(n))
                message = re.sub(r'\s+', ' ', urllib.parse.unquote(self.headers.get('X-Commit-Message') or '')).strip()[:140]
                data = json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True).encode() + b'\n'
                sha = sync_push(self.headers.get('X-Base') or None, data, message or 'Progress from the Mac')
                return self.reply(200, {'sha': sha}) if sha else self.reply(409, {'error': 'the branch has moved on'})
        except Unreachable as e:
            return self.reply(503, {'error': str(e), 'quiet': e.quiet})
        except (ValueError, OSError, subprocess.SubprocessError) as e:
            return self.reply(503, {'error': f'git: {e}', 'quiet': False})

    def reply(self, code, obj):
        self.reply_bytes(code, json.dumps(obj).encode(), 'application/json')

    def reply_bytes(self, code, data, ctype):
        if code >= 400:
            self.close_connection = True      # the request's body may not have been read
        self.send_response(code)
        if code >= 400:
            self.send_header('Connection', 'close')
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    # ---- who is asking: this Mac, or a phone that has given the code
    def local(self):
        host = (self.headers.get('Host') or '').rsplit(':', 1)[0]
        return host in LOCAL_NAMES and self.client_address[0] in ('127.0.0.1', '::1')

    def secure(self):
        return isinstance(self.connection, ssl.SSLSocket)

    def allowed(self):
        if self.local():
            return True
        for part in (self.headers.get('Cookie') or '').split(';'):
            k, _, v = part.strip().partition('=')
            if k == COOKIE and hmac.compare_digest(v.encode(), phone_code().encode()):
                return True
        return False

    def pair(self, method):
        """PAIR: the form that asks for the phone code, and the answer to it."""
        err = ''
        if method == 'POST':
            n = min(int(self.headers.get('Content-Length') or 0), 200)
            form = urllib.parse.parse_qs(self.rfile.read(n).decode('utf-8', 'replace'))
            code = re.sub(r'[^A-Z0-9]', '', (form.get('code') or [''])[0].upper())
            if hmac.compare_digest(code, phone_code()):
                self.send_response(303)
                self.send_header('Location', '/cbt/m.html')
                self.send_header('Set-Cookie', f'{COOKIE}={code}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly'
                                 + ('; Secure' if self.secure() else ''))
                self.send_header('Content-Length', '0')
                return self.end_headers()
            time.sleep(1.5)       # slow down guessing
            err = '<p class="err">That is not the code. Check the window on your Mac.</p>'
        self.reply_bytes(200, PAIR_PAGE.replace('__ERR__', err).replace('__PAIR__', PAIR).encode(), 'text/html; charset=utf-8')

    def gate(self, method):
        """True when the request was answered here (pairing, or refused for want of the phone code)."""
        path = urllib.parse.urlsplit(self.path).path
        if path == PAIR:
            self.pair(method)
            return True
        if path in ('/m', '/m/'):
            self.send_response(302)
            self.send_header('Location', '/cbt/m.html' if self.allowed() else PAIR)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return True
        if self.allowed() or (method == 'GET' and path.startswith(PUBLIC)):
            return False
        if method == 'GET' and 'text/html' in (self.headers.get('Accept') or '') and not path.startswith('/api/'):
            self.send_response(302)
            self.send_header('Location', PAIR)
            self.send_header('Content-Length', '0')
            self.end_headers()
        else:
            self.reply(401, {'error': 'phone code needed', 'pair': PAIR})
        return True

    def do_GET(self):
        if self.gate('GET'):
            return
        if self.path.startswith('/api/'):
            return self.api('GET')
        super().do_GET()

    def do_HEAD(self):
        if not self.allowed():
            return self.send_error(401)
        super().do_HEAD()

    def do_PUT(self):
        if self.gate('PUT'):
            return
        if self.path.startswith('/api/'):
            return self.api('PUT')
        self.send_error(405)

    def do_POST(self):
        if self.gate('POST'):
            return
        if self.path.startswith('/api/'):
            return self.api('PUT')
        self.send_error(405)

    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)', rng)
        size = os.path.getsize(path)
        if not m:
            return super().send_head()
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2) or 0))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        if start >= size:
            self.send_error(416, 'Requested Range Not Satisfiable')
            return None
        end = min(end, size - 1)
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        remaining = getattr(self, '_remaining', None)
        if remaining is None:
            return super().copyfile(source, outputfile)
        try:
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser cancelled the request (normal when seeking)
        finally:
            self._remaining = None


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128     # a page asks for many files at once; the default of 5 refuses some of them

    def handle_error(self, request, client_address):
        pass  # ignore client disconnects


PHONE_URL = None      # what to open on the phone (set at start-up with --phone)
PHONE_TLS = False     # True when that address is HTTPS, i.e. the phone can keep the app for offline use


def start_phone():
    """Listen on the Wi-Fi address as well. Returns the extra servers started."""
    global PHONE_URL, PHONE_TLS
    ip = lan_ip()
    if not ip:
        print('\n  Phone: this Mac is not on a network, so a phone cannot reach it.')
        return []
    extra = []
    ctx = tls_context()
    if ctx:
        try:
            tls = Server(('0.0.0.0', PORT + 1), Handler)
            # the handshake is left to the request's own thread, so a slow client cannot hold up the others
            tls.socket = ctx.wrap_socket(tls.socket, server_side=True, do_handshake_on_connect=False)
            extra.append(tls)
            PHONE_URL, PHONE_TLS = f"https://{ip.replace('.', '-')}.local-ip.sh:{PORT + 1}/m", True
        except OSError as e:
            print('  (HTTPS port busy:', e, ')')
    if not PHONE_TLS:
        try:
            extra.append(Server((ip, PORT), Handler))
            PHONE_URL = f'http://{ip}:{PORT}/m'
        except OSError as e:
            print('  (cannot listen on the Wi-Fi address:', e, ')')
            return []
    code = phone_code()
    print(f"""
  ┌─ On your phone (same Wi-Fi as this Mac) ───────────────────────────
  │  1. Open   {PHONE_URL}
  │  2. Code   {code[:4]} {code[4:]}
  │  3. Add it to the home screen (Share → Add to Home Screen), then
  │     open it from the new icon and follow "Get ready to travel".
  └────────────────────────────────────────────────────────────────────""")
    if not PHONE_TLS:
        print('  No HTTPS certificate could be fetched, so the phone can use the app only while it\n'
              '  can reach this Mac (no offline use). Check the internet connection and start again.')
    for s in extra:
        threading.Thread(target=s.serve_forever, daemon=True).start()
    return extra


if __name__ == '__main__':
    url = f'http://localhost:{PORT}/'
    try:
        srv = Server(('127.0.0.1', PORT), Handler)
    except OSError:
        if PHONE:
            print(f'Port {PORT} is busy — the suite is already running in another window.\n'
                  'Close that window first, then start this again so the phone can connect.')
            sys.exit(1)
        print(f'Port {PORT} is busy — the suite is probably already running. Opening {url}')
        webbrowser.open(url)
        sys.exit(0)
    print(f'IELTS Study Suite running at {url}  (Ctrl+C or close this window to stop)')
    if PHONE:
        start_phone()
    if '--no-browser' not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        SAVER.commit()      # anything still waiting for the idle timer
