#!/usr/bin/env python3
"""Check public wiki links, heading anchors, fences, and distributable assets."""
from collections import Counter
from pathlib import Path
import re
import sys
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
files = [ROOT / 'README.md', ROOT / 'spec.md', *sorted((ROOT / 'docs').rglob('*.md'))]

def anchors(text):
    counts = Counter()
    result = set()
    # Ignore examples inside fences when finding real document headings.
    text = re.sub(r'^```[^\n]*\n.*?^```\s*$', '', text, flags=re.M | re.S)
    for heading in re.findall(r'^#{1,6}\s+(.+)$', text, re.M):
        heading = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', heading)
        heading = re.sub(r'<[^>]+>', '', heading)
        name = re.sub(r'[^\w -]', '', heading.lower()).replace(' ', '-')
        count = counts[name]; counts[name] += 1
        result.add(name + (f'-{count}' if count else ''))
    return result

errors = []
import xml.etree.ElementTree as ET
for image in (ROOT / 'docs/images').glob('*.svg'):
    ET.parse(image)
for file in files:
    text = file.read_text()
    if len(re.findall(r'^```', text, re.M)) % 2:
        errors.append(f'{file.relative_to(ROOT)}: unclosed code fence')
    for match in re.finditer(r'!?\[[^\]\n]+\]\(([^)]+)\)', text):
        link = match[1]
        if re.match(r'[a-z]+://', link) or link.startswith('/'): continue
        target, _, anchor = link.partition('#')
        path = (file.parent / target).resolve() if target else file
        location = f'{file.relative_to(ROOT)}:{text[:match.start()].count(chr(10)) + 1}'
        if not path.exists(): errors.append(f'{location}: missing {link}')
        elif anchor and path.suffix == '.md' and anchor not in anchors(path.read_text()):
            errors.append(f'{location}: missing anchor {link}')

example = ROOT / 'docs/examples/browser-quickstart'
for name in ['starhermit-sdk.js', 'cloud-save-store.js']:
    if (example / name).read_bytes() != (ROOT / 'docs/sdk' / name).read_bytes():
        errors.append(f'Quickstart vendored helper differs: {name}; run scripts/build-quickstart.py')
with ZipFile(ROOT / 'docs/examples/browser-quickstart.zip') as archive:
    expected = {p.name for p in example.iterdir() if p.is_file()}
    if set(archive.namelist()) != expected: errors.append('Quickstart ZIP file list differs')
    for name in expected:
        if archive.read(name) != (example / name).read_bytes(): errors.append(f'Quickstart ZIP differs: {name}')

# Catch the original split endpoint table even if a Markdown renderer tolerates it.
games = (ROOT / 'docs/api/games.md').read_text()
if not re.search(r'\| Method \| Path \| Auth \| Description \|\n\|[-|]+\|\n\| GET \|', games):
    errors.append('Games endpoint table header is not adjacent to its rows')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'{len(files)} Markdown documents: links, heading anchors, code fences and quickstart archive OK')
