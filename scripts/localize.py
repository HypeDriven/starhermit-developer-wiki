#!/usr/bin/env python3
"""Generate static wiki translations. Default: offline render from the committed cache.

Use --translate to send changed public prose to Google Translate; code and API literals are
excluded. Interrupted runs save their progress. No translation service runs in the browser.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'scripts/localization-cache.json'
LOCK = threading.Lock()

def key(text):
    return sha256(text.encode()).hexdigest()

def save(cache):
    temporary = CACHE.with_suffix('.tmp')
    temporary.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(CACHE)

def translate(language, texts):
    url = 'https://translate.googleapis.com/translate_a/t?' + urlencode({'client': 'gtx', 'sl': 'en', 'tl': language})
    body = urlencode([('q', text) for text in texts]).encode()
    for attempt in range(6):
        try:
            request = Request(url, data=body, headers={'User-Agent': 'StarHermit-Wiki-Localization/1.0'})
            with urlopen(request, timeout=45) as response:
                values = json.load(response)
            if not isinstance(values, list) or len(values) != len(texts) or any(
                not isinstance(v, str) or (not v.strip() and text.lower() not in {'the', 'a', 'an'})
                for text, v in zip(texts, values)
            ):
                raise ValueError(f'Unexpected translation response for {language}')
            return values
        except Exception:
            if attempt == 5: raise
            time.sleep(min(2 ** attempt, 30))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--translate', action='store_true', help='Fetch missing translations from Google; sends public prose externally')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    if args.translate:
        with tempfile.TemporaryDirectory(prefix='wiki-l10n-') as folder:
            corpus_path = Path(folder) / 'corpus.json'
            subprocess.run(['node', 'scripts/build-localizations.mjs', 'prepare', str(corpus_path)], cwd=ROOT, check=True)
            corpus = json.loads(corpus_path.read_text())
        jobs = []
        for lang in corpus['languages']:
            code = lang['code']
            cache.setdefault(code, {})
            batch, size = [], 0
            for text in corpus['strings']:
                if key(text) in cache[code]: continue
                if batch and (size + len(text) > 8000 or len(batch) >= 80):
                    jobs.append((code, batch)); batch, size = [], 0
                batch.append(text); size += len(text)
            if batch: jobs.append((code, batch))
        print(f'Fetching {len(jobs)} batches across nine languages; completed translations are cached.', flush=True)
        errors = []
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(translate, code, texts): (code, texts) for code, texts in jobs}
            for done, future in enumerate(as_completed(futures), 1):
                code, texts = futures[future]
                try:
                    values = future.result()
                    with LOCK:
                        cache[code].update({key(text): value for text, value in zip(texts, values)})
                        if done % 20 == 0 or done == len(jobs): save(cache)
                except Exception as error:
                    errors.append(f'{code}: {error}')
                if done % 20 == 0 or done == len(jobs):
                    print(f'{done}/{len(jobs)} batches completed ({len(errors)} failures)', flush=True)
        save(cache)
        if errors: raise RuntimeError('Translation failed; rerun to resume: ' + '; '.join(errors[:5]))
    subprocess.run(['node', 'scripts/build-localizations.mjs', 'render', str(CACHE)], cwd=ROOT, check=True)

if __name__ == '__main__':
    main()
