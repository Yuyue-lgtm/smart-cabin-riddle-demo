#!/usr/bin/env python3
"""Apply the approved loopback-only plugin port override, without exposing env values."""
import copy
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Root is required")
    folder = Path("/opt/dify/docker")
    os.chdir(folder)
    override = folder / "docker-compose.override.yaml"
    if any((folder / name).exists() for name in (
        "docker-compose.override.yaml", "docker-compose.override.yml", "compose.override.yaml", "compose.override.yml"
    )):
        raise SystemExit("An override already exists; review it instead of overwriting")
    before = json.loads(run("docker", "compose", "config", "--format", "json"))
    ports = before["services"]["plugin_daemon"].get("ports", [])
    if len(ports) != 1 or ports[0].get("target") != 5003 or ports[0].get("published") != "5003":
        raise SystemExit("Unexpected plugin port configuration")
    backup = Path("/root/cabinplay-backups") / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ-plugin")
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup.parent, 0o700)
    for name in ("docker-compose.yaml", ".env"):
        if (folder / name).is_file():
            shutil.copy2(folder / name, backup / name)
            os.chmod(backup / name, 0o600)
    content = 'services:\n  plugin_daemon:\n    ports: !override\n      - "127.0.0.1:5003:5003"\n'
    fd = os.open(override, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
    try:
        after = json.loads(run("docker", "compose", "config", "--format", "json"))
        expected = copy.deepcopy(before)
        expected["services"]["plugin_daemon"]["ports"][0]["host_ip"] = "127.0.0.1"
        if after != expected:
            raise RuntimeError("Compose changed beyond the approved port binding")
    except Exception:
        override.unlink()
        raise
    subprocess.run(["docker", "compose", "up", "-d", "--no-deps", "--force-recreate", "plugin_daemon"], check=True)
    bindings = json.loads(run("docker", "inspect", "docker-plugin_daemon-1", "--format", "{{json .HostConfig.PortBindings}}"))
    if bindings.get("5003/tcp") != [{"HostIp": "127.0.0.1", "HostPort": "5003"}]:
        raise RuntimeError("Plugin port verification failed; review before continuing")
    print(json.dumps({"plugin_debug_bind": "127.0.0.1:5003", "backup": str(backup), "other_services_restarted": False}))


if __name__ == "__main__":
    main()
