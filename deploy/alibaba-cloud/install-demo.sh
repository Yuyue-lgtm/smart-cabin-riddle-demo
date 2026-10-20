#!/usr/bin/env bash
set -euo pipefail
umask 077
stage=${1:?staging directory required}
expected=${2:?archive checksum required}
[[ "$stage" =~ ^/root/cabinplay-deploy-[A-Za-z0-9-]+$ && "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 1
[ "$(id -u)" -eq 0 ] || exit 1
for file in release.tar.gz production.env smart-cabin-demo.service Caddyfile; do
    [ -f "$stage/$file" ] || { printf 'Missing staged file: %s\n' "$file" >&2; exit 1; }
done
[ ! -e /opt/smart-cabin-demo ] || { printf 'Existing Demo directory; review required\n' >&2; exit 1; }
[ ! -e /etc/smart-cabin-demo.env ] || exit 1
[ ! -e /etc/systemd/system/smart-cabin-demo.service ] || exit 1
/usr/local/bin/node --version
caddy version
(cd "$stage" && printf '%s  release.tar.gz\n' "$expected" | sha256sum --check -)
backup="/root/cabinplay-backups/$(date -u +%Y%m%dT%H%M%SZ)-demo"
install -d -m 700 "$backup"
if [ -f /etc/caddy/Caddyfile ]; then cp -p /etc/caddy/Caddyfile "$backup/Caddyfile"; fi
printf '%s\n' "$stage" > "$backup/staging-directory.txt"
python3 - "$stage/release.tar.gz" <<'PY'
import json, sys, tarfile, pathlib
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    for item in members:
        name = pathlib.PurePosixPath(item.name)
        if name.is_absolute() or '..' in name.parts or not (item.isfile() or item.isdir()):
            raise SystemExit('Unsafe archive member')
        if name.name.startswith('.') and name.name not in ('.',):
            raise SystemExit('Hidden archive member')
    manifest_member = next(m for m in members if m.name.removeprefix('./') == 'deployment-manifest.json')
    manifest = json.load(archive.extractfile(manifest_member))
    allowed = {item['path'] for item in manifest['files']} | {'deployment-manifest.json'}
    actual = {m.name.removeprefix('./') for m in members if m.isfile()}
    if actual != allowed:
        raise SystemExit('Archive differs from release manifest')
PY
if ! getent passwd smartcabin >/dev/null; then
    useradd --system --home-dir /opt/smart-cabin-demo --no-create-home --shell /usr/sbin/nologin smartcabin
fi
install -d -m 755 /opt/smart-cabin-demo
tar -xzf "$stage/release.tar.gz" -C /opt/smart-cabin-demo --no-same-owner
python3 - <<'PY'
import hashlib, json, pathlib
root = pathlib.Path('/opt/smart-cabin-demo')
manifest = json.loads((root / 'deployment-manifest.json').read_text())
for entry in manifest['files']:
    file = root / entry['path']
    if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != entry['sha256']:
        raise SystemExit('Extracted file checksum mismatch')
print(json.dumps({'release_id': manifest['release_id'], 'files_verified': len(manifest['files'])}))
PY
chown -R root:root /opt/smart-cabin-demo
chmod -R a+rX /opt/smart-cabin-demo
install -d -m 700 -o smartcabin -g smartcabin /opt/smart-cabin-demo/tmp
install -m 600 -o root -g root "$stage/production.env" /etc/smart-cabin-demo.env
install -m 644 "$stage/smart-cabin-demo.service" /etc/systemd/system/smart-cabin-demo.service
systemd-analyze verify /etc/systemd/system/smart-cabin-demo.service
caddy validate --config "$stage/Caddyfile" --adapter caddyfile
systemctl daemon-reload
systemctl enable --now smart-cabin-demo
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 \
    http://127.0.0.1:4173/api/health > /dev/null
install -m 644 "$stage/Caddyfile" /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy
systemctl is-active smart-cabin-demo caddy
printf 'Deployment backup: %s\n' "$backup"
