import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';

export function createConsoleClient({ envPath, env = process.env, fetchImpl = (...args) => fetch(...args) }) {
  const readConfig = () => {
    const disk = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath, 'utf8')) : {};
    const values = { ...env, ...disk };
    const origin = new URL(values.DIFY_BASE_URL || 'https://cloud.dify.ai');
    if (origin.protocol !== 'https:' || origin.hostname !== 'cloud.dify.ai') {
      throw new Error('This connector is restricted to https://cloud.dify.ai.');
    }
    const prefix = (values.DIFY_CSRF_COOKIE_NAME || 'csrf_token').startsWith('__Host-') ? '__Host-' : '';
    return {
      base: `${origin.origin}/console/api`,
      access: values.DIFY_CONSOLE_TOKEN || '', csrf: values.DIFY_CSRF_TOKEN || '', refresh: values.DIFY_REFRESH_TOKEN || '',
      accessName: values.DIFY_ACCESS_COOKIE_NAME || `${prefix}access_token`,
      csrfName: values.DIFY_CSRF_COOKIE_NAME || 'csrf_token',
      refreshName: values.DIFY_REFRESH_COOKIE_NAME || `${prefix}refresh_token`,
    };
  };

  async function send(url, { raw = false, ...options } = {}) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000) });
    if (response.ok && raw) return response;
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(`Dify console request failed (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function persist(values) {
    const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
    for (const [key, value] of Object.entries(values)) {
      const index = lines.findIndex(line => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line));
      const line = `${key}=${JSON.stringify(value)}`;
      if (index >= 0) lines[index] = line;
      else lines.push(line);
    }
    const temporary = `${envPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, envPath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  // Refresh cookies rotate. Serialize refreshes across connector and diagnostic processes.
  async function refresh(failedAccess) {
    const lock = `${envPath}.refresh.lock`;
    const deadline = Date.now() + 40_000;
    let fd;
    while (fd === undefined) {
      try {
        fd = fs.openSync(lock, 'wx', 0o600);
        fs.writeSync(fd, String(process.pid));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const pid = Number(fs.readFileSync(lock, 'utf8'));
          if (pid > 0) process.kill(pid, 0);
          else if (Date.now() - fs.statSync(lock).mtimeMs > 45_000) fs.unlinkSync(lock);
        } catch (lockError) {
          if (lockError.code === 'ESRCH') fs.rmSync(lock, { force: true });
          else if (lockError.code !== 'ENOENT') throw lockError;
        }
        if (Date.now() >= deadline) throw new Error('Dify console refresh lock timed out.');
        await delay(100);
      }
    }
    try {
      const config = readConfig();
      if (config.access && config.access !== failedAccess) return;
      if (!config.refresh) throw new Error('DIFY_REFRESH_TOKEN is missing; restore the private Dify connector session.');
      let response;
      try {
        response = await send(`${config.base}/refresh-token`, {
          method: 'POST', raw: true,
          headers: { Accept: 'application/json', Cookie: `${config.refreshName}=${config.refresh}` },
        });
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          throw new Error('DIFY_REFRESH_SESSION_EXPIRED: automatic refresh was rejected; restore the connector refresh cookie once.');
        }
        throw error;
      }
      const cookies = new Map((response.headers.getSetCookie?.() || []).map(cookie => {
        const pair = cookie.split(';', 1)[0], index = pair.indexOf('=');
        return [pair.slice(0, index), pair.slice(index + 1)];
      }));
      const access = cookies.get(config.accessName), csrf = cookies.get(config.csrfName), renewed = cookies.get(config.refreshName);
      if (!access || !csrf || !renewed) {
        throw new Error('DIFY_AUTH_COOKIE_MISMATCH: refresh did not return the configured access, CSRF and refresh cookies.');
      }
      persist({ DIFY_CONSOLE_TOKEN: access, DIFY_CSRF_TOKEN: csrf, DIFY_REFRESH_TOKEN: renewed });
      await response.body?.cancel();
    } finally {
      fs.closeSync(fd);
      fs.rmSync(lock, { force: true });
    }
  }

  return async function requestConsoleJson(pathname, { method = 'GET', body, form, raw = false } = {}) {
    if (!pathname.startsWith('/') || pathname.startsWith('//')) throw new Error('Expected a console API path.');
    let config = readConfig();
    const request = current => send(`${current.base}${pathname}`, {
      method, raw,
      headers: { Accept: 'application/json', Authorization: `Bearer ${current.access}`,
        ...(current.csrf ? { 'X-CSRF-Token': current.csrf, Cookie: `${current.csrfName}=${current.csrf}` } : {}),
        ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(form ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!config.access) {
      await refresh('');
      config = readConfig();
    }
    try {
      return await request(config);
    } catch (error) {
      if (error.status !== 401) throw error;
      await refresh(config.access);
      return request(readConfig());
    }
  };
}
