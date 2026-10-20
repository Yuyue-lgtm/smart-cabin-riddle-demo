#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { printf 'Root required\n' >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { printf 'Unexpected architecture\n' >&2; exit 1; }
if command -v node >/dev/null 2>&1 || command -v caddy >/dev/null 2>&1; then
    printf 'Runtime already present; review rather than overwrite\n' >&2
    exit 1
fi
for file in /usr/local/bin/node /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg; do
    [ ! -e "$file" ] || { printf 'Existing runtime configuration: %s\n' "$file" >&2; exit 1; }
done
stage=$(mktemp -d /root/cabinplay-runtime.XXXXXX)
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$stage/SHASUMS256.txt"
read -r checksum archive < <(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ { print $1, $2 }' "$stage/SHASUMS256.txt")
[[ "$checksum" =~ ^[a-f0-9]{64}$ && "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || exit 1
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "https://nodejs.org/dist/latest-v22.x/$archive" -o "$stage/$archive"
(cd "$stage" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check -)
target="/opt/${archive%.tar.xz}"
[ ! -e "$target" ] || { printf 'Existing Node directory\n' >&2; exit 1; }
tar -xJf "$stage/$archive" -C /opt --no-same-owner
chmod -R a+rX "$target"
ln -s "$target/bin/node" /usr/local/bin/node
/usr/local/bin/node --version
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update
apt-get install -y --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https ca-certificates curl gnupg
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o "$stage/caddy.gpg.key"
gpg --batch --dearmor -o "$stage/caddy-keyring.gpg" "$stage/caddy.gpg.key"
install -m 644 "$stage/caddy-keyring.gpg" /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o "$stage/caddy-stable.list"
install -m 644 "$stage/caddy-stable.list" /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y --no-install-recommends caddy
caddy version
printf 'Runtime staging retained at %s\n' "$stage"
