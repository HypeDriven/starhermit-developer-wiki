#!/usr/bin/env python3
"""Refresh the quickstart's vendored helpers and distributable ZIP."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'docs/examples/browser-quickstart'
for name in ('starhermit-sdk.js', 'cloud-save-store.js'):
    (TARGET / name).write_bytes((ROOT / 'docs/sdk' / name).read_bytes())
with ZipFile(ROOT / 'docs/examples/browser-quickstart.zip', 'w', ZIP_DEFLATED) as archive:
    for path in sorted(TARGET.iterdir()):
        if path.is_file():
            info = ZipInfo(path.name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
