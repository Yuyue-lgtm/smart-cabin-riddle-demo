import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export const tunnelLabel = 'xyz.cabinplay.dify-tunnel';
export const tunnelOrigin = 'http://127.0.0.1:8081';
// launchd cannot reliably read the privacy-protected Documents directory.
const privateFolder = path.join(os.homedir(), 'Library/Application Support/Cabinplay');
const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${tunnelLabel}.plist`);
const knownHostsFile = path.join(privateFolder, 'tunnel-known-hosts');
const trustedFingerprint = 'SHA256:/OZ8Q9HyG6CdXTKmQXc2qgatJGWHL7yk8JR2MlK4Z3k';
const domain = () => `gui/${process.getuid()}`;
const service = () => `${domain()}/${tunnelLabel}`;

export function sshArguments({ viaClient = false, keyFile = path.join(os.homedir(), '.ssh/id_rsa'),
  hostFile = knownHostsFile } = {}) {
  return ['-N', '-T', '-i', keyFile, '-p', viaClient ? '2222' : '22',
    '-L', '127.0.0.1:8081:127.0.0.1:8080',
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'HostKeyAlias=cabinplay-ecs', '-o', `UserKnownHostsFile=${hostFile.replace(/\\/g, '\\\\').replace(/ /g, '\\ ')}`,
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'TCPKeepAlive=yes',
    viaClient ? 'root@127.0.0.1' : 'root@47.83.188.59'];
}

export function verifiedHostKey(text) {
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const index = parts.indexOf('ssh-ed25519');
    if (index < 0 || !parts[index + 1]) continue;
    const digest = createHash('sha256').update(Buffer.from(parts[index + 1], 'base64')).digest('base64').replace(/=+$/, '');
    if (`SHA256:${digest}` === trustedFingerprint) return `cabinplay-ecs ssh-ed25519 ${parts[index + 1]}\n`;
  }
  throw new Error('ECS_HOST_KEY_NOT_VERIFIED: no key matches the independently verified ECS fingerprint');
}

export function launchAgentXml(args, logFolder = privateFolder) {
  const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${tunnelLabel}</string>
<key>ProgramArguments</key><array>${['/usr/bin/ssh', ...args].map(arg => `<string>${escape(arg)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>15</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escape(path.join(logFolder, 'tunnel.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(logFolder, 'tunnel.stderr.log'))}</string>
</dict></plist>\n`;
}

function launchctl(args, required = true) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8', timeout: 10000 });
  if (required && result.status !== 0) throw new Error(`LAUNCHCTL_FAILED: ${args[0]} (${result.status}); ${String(result.stderr || '').trim().slice(0, 200)}`);
  return result;
}

export async function tunnelReachable(origin = tunnelOrigin, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`${origin}/console/api/system-features`, {
      redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body);
  } catch { return false; }
}

export async function ensureTunnel(origin = tunnelOrigin, { timeoutMs = 18000 } = {}) {
  if (await tunnelReachable(origin)) return;
  if (origin === tunnelOrigin && fs.existsSync(plistPath)) {
    const current = launchctl(['print', service()], false);
    const loaded = current.status === 0;
    const listener = tunnelListener();
    const managedPid = Number(current.stdout?.match(/\bpid = (\d+)/)?.[1]) || null;
    if (listener && listener.pid !== managedPid) {
      throw new Error(`ECS_TUNNEL_PORT_OCCUPIED: 127.0.0.1:8081 is owned by ${listener.command} (PID ${listener.pid}); stop the old port forward before starting the managed SSH tunnel.`);
    }
    if (!loaded) launchctl(['bootstrap', domain(), plistPath]);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await tunnelReachable(origin)) return;
      await delay(500);
    }
  }
  throw new Error(`ECS_TUNNEL_UNAVAILABLE: ${origin}; run node tools/dify.mjs tunnel status or doctor. Check SSH entry/security-group access; Dify and the public website run independently on ECS.`);
}

function tunnelListener() {
  if (process.platform !== 'darwin') return null;
  const result = spawnSync('/usr/sbin/lsof', ['-nP', '-iTCP:8081', '-sTCP:LISTEN', '-Fpc'], {
    encoding: 'utf8', timeout: 3000,
  });
  const pid = Number(result.stdout?.match(/^p(\d+)/m)?.[1]);
  return pid ? { pid, command: result.stdout.match(/^c(.+)/m)?.[1] || 'unknown' } : null;
}

export async function tunnelStatus() {
  const result = launchctl(['print', service()], false);
  const text = result.stdout || '';
  const reachable = await tunnelReachable();
  const log = path.join(privateFolder, 'tunnel.stderr.log');
  const lastError = !reachable && fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).at(-1)?.slice(0, 300) : null;
  const pid = Number(text.match(/\bpid = (\d+)/)?.[1]) || null;
  const listener = tunnelListener();
  return { installed: fs.existsSync(plistPath), loaded: result.status === 0,
    pid, listener,
    failure_code: !reachable && listener && listener.pid !== pid ? 'LOCAL_PORT_OCCUPIED' : null,
    last_exit_code: text.match(/last exit code = (\d+)/)?.[1] || null,
    origin: tunnelOrigin, reachable, last_error: lastError, log };
}

export async function runTunnelCommand(action = 'status', args = []) {
  if (process.platform !== 'darwin') throw new Error('Automatic tunnel management currently requires macOS launchd');
  if (action === 'status') return tunnelStatus();
  if (action === 'stop') {
    launchctl(['bootout', service()], false);
    return { stopped: true, note: 'Installed login agent remains; use start to reconnect.' };
  }
  if (action === 'install') {
    if (args.some(arg => arg !== '--via-client')) throw new Error('Usage: tunnel install [--via-client]');
    const keyFile = path.join(os.homedir(), '.ssh/id_rsa');
    fs.accessSync(keyFile, fs.constants.R_OK);
    const source = fs.existsSync(knownHostsFile) ? knownHostsFile : path.join(root, 'tmp/alibaba-cloud/ssh-known-hosts');
    const key = verifiedHostKey(fs.readFileSync(source, 'utf8'));
    fs.mkdirSync(privateFolder, { recursive: true, mode: 0o700 });
    fs.writeFileSync(knownHostsFile, key, { mode: 0o600 });
    for (const suffix of ['stdout', 'stderr']) {
      const file = path.join(privateFolder, `tunnel.${suffix}.log`);
      fs.closeSync(fs.openSync(file, 'a', 0o600));
      fs.chmodSync(file, 0o600);
    }
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    if (fs.existsSync(plistPath)) fs.copyFileSync(plistPath, `${plistPath}.backup`);
    launchctl(['bootout', service()], false);
    fs.writeFileSync(plistPath, launchAgentXml(sshArguments({ viaClient: args.includes('--via-client'), keyFile })), { mode: 0o600 });
    launchctl(['bootstrap', domain(), plistPath]);
  } else if (action === 'start' || action === 'restart') {
    if (!fs.existsSync(plistPath)) throw new Error('Run node tools/dify.mjs tunnel install first');
    if (launchctl(['print', service()], false).status !== 0) launchctl(['bootstrap', domain(), plistPath]);
    else if (action === 'restart') launchctl(['kill', 'SIGTERM', service()], false);
  } else throw new Error('Usage: tunnel install|start|restart|stop|status');
  await ensureTunnel();
  return tunnelStatus();
}
