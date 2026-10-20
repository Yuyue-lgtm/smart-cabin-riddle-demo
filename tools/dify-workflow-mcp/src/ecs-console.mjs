import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createConsoleClient } from './console-client.mjs';

export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const ecsSessionPath = path.join(projectRoot, 'tools/dify-workflow-mcp/.env.ecs');
export const profilesPath = path.join(projectRoot, 'dify/environments.json');

export function ecsOrigin(value = process.env.DIFY_ECS_CONSOLE_URL || 'http://127.0.0.1:8081') {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:'
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ECS console must use a local HTTP tunnel origin, such as http://127.0.0.1:8081');
  }
  return url.origin;
}

export function createEcsConsole({ origin = ecsOrigin(), envPath = ecsSessionPath,
  fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  const allowedOrigin = ecsOrigin(origin);
  const request = createConsoleClient({ envPath, env: { DIFY_BASE_URL: allowedOrigin }, allowedOrigin, fetchImpl });
  return request;
}

export function writePrivateEnv(file, changes) {
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = original.split(/\r?\n/).filter(Boolean);
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment key');
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const replacement = `${key}=${JSON.stringify(String(value))}`;
    const matches = lines.flatMap((line, i) => pattern.test(line) ? [i] : []);
    if (!matches.length) lines.push(replacement);
    else {
      lines[matches[0]] = replacement;
      for (const i of matches.slice(1).reverse()) lines.splice(i, 1);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function readPrivateEnv(file) {
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file, 'utf8')) : {};
}

export function saveEcsSession(response, origin = ecsOrigin(), file = ecsSessionPath) {
  const cookies = new Map((response.headers.getSetCookie?.() || []).map(cookie => {
    const pair = cookie.split(';')[0], separator = pair.indexOf('=');
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
  const accessName = [...cookies.keys()].find(name => /^(?:__Host-)?access_token$/.test(name));
  const csrfName = [...cookies.keys()].find(name => /^(?:__Host-)?csrf_token$/.test(name));
  const refreshName = [...cookies.keys()].find(name => /^(?:__Host-)?refresh_token$/.test(name));
  if (!accessName || !csrfName || !refreshName) throw new Error('Login did not return all session cookies');
  writePrivateEnv(file, { DIFY_BASE_URL: ecsOrigin(origin),
    DIFY_ACCESS_COOKIE_NAME: accessName, DIFY_CSRF_COOKIE_NAME: csrfName, DIFY_REFRESH_COOKIE_NAME: refreshName,
    DIFY_CONSOLE_TOKEN: cookies.get(accessName), DIFY_CSRF_TOKEN: cookies.get(csrfName),
    DIFY_REFRESH_TOKEN: cookies.get(refreshName) });
}

export async function probeEcs(origin = ecsOrigin()) {
  const { ensureTunnel } = await import('./ecs-tunnel.mjs');
  await ensureTunnel(origin);
}
