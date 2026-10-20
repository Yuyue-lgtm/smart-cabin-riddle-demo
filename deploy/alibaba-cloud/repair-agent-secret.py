#!/usr/bin/env python3
"""Repair only an invalid Agent Stub root secret; never print environment values."""
import argparse
import base64
import copy
import datetime
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import time

KEY = "DIFY_AGENT_SERVER_SECRET_KEY"
FOLDER = Path("/opt/dify/docker")


def run(*args):
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("Command failed; raw output suppressed to protect credentials")
    return result.stdout


def valid_secret(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        return False
    try:
        decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    except ValueError:
        return False
    return len(decoded) == 32


def replace_secret(content, value):
    pattern = re.compile(r"^(?:export[ \t]+)?" + KEY + r"[ \t]*=.*$", re.MULTILINE)
    if len(pattern.findall(content)) != 1:
        raise RuntimeError("Expected exactly one root-secret assignment; review manually")
    return pattern.sub(KEY + "=" + value, content)


def verify_config_change(before, after, value):
    expected = copy.deepcopy(before)
    affected = []
    for name, service in expected["services"].items():
        env = service.get("environment", {})
        if KEY in env:
            env[KEY] = value
            affected.append(name)
    if after != expected or "agent_backend" not in affected:
        raise RuntimeError("Compose changed beyond the single approved secret")
    if after["services"]["agent_backend"].get("ports"):
        raise RuntimeError("Agent backend must not publish host ports")
    return affected


def containers():
    ids = run("docker", "compose", "ps", "-aq").split()
    records = json.loads(run("docker", "inspect", *ids))
    return {c["Config"]["Labels"]["com.docker.compose.service"]: c for c in records}


def write_private(path, content):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
        os.fchmod(stream.fileno(), 0o600)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", required=True)
    parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Root is required")
    os.chdir(FOLDER)
    before = json.loads(run("docker", "compose", "config", "--format", "json"))
    agent = before["services"]["agent_backend"]
    old = agent.get("environment", {}).get(KEY)
    if valid_secret(old):
        raise RuntimeError("Secret is already valid; refusing an unnecessary key rotation")
    original = containers()
    current = original["agent_backend"]
    if current["State"]["Status"] != "restarting":
        raise RuntimeError("Expected the diagnosed restart loop; review changed server state")
    log = subprocess.run(
        ["docker", "logs", "--tail", "100", current["Id"]], text=True, capture_output=True
    )
    if "must decode to exactly 32 decoded bytes" not in log.stdout + log.stderr:
        raise RuntimeError("Expected secret-length startup failure was not found")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("/root/cabinplay-backups") / (stamp + "-agent-secret")
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup.parent, 0o700)
    for name in (".env", "docker-compose.yaml", "docker-compose.override.yaml"):
        source = FOLDER / name
        if source.is_file():
            shutil.copy2(source, backup / name)
            os.chmod(backup / name, 0o600)
    value = secrets.token_urlsafe(32)
    if not valid_secret(value):
        raise RuntimeError("Generated secret failed validation")
    env_file = FOLDER / ".env"
    previous_content = env_file.read_text()
    updated = replace_secret(previous_content, value)
    write_private(env_file, updated)
    try:
        after = json.loads(run("docker", "compose", "config", "--format", "json"))
        affected = verify_config_change(before, after, value)
    except Exception:
        write_private(env_file, previous_content)
        raise
    receipt = {"backup": str(backup), "changed_variable": KEY,
               "changed_env_definitions": affected, "recreated_services": ["agent_backend"],
               "started_at_utc": stamp, "verified": False}
    write_private(backup / "receipt.json", json.dumps(receipt, indent=2) + "\n")
    run("docker", "compose", "up", "-d", "--no-deps", "--pull", "never",
        "--force-recreate", "agent_backend")
    for attempt in range(18):
        time.sleep(5)
        now = containers()
        live = now["agent_backend"]
        if live["State"]["Status"] == "running" and live["RestartCount"] == 0:
            check = subprocess.run(["docker", "exec", "docker-api-1", "python", "-c",
                "import json,urllib.request; r=urllib.request.urlopen('http://agent_backend:5050/openapi.json',timeout=3); assert r.status == 200; assert json.load(r)['info']['title'] == 'Dify Agent Run Server'"],
                text=True, capture_output=True)
            if check.returncode == 0:
                break
    else:
        raise RuntimeError("Agent health verification failed; preserve private backup and investigate")
    changed_others = [name for name, c in original.items() if name != "agent_backend"
                      and (name not in now or now[name]["Id"] != c["Id"]
                           or now[name]["RestartCount"] != c["RestartCount"])]
    if changed_others:
        raise RuntimeError("Other containers changed during verification; review privately")
    receipt.update({"verified": True, "agent_status": live["State"]["Status"],
                    "restart_count": live["RestartCount"], "readiness_path": "/openapi.json", "readiness_http": 200,
                    "other_containers_unchanged": True, "published_ports": live["NetworkSettings"].get("Ports")})
    write_private(backup / "receipt.json", json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never echo raw subprocess stderr or a settings object containing secrets.
        print(json.dumps({"ok": False, "error_type": type(error).__name__,
                          "message": str(error) if isinstance(error, RuntimeError) else "Operation failed; inspect privately"}))
        raise SystemExit(1)
