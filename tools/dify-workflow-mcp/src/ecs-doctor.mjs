import fs from 'node:fs';
import path from 'node:path';
import { createEcsConsole, ecsOrigin, projectRoot, profilesPath, readPrivateEnv } from './ecs-console.mjs';
import { tunnelReachable, tunnelStatus } from './ecs-tunnel.mjs';

export async function verifyTestApiKeys(env, fetchImpl = globalThis.fetch) {
  await Promise.all(['CHATFLOW', 'SITUATION', 'PREVIEW'].map(async kind => {
    const key = env[`DIFY_${kind}_API_KEY`];
    if (!key) throw new Error(`DIFY_${kind}_API_KEY_MISSING`);
    let response;
    try {
      response = await fetchImpl(`${env.DIFY_API_BASE_URL}/v1/parameters`, {
        headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(8000),
      });
    } catch (error) { throw new Error(`DIFY_${kind}_UNREACHABLE: ${error.cause?.code || error.name}`); }
    if (!response.ok) throw new Error(`DIFY_${kind}_KEY_CHECK_FAILED: HTTP ${response.status}`);
    await response.json();
  }));
}

export async function diagnoseEcs() {
  const checks = [];
  const check = async (name, run) => {
    const started = Date.now();
    try { const details = await run(); checks.push({ name, ok: true, elapsed_ms: Date.now() - started, ...details }); }
    catch (error) { checks.push({ name, ok: false, elapsed_ms: Date.now() - started,
      error: error.code || error.cause?.code || error.message }); }
  };
  const env = readPrivateEnv(path.join(projectRoot, '.env.local'));
  const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  const testing = profiles.environments['alibaba-test'];
  const origin = ecsOrigin();
  const request = createEcsConsole();
  const json = async (url, options = {}) => {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return response.json();
  };
  const expected = { CHATFLOW: testing.apps.host, SITUATION: testing.apps.situation, PREVIEW: testing.apps.preview };
  await check('local_configuration', async () => {
    if (env.DIFY_API_BASE_URL !== origin || env.DIFY_ENVIRONMENT !== 'alibaba-test'
      || Object.entries(expected).some(([kind, id]) => env[`DIFY_${kind}_APP_ID`] !== id)) {
      throw new Error('TEST_ENVIRONMENT_MISMATCH');
    }
    return { api_origin: origin, environment: env.DIFY_ENVIRONMENT };
  });
  const reachable = await tunnelReachable(origin);
  await check('ssh_tunnel_and_dify', async () => {
    if (!reachable) throw new Error('ECS_TUNNEL_UNAVAILABLE');
    return { api_origin: origin };
  });
  if (reachable) {
    await check('console_session', async () => { await request('/apps?page=1&limit=1'); return {}; });
    for (const [kind, id] of Object.entries(expected)) {
      await check(`test_${kind.toLowerCase()}_key`, async () => {
        const key = env[`DIFY_${kind}_API_KEY`];
        if (!key) throw new Error('API_KEY_MISSING');
        await json(`${origin}/v1/parameters`, { headers: { Authorization: `Bearer ${key}` } });
        return { app_id: id };
      });
    }
  } else {
    for (const name of ['console_session', 'test_chatflow_key', 'test_situation_key', 'test_preview_key']) {
      checks.push({ name, ok: false, skipped: true, error: 'BLOCKED_BY_TUNNEL' });
    }
  }
  await check('local_demo', async () => {
    const health = await json('http://127.0.0.1:4175/api/health');
    const proxy = health.workflow_proxy || {};
    if (proxy.environment !== 'alibaba-test' || proxy.chatflow_app_id !== expected.CHATFLOW
      || proxy.situation_app_id !== expected.SITUATION || proxy.preview_app_id !== expected.PREVIEW) {
      throw new Error('LOCAL_DEMO_ENVIRONMENT_MISMATCH');
    }
    return { url: 'http://127.0.0.1:4175/', server_instance_id: health.local_diagnostics?.server_instance_id };
  });
  await check('production_demo', async () => {
    const health = await json('https://cabinplay.xyz/api/health');
    if (health.runtime !== 'production' || !health.ok) throw new Error('PRODUCTION_HEALTH_FAILED');
    const apps = profiles.environments.alibaba.apps;
    const proxy = health.workflow_proxy || {};
    if (proxy.chatflow_app_id !== apps.host || proxy.situation_app_id !== apps.situation
      || proxy.preview_app_id !== apps.preview) throw new Error('PRODUCTION_APP_BINDING_MISMATCH');
    return { url: 'https://cabinplay.xyz/' };
  });
  const report = { checked_at: new Date().toISOString(), ok: checks.every(item => item.ok),
    tunnel: await tunnelStatus(), checks };
  const file = path.join(projectRoot, 'tmp/dify-ecs/doctor.json');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}
