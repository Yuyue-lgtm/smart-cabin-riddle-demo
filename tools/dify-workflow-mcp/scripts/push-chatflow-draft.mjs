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

const codeOnly = process.argv.includes('--code-only');
const guardOnly = process.argv.includes('--guard-only');
if (codeOnly && guardOnly) throw new Error('Choose only one scoped update mode.');
const graph = codeOnly || guardOnly ? structuredClone(current.graph) : dsl.workflow.graph;
if (codeOnly) {
  for (const id of ['1000000000002', '1000000000004', '1000000000006', '1000000000010']) {
    const target = graph.nodes.find((node) => node.id === id);
    const source = dsl.workflow.graph.nodes.find((node) => node.id === id);
    if (target?.data?.type !== 'code' || source?.data?.type !== 'code') {
      throw new Error(`Expected code node ${id}; refusing to replace draft.`);
    }
    target.data.code = source.data.code;
    target.data.outputs = source.data.outputs;
  }
}
if (guardOnly) {
  const id = '1000000000006';
  const target = graph.nodes.find((node) => node.id === id);
  const baseline = dsl.workflow.graph.nodes.find((node) => node.id === id);
  if (target?.data?.type !== 'code' || baseline?.data?.type !== 'code'
    || target.data.code !== baseline.data.code) {
    throw new Error('Cloud guard differs from the local baseline; refusing to replace it.');
  }
  const sourceDir = path.join(connectorDir, 'workflows/host/src');
  const sources = ['common.py', 'parallel_common.py', 'realtime_guard.py', 'knowhow_guard.py', 'parallel_guard.py'];
  target.data.code = sources.map((name) => fs.readFileSync(path.join(sourceDir, name), 'utf8').trim()).join('\n\n');
  if (!target.data.code.includes('fallback_reason_codes')
    || !target.data.code.includes('validation_reason_codes')) {
    throw new Error('Diagnostic reason codes are missing from the replacement guard.');
  }
}

const updated = await request(endpoint, {
  method: 'POST',
  body: JSON.stringify({
    graph,
    features: codeOnly || guardOnly ? current.features : dsl.workflow.features,
    conversation_variables: codeOnly || guardOnly ? current.conversation_variables : dsl.workflow.conversation_variables || [],
    hash: current.hash,
  }),
});
const verified = await request(endpoint);
if (codeOnly && JSON.stringify(verified.graph.nodes.map((node) => node.data)) !== JSON.stringify(graph.nodes.map((node) => node.data))) {
  throw new Error('Saved draft data differs from the intended code-only update; inspect the draft before continuing.');
}
if (guardOnly && JSON.stringify(verified.graph.nodes.map((node) => node.data)) !== JSON.stringify(graph.nodes.map((node) => node.data))) {
  throw new Error('Saved draft data differs from the intended guard-only update; inspect the draft before continuing.');
}
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
