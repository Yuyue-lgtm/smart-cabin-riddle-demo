import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const connectorDir = path.resolve(scriptDir, '..');
dotenv.config({ path: path.join(connectorDir, '.env') });

const [appId, expectedHash, dslPath] = process.argv.slice(2);
if (!appId || !expectedHash || !dslPath) {
  throw new Error('Usage: node push-chatflow-draft.mjs <app-id> <expected-hash> <dsl-path>');
}

const allowedIds = (process.env.DIFY_ALLOWED_APP_IDS || '')
  .split(',').map((id) => id.trim()).filter(Boolean);
if (!allowedIds.includes(appId)) throw new Error('Target app is not in DIFY_ALLOWED_APP_IDS.');

const baseUrl = process.env.DIFY_BASE_URL || 'https://cloud.dify.ai';
if (new URL(baseUrl).origin !== 'https://cloud.dify.ai') {
  throw new Error('This updater is restricted to https://cloud.dify.ai.');
}
const proxyUrl = process.env.DIFY_PROXY_URL ?? 'http://127.0.0.1:7897';
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

const token = process.env.DIFY_CONSOLE_TOKEN;
const csrf = process.env.DIFY_CSRF_TOKEN;
if (!token || !csrf) throw new Error('DIFY_CONSOLE_TOKEN and DIFY_CSRF_TOKEN are required in connector .env.');
const csrfCookieName = process.env.DIFY_CSRF_COOKIE_NAME || 'csrf_token';
const dsl = YAML.parse(fs.readFileSync(path.resolve(dslPath), 'utf8'));
if (dsl?.kind !== 'app' || dsl?.app?.mode !== 'advanced-chat' || !Array.isArray(dsl?.workflow?.graph?.nodes)) {
  throw new Error('Expected an advanced-chat Dify DSL.');
}

const endpoint = `${baseUrl}/console/api/apps/${appId}/workflows/draft`;
const headers = {
  Accept: 'application/json',
  Authorization: `Bearer ${token}`,
  'X-CSRF-Token': csrf,
  Cookie: `${csrfCookieName}=${csrf}`,
  'Content-Type': 'application/json',
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(30_000) });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 500) }; }
  if (!response.ok) {
    throw new Error(`Dify draft request failed (${response.status}): ${data.message || 'request rejected'}`);
  }
  return data;
}

const current = await request(endpoint);
if (current.hash !== expectedHash) {
  throw new Error('Dify draft changed since preview; fetch the latest hash before writing.');
}

const updated = await request(endpoint, {
  method: 'POST',
  body: JSON.stringify({
    graph: dsl.workflow.graph,
    features: dsl.workflow.features,
    conversation_variables: dsl.workflow.conversation_variables || [],
    hash: current.hash,
  }),
});
const verified = await request(endpoint);
if (!Array.isArray(verified.conversation_variables)
  || !verified.conversation_variables.some((item) => item.name === 'cabin_snapshot')) {
  throw new Error('Draft save returned, but cabin_snapshot was not present in the saved draft.');
}

process.stdout.write(JSON.stringify({
  app_id: appId,
  hash: verified.hash || updated.hash,
  updated_at: updated.updated_at,
  published: false,
  conversation_variable: 'cabin_snapshot',
}, null, 2) + '\n');
