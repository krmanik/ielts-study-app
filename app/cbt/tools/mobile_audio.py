#!/usr/bin/env python3
"""Smaller copies of the Listening recordings for the phone (m.html), and the size of each test's download.

The books' MP3s are 128 kbit/s: about 36 MB a test, 1.6 GB in all. Speech is just as clear as AAC at
48 kbit/s, a third of the size, so a phone can keep many tests and fetch one over a slow connection.

    python3 tools/mobile_audio.py            # -> media/m/<test>-<part>.m4a and media/m/manifest.json
    python3 tools/mobile_audio.py --sizes    # only rewrite the manifest

media/m/manifest.json:
    audio   original path (as in data/t/*.json) -> [smaller path, bytes, seconds]
    tests   test id -> bytes of everything the phone saves for it (recordings + the book pictures it needs)

Needs ffmpeg. Files that exist and are newer than their source are left alone. media/ is not in git.
"""
import concurrent.futures, glob, json, os, subprocess, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # app/cbt
OUT = os.path.join(HERE, 'media', 'm')
BITRATE = '48k'


def duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                       capture_output=True, text=True)
    try:
        return round(float(r.stdout.strip()), 1)
    except ValueError:
        return 0


def encode(job):
    src, dst = job
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return dst, None
    tmp = dst + '.part.m4a'
    # AudioToolbox's encoder (macOS) sounds better at low bitrates; fall back to ffmpeg's own
    for codec in ('aac_at', 'aac'):
        r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-c:a', codec, '-b:a', BITRATE,
                            '-movflags', '+faststart', tmp], capture_output=True, text=True)
        if r.returncode == 0:
            os.replace(tmp, dst)
            return dst, None
    if os.path.exists(tmp):
        os.remove(tmp)
    return dst, r.stderr.strip()[-300:]


def main():
    os.makedirs(OUT, exist_ok=True)
    tests = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(HERE, 'data', 't', '*.json')))]
    jobs, where = [], {}
    for T in tests:
        for p in T['L']['parts']:
            if not p.get('audio'):
                continue
            src = os.path.join(HERE, p['audio'])
            if not os.path.exists(src):
                print('missing', p['audio'])
                continue
            rel = f"media/m/{T['id']}-{p['n']}.m4a"
            where[p['audio']] = rel
            jobs.append((src, os.path.join(HERE, rel)))
    if '--sizes' not in sys.argv:
        with concurrent.futures.ThreadPoolExecutor(3) as ex:
            for i, (dst, err) in enumerate(ex.map(encode, jobs), 1):
                if err:
                    print('FAILED', dst, err)
                elif i % 20 == 0 or i == len(jobs):
                    print(f'{i}/{len(jobs)}', flush=True)

    audio, per_test = {}, {}
    for T in tests:
        total, pages = 0, set()
        for p in T['L']['parts']:
            rel = where.get(p.get('audio'))
            path = os.path.join(HERE, rel) if rel else None
            if path and os.path.exists(path):
                audio[p['audio']] = [rel, os.path.getsize(path), duration(path)]
                total += os.path.getsize(path)
            elif p.get('audio') and os.path.exists(os.path.join(HERE, p['audio'])):
                total += os.path.getsize(os.path.join(HERE, p['audio']))       # the phone falls back to the original
        for sk in 'LR':
            for p in T[sk]['parts']:
                for g in p['groups']:
                    pages.update(f['page'] for f in g.get('fig') or [])
        for t in T['W']['tasks']:
            pages.update(f['page'] for f in t.get('fig') or [])
            pages.update(t.get('samplePages') or [])
        for n in pages:
            jpg = os.path.join(HERE, 'pages', T['book'], f'{n}.jpg')
            if os.path.exists(jpg):
                total += os.path.getsize(jpg)
        per_test[T['id']] = total
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump({'audio': audio, 'tests': per_test}, f, indent=1)
    print(f"{len(audio)} recordings, {sum(a[1] for a in audio.values()) / 1e6:.0f} MB "
          f"({sum(a[2] for a in audio.values()) / 3600:.1f} hours); "
          f"a test is {min(per_test.values()) / 1e6:.0f}–{max(per_test.values()) / 1e6:.0f} MB to save")


if __name__ == '__main__':
    main()
