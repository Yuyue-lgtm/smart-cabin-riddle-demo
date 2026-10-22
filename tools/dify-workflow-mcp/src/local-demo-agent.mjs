import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const label = 'xyz.cabinplay.local-demo';
const domain = () => `gui/${process.getuid()}`;
const service = () => `${domain()}/${label}`;
const supportFolder = path.join(os.homedir(), 'Library/Application Support/Cabinplay');
const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
const healthUrl = 'http://127.0.0.1:4175/api/health';

function launchctl(args, required = true) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8', timeout: 10000 });
  if (required && result.status !== 0) {
    throw new Error(`LOCAL_DEMO_LAUNCHCTL_FAILED: ${args[0]} (${result.status}); ${String(result.stderr || '').trim().slice(0, 200)}`);
  }
  return result;
}

function listener() {
  const result = spawnSync('/usr/sbin/lsof', ['-nP', '-iTCP:4175', '-sTCP:LISTEN', '-Fpc'], {
    encoding: 'utf8', timeout: 3000,
  });
  const pid = Number(result.stdout?.match(/^p(\d+)/m)?.[1]);
  return pid ? { pid, command: result.stdout.match(/^c(.+)/m)?.[1] || 'unknown' } : null;
}

function escape(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function agentXml() {
  const argumentsXml = [process.execPath, path.join(projectRoot, 'dev-server.cjs')]
    .map(value => `<string>${escape(value)}</string>`).join('');
  const environmentXml = [['PORT', '4175'], ['RUNTIME_ENV', 'local']]
    .map(([key, value]) => `<key>${key}</key><string>${value}</string>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${argumentsXml}</array>
<key>WorkingDirectory</key><string>${escape(projectRoot)}</string>
<key>EnvironmentVariables</key><dict>${environmentXml}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escape(path.join(supportFolder, 'local-demo.stdout.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(supportFolder, 'local-demo.stderr.log'))}</string>
</dict></plist>\n`;
}

async function waitForHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`LOCAL_DEMO_START_TIMEOUT: ${healthUrl}; inspect ${path.join(supportFolder, 'local-demo.stderr.log')}`);
}

export async function runLocalDemoAgent(action = 'status') {
  if (process.platform !== 'darwin') throw new Error('Automatic local Demo startup requires macOS launchd');
  if (!['status', 'install', 'start', 'stop'].includes(action)) {
    throw new Error('Usage: node tools/dify.mjs dev-agent status|install|start|stop');
  }

  if (action === 'stop') {
    launchctl(['bootout', service()], false);
    return localDemoStatus();
  }
  if (action === 'status') return localDemoStatus();

  if (action === 'install') {
    fs.mkdirSync(supportFolder, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    for (const suffix of ['stdout', 'stderr']) {
      const file = path.join(supportFolder, `local-demo.${suffix}.log`);
      fs.closeSync(fs.openSync(file, 'a', 0o600));
      fs.chmodSync(file, 0o600);
    }
    if (fs.existsSync(plistPath)) fs.copyFileSync(plistPath, `${plistPath}.backup`);
    launchctl(['bootout', service()], false);
    fs.writeFileSync(plistPath, agentXml(), { mode: 0o600 });
    launchctl(['bootstrap', domain(), plistPath]);
  } else if (action === 'start' && launchctl(['print', service()], false).status !== 0) {
    if (!fs.existsSync(plistPath)) throw new Error('Run node tools/dify.mjs dev-agent install first');
    launchctl(['bootstrap', domain(), plistPath]);
  }

  await waitForHealth();
  return localDemoStatus();
}

function localDemoStatus() {
  const result = launchctl(['print', service()], false);
  const text = result.stdout || '';
  return {
    installed: fs.existsSync(plistPath),
    loaded: result.status === 0,
    pid: Number(text.match(/\bpid = (\d+)/)?.[1]) || null,
    listener: listener(),
    health_url: healthUrl,
    log: path.join(supportFolder, 'local-demo.stderr.log'),
  };
}
