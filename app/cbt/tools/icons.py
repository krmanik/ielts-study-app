#!/usr/bin/env python3
"""Write js/icons.js: the Lucide icons the apps use, as plain data (no network, works offline and in Anki).

Lucide (https://lucide.dev, ISC licence) is read from an installed copy of @lucide/svelte or lucide-static:

    python3 tools/icons.py ~/Documents/GitHub/Anki-xiehanzi/node_modules
    npx -y lucide-static@0.460.0 ... or: npm i lucide-static && python3 tools/icons.py node_modules

To use another icon: add its name to NAMES and run again. The output is committed, so this is only needed then.
"""
import glob, json, os, re, sys

NAMES = '''arrow-left arrow-right award book book-open bookmark calendar check chevron-down chevron-left chevron-right
chevron-up circle circle-check circle-x clock download external-link eye eye-off file-text flag graduation-cap
grip-vertical headphones house info layers library lightbulb list-checks maximize-2 menu message-circle mic minus
notebook-pen party-popper pause pen-line pencil play repeat rotate-ccw rotate-cw search settings shuffle
sliders-horizontal sparkles square-pen star target timer trash-2 trending-down trending-up triangle-alert
volume-2 x layout-grid chart-line ellipsis'''.split()

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'js', 'icons.js')


def find(root, name):
    for pat in (f'@lucide/svelte/dist/icons/{name}.svelte', f'lucide-static/icons/{name}.svg'):
        hit = glob.glob(os.path.join(root, pat))
        if hit:
            return hit[0]
    sys.exit(f'icon not found: {name}')


def svelte_nodes(src):
    return json.loads(re.search(r'const iconNode = (\[.*?\]);\n', src, re.S).group(1))


def svg_nodes(src):
    out = []
    for tag, attrs in re.findall(r'<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*)/>', src):
        out.append([tag, dict(re.findall(r'([\w-]+)="([^"]*)"', attrs))])
    return out


def main():
    root = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/Documents/GitHub/Anki-xiehanzi/node_modules')
    icons = {}
    for n in sorted(set(NAMES)):
        p = find(root, n)
        src = open(p, encoding='utf-8').read()
        nodes = svelte_nodes(src) if p.endswith('.svelte') else svg_nodes(src)
        icons[n] = ''.join('<%s %s/>' % (t, ' '.join(f'{k}="{v}"' for k, v in a.items() if k != 'key')) for t, a in nodes)
    body = ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in icons.items())
    open(OUT, 'w').write(f'''// Lucide icons (https://lucide.dev, ISC licence), written by tools/icons.py — edit NAMES there, not this file.
export const ICONS = {{
{body}
}};

/** Inline SVG for icon `name`; sized 1em by .i in the style sheet, coloured by currentColor. */
export function icon(name, cls = '') {{
  const d = ICONS[name];
  if (!d) throw new Error(`no icon "${{name}}" (add it to tools/icons.py)`);
  return `<svg class="i${{cls ? ' ' + cls : ''}}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{d}}</svg>`;
}}
''')
    print(len(icons), 'icons ->', os.path.relpath(OUT))


if __name__ == '__main__':
    main()
