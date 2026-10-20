#!/usr/bin/env bash
set -eu

privileged() {
    if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi
}

printf '== Identity and system ==\n'
id
uname -srmo
printf '\n== Disk and memory ==\n'
df -h / /opt/dify
free -h
printf '\n== Runtime commands ==\n'
for name in node caddy nginx docker; do command -v "$name" || true; done
if command -v node >/dev/null 2>&1; then node --version; fi
printf '\n== Service state ==\n'
systemctl is-active caddy nginx smart-cabin-demo || true
printf '\n== Listener bindings ==\n'
privileged ss -lntp
printf '\n== Dify containers (no environment output) ==\n'
privileged docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
printf '\n== Container resource usage ==\n'
privileged docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
printf '\n== Existing application directories ==\n'
for folder in /opt/dify/docker /opt/smart-cabin-demo; do
    if [ -d "$folder" ]; then stat -c '%n %U:%G %a' "$folder"; fi
done
printf '\n== SSH host public-key fingerprint ==\n'
if [ -f /etc/ssh/ssh_host_ed25519_key.pub ]; then
    ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
fi
