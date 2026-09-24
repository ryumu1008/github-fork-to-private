#!/usr/bin/env python3
"""Build an allowlisted, reproducible unpacked-extension ZIP without development files."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text())
files = {'manifest.json', 'shared.js', 'background.js', 'popup.html', 'popup.js',
         'content_repo.js', 'content_import.js', 'style.css', 'LICENSE', 'README.md', 'SECURITY.md'}
files.update(manifest['icons'].values())
for filename in files:
    if not (root / filename).is_file():
        raise SystemExit('Missing extension file: ' + filename)
output = root / 'dist' / ('github-fork-to-private-' + manifest['version'] + '.zip')
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for filename in sorted(files):
        info = zipfile.ZipInfo(filename, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (root / filename).read_bytes())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == files
print(output.name)
print('SHA256 ' + hashlib.sha256(output.read_bytes()).hexdigest())
