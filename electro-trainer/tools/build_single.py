#!/usr/bin/env python3
"""Собирает приложение в один HTML-файл (всё встроено, работает без сервера).

    python3 tools/build_single.py              -> dist/montazhnyj-stend.html
    python3 tools/build_single.py --fragment OUT  -> фрагмент без <html>/<head> (для встраивания)
"""
import base64
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = ['components.js', 'sim.js', 'labs.js', 'content.js', 'check.js', 'app.js']


def read(*p):
    with open(os.path.join(ROOT, *p), encoding='utf-8') as f:
        return f.read()


def build(fragment):
    html = read('index.html')
    css = read('css', 'app.css')
    js = '\n'.join(read('js', f) for f in JS)
    body = re.search(r'<!--APP-->(.*)<!--/APP-->', html, re.S).group(1)
    icon = 'data:image/svg+xml;base64,' + base64.b64encode(read('icons', 'icon.svg').encode()).decode()
    fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)
    head = (
        '<title>Монтажный стенд</title>\n'
        f'<link rel="icon" href="{icon}">\n'
        f'<link rel="stylesheet" href="{fonts}">\n'
        f'<style>\n{css}\n</style>\n'
    )
    script = f'<script>document.documentElement.dataset.noSw = "1";\n{js}\n</script>\n'
    if fragment:
        return head + body + script
    return (
        '<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#1d2733">\n'
        + head + '</head>\n<body>\n' + body + script + '</body>\n</html>\n'
    )


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--fragment':
        out, frag = sys.argv[2], True
    else:
        out, frag = os.path.join(ROOT, 'dist', 'montazhnyj-stend.html'), False
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(build(frag))
    print(out, os.path.getsize(out), 'bytes')
