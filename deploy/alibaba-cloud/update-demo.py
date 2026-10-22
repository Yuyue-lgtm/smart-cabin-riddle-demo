#!/usr/bin/env python3
"""Verify an existing Demo update, then switch it with a private rollback backup."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request


def health():
    with urllib.request.urlopen('http://127.0.0.1:4173/api/health', timeout=3) as response:
        return json.load(response)


def service(action):
    subprocess.run(['systemctl', action, 'smart-cabin-demo'], check=True, capture_output=True)


def private_write(path, content):
    with path.open('w', encoding='utf-8') as file:
        os.chmod(path, 0o600)
        file.write(content)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('stage')
    parser.add_argument('sha256')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r'/root/cabinplay-deploy-[A-Za-z0-9-]+', args.stage):
        raise SystemExit('Root and a dedicated staging directory are required')
    if not re.fullmatch('[a-f0-9]{64}', args.sha256):
        raise SystemExit('Invalid expected archive checksum')
    os.umask(0o077)
    stage, root, env = Path(args.stage), Path('/opt/smart-cabin-demo'), Path('/etc/smart-cabin-demo.env')
    archive_path, secret_path = stage / 'release.tar.gz', stage / 'voice-env.json'
    if root.is_symlink() or not root.is_dir() or not env.is_file():
        raise SystemExit('Expected an existing Demo directory and private environment file')
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != args.sha256:
        raise SystemExit('Release archive checksum mismatch')
    voice = json.loads(secret_path.read_text()) if secret_path.exists() else {}
    if voice and set(voice) != {'COSYVOICE_API_KEY', 'COSYVOICE_API_BASE_URL'}:
        raise SystemExit('Only the two voice environment settings may be updated')
    if voice and (not isinstance(voice['COSYVOICE_API_KEY'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{20,}', voice['COSYVOICE_API_KEY'])):
        raise SystemExit('Invalid voice credential encoding')
    if voice and voice['COSYVOICE_API_BASE_URL'] != 'https://dashscope-intl.aliyuncs.com':
        raise SystemExit('Unexpected voice regional endpoint')
    old_env = env.read_text()
    new_env = old_env
    for key, value in voice.items():
        pattern = rf'(?m)^{key}=.*$'
        new_env = re.sub(pattern, lambda _match: f'{key}={value}', new_env) if re.search(pattern, new_env) else new_env + ('' if new_env.endswith('\n') else '\n') + f'{key}={value}\n'
    unchanged = lambda text: [line for line in text.splitlines() if not line.startswith(tuple(f'{key}=' for key in voice))]
    if unchanged(old_env) != unchanged(new_env):
        raise SystemExit('Non-voice environment settings changed')
    before = health()
    if before.get('runtime') != 'production' or not before.get('workflow_proxy', {}).get('configured'):
        raise SystemExit('Existing production Demo is not healthy')
    if not voice and not before.get('host_voice_configured'):
        raise SystemExit('Existing voice configuration is missing')
    app_keys = ('chatflow_app_id', 'situation_app_id', 'preview_app_id')
    expected_apps = {key: before['workflow_proxy'].get(key) for key in app_keys}
    if not all(expected_apps.values()):
        raise SystemExit('Existing production Dify application bindings are missing')
    with tarfile.open(archive_path, 'r:gz') as archive:
        members = archive.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or any(part.startswith('.') and part != '.' for part in path.parts) or not (member.isfile() or member.isdir()):
                raise SystemExit('Unsafe archive entry')
        files = {member.name.removeprefix('./'): member for member in members if member.isfile()}
        manifest = json.load(archive.extractfile(files['deployment-manifest.json']))
        if len(files) != len([member for member in members if member.isfile()]):
            raise SystemExit('Duplicate archive entry')
        if set(files) != {entry['path'] for entry in manifest['files']} | {'deployment-manifest.json'}:
            raise SystemExit('Archive does not match its manifest')
        if 'api/cosyvoice-websocket.cjs' not in files:
            raise SystemExit('Required voice runtime module is missing')
        for entry in manifest['files']:
            content = archive.extractfile(files[entry['path']]).read()
            if len(content) != entry['bytes'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
                raise SystemExit('Release file verification failed')
        receipt = {'release_id': manifest['release_id'], 'files_verified': len(manifest['files']),
                   'production_apps': expected_apps, 'voice_model': 'cosyvoice-v3-flash', 'voice': 'longhua_v3',
                   'voice_settings_changed': bool(voice)}
        if not args.apply:
            print(json.dumps({**receipt, 'status': 'verified_only'}))
            return
        candidate = stage / 'app'
        candidate.mkdir(mode=0o755)
        candidate.chmod(0o755)
        for name, member in files.items():
            target = candidate / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())
            target.chmod(0o644)
        for directory in candidate.rglob('*'):
            if directory.is_dir():
                directory.chmod(0o755)
    backup = Path('/root/cabinplay-backups') / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-voice')
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(env, backup / 'production.env')
    (backup / 'production.env').chmod(0o600)
    env_next = env.with_name(env.name + '.voice-next')
    private_write(env_next, new_env)
    switched = False
    service('stop')
    try:
        if (root / 'tmp').exists():
            shutil.copytree(root / 'tmp', candidate / 'tmp')
        else:
            (candidate / 'tmp').mkdir(mode=0o700)
        for item in [candidate / 'tmp', *(candidate / 'tmp').rglob('*')]:
            shutil.chown(item, user='smartcabin', group='smartcabin')
        root.rename(backup / 'app')
        switched = True
        candidate.rename(root)
        env_next.replace(env)
        service('start')
        after = None
        for _ in range(40):
            try:
                after = health()
                if after.get('host_voice_configured') and after.get('runtime') == 'production' and all(after['workflow_proxy'].get(key) == value for key, value in expected_apps.items()):
                    break
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(0.25)
        else:
            raise RuntimeError('Updated Demo health check failed')
        receipt.update(status='deployed', backup=str(backup), server_instance_id=after['local_diagnostics']['server_instance_id'])
        private_write(backup / 'receipt.json', json.dumps(receipt, indent=2) + '\n')
        secret_path.unlink(missing_ok=True)
        print(json.dumps(receipt))
    except BaseException:
        service('stop')
        if switched:
            if root.exists():
                root.rename(stage / 'failed-app')
            (backup / 'app').rename(root)
        private_write(env_next, old_env)
        env_next.replace(env)
        service('start')
        raise


if __name__ == '__main__':
    main()
