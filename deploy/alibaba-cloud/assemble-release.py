#!/usr/bin/env python3
"""Reassemble a manifest-verified release using public unchanged GitHub files and an SSH delta."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

stage = Path(sys.argv[1])
expected_delta = sys.argv[2]
if not re.fullmatch(r'/root/cabinplay-deploy-[A-Za-z0-9-]+', str(stage)):
    raise SystemExit('Unexpected staging path')
delta_file = stage / 'release.delta.tar.gz'
if hashlib.sha256(delta_file.read_bytes()).hexdigest() != expected_delta:
    raise SystemExit('Delta checksum mismatch')
with tarfile.open(delta_file, 'r:gz') as delta:
    entries = {m.name.removeprefix('./'): m for m in delta.getmembers() if m.isfile()}
    manifest_bytes = delta.extractfile(entries['deployment-manifest.json']).read()
    manifest = json.loads(manifest_bytes)
    source = json.load(delta.extractfile(entries['delta-source.json']))
    commit = source['base_commit']
    if source['repository'] != 'Yuyue-lgtm/smart-cabin-riddle-demo' or not re.fullmatch('[a-f0-9]{40}', commit):
        raise SystemExit('Unexpected public source')
    base_file = stage / 'github-base.tar.gz'
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=https',
                    '--connect-timeout', '15', '--max-time', '180',
                    f'https://codeload.github.com/{source["repository"]}/tar.gz/{commit}', '-o', str(base_file)], check=True)
    with tarfile.open(base_file, 'r:gz') as base, tarfile.open(stage / 'release.tar.gz', 'w:gz') as output:
        base_entries = {}
        for member in base.getmembers():
            parts = PurePosixPath(member.name).parts
            if len(parts) > 1 and member.isfile():
                base_entries['/'.join(parts[1:])] = member
        for entry in manifest['files']:
            name = entry['path']
            parts = PurePosixPath(name)
            if parts.is_absolute() or '..' in parts.parts or any(p.startswith('.') for p in parts.parts):
                raise SystemExit('Unsafe manifest path')
            if name in entries:
                content = delta.extractfile(entries[name]).read()
            else:
                content = base.extractfile(base_entries[name]).read()
            if hashlib.sha256(content).hexdigest() != entry['sha256'] or len(content) != entry['bytes']:
                raise SystemExit('Release content mismatch: ' + name)
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(content), 0o644
            output.addfile(info, io.BytesIO(content))
        info = tarfile.TarInfo('deployment-manifest.json')
        info.size, info.mode = len(manifest_bytes), 0o644
        output.addfile(info, io.BytesIO(manifest_bytes))
print(json.dumps({'release_id': manifest['release_id'], 'files_verified': len(manifest['files']),
                  'archive_sha256': hashlib.sha256((stage / 'release.tar.gz').read_bytes()).hexdigest()}))
