import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { createConsoleClient } from './console-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, '../.env');
dotenv.config({ path: envPath, quiet: true });

// Node's fetch does not inherit the macOS system proxy settings.
const proxyUrl = process.env.DIFY_PROXY_URL ?? 'http://127.0.0.1:7897';
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

const BASE_URL = process.env.DIFY_BASE_URL || 'https://cloud.dify.ai';
const cloudConsole = createConsoleClient({ envPath });
export async function requestConsoleJson(pathname, options = {}) {
  const profilesPath = path.resolve(here, '../../../dify/environments.json');
  const profiles = fs.existsSync(profilesPath) ? JSON.parse(fs.readFileSync(profilesPath, 'utf8')) : null;
  if (profiles?.environments?.cloud?.role?.startsWith('Historical')
    && (options.method || 'GET') !== 'GET' && process.env.DIFY_ALLOW_HISTORICAL_CLOUD_WRITES !== '1') {
    throw new Error('Cloud is a historical backup and is read-only. Use node tools/dify.mjs for ECS development.');
  }
  return cloudConsole(pathname, options);
}
const DEFAULT_APP_IDS = [
  'bf81cd44-a49f-4048-901f-e95e941dc429',
  'dddd27b9-e7c5-4936-90da-8640d7ac8991',
];
const allowedAppIds = new Set(
  (process.env.DIFY_ALLOWED_APP_IDS || DEFAULT_APP_IDS.join(','))
    .split(',').map((id) => id.trim()).filter(Boolean),
);
const appApiKeys = parseJsonEnv('DIFY_WORKFLOW_API_KEYS', {});

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}

function assertCloudBaseUrl() {
  const url = new URL(BASE_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'cloud.dify.ai') {
    throw new Error('This connector is restricted to https://cloud.dify.ai.');
  }
  return url.origin;
}

function requireAppAccess(appId) {
  if (!allowedAppIds.has(appId)) throw new Error('This app ID is not in DIFY_ALLOWED_APP_IDS.');
}

async function requestJson(url, { token, body, form, raw = false, method = 'GET' } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(form ? { body: form } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok && raw) return response;
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 1000) }; }
  if (!response.ok) {
    const detail = typeof data.message === 'string' ? data.message : `HTTP ${response.status}`;
    const error = new Error(`Dify request failed (${response.status}): ${detail}`);
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return data;
}

async function getDraft(appId) {
  requireAppAccess(appId);
  return requestConsoleJson(`/apps/${appId}/workflows/draft`);
}

function readDsl(yamlText) {
  if (yamlText.length > 10 * 1024 * 1024) throw new Error('DSL exceeds Dify\'s 10 MB import limit.');
  const document = parseDocument(yamlText, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid DSL YAML: ${document.errors[0].message}`);
  const dsl = document.toJS();
  if (dsl?.kind !== 'app' || dsl?.app?.mode !== 'workflow' || !Array.isArray(dsl?.workflow?.graph?.nodes)) {
    throw new Error('Expected a Dify workflow app DSL with workflow.graph.nodes.');
  }
  return dsl;
}

function readChatflowDsl(yamlText) {
  if (yamlText.length > 10 * 1024 * 1024) throw new Error('DSL exceeds Dify\'s 10 MB import limit.');
  const document = parseDocument(yamlText, { uniqueKeys: true });
  if (document.errors.length) throw new Error(`Invalid DSL YAML: ${document.errors[0].message}`);
  const dsl = document.toJS();
  const nodes = dsl?.workflow?.graph?.nodes;
  if (dsl?.kind !== 'app' || dsl?.app?.mode !== 'advanced-chat' || !Array.isArray(nodes)) {
    throw new Error('Expected a Dify Chatflow DSL with app.mode advanced-chat and workflow.graph.nodes.');
  }
  if (!nodes.some((node) => node.data?.type === 'answer') || nodes.some((node) => node.data?.type === 'end')) {
    throw new Error('A Dify Chatflow must terminate with an answer node and cannot contain an end node.');
  }
  return dsl;
}

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function toolError(error) {
  return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
}

const server = new McpServer({ name: 'smart-cabin-dify-workflows', version: '1.0.0' });

server.registerTool('get_workflow', {
  description: 'Read a Dify Cloud workflow draft. Returns its current hash and graph summary.',
  inputSchema: { app_id: z.string().uuid() },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ app_id }) => {
  try {
    const draft = await getDraft(app_id);
    return toolResult({
      app_id,
      hash: draft.hash,
      version: draft.version,
      updated_at: draft.updated_at,
      features: draft.features,
      environment_variables: draft.environment_variables,
      conversation_variables: draft.conversation_variables,
      nodes: (draft.graph?.nodes || []).map(({ id, data }) => ({ id, type: data?.type, title: data?.title })),
      graph: draft.graph,
    });
  } catch (error) { return toolError(error); }
});

server.registerTool('preview_workflow_update', {
  description: 'Compare a local workflow DSL graph with a Dify Cloud draft. Does not save changes.',
  inputSchema: { app_id: z.string().uuid(), dsl_yaml: z.string() },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ app_id, dsl_yaml }) => {
  try {
    requireAppAccess(app_id);
    const dsl = readDsl(dsl_yaml);
    const draft = await getDraft(app_id);
    const nextNodes = dsl.workflow.graph.nodes || [];
    const currentNodes = draft.graph?.nodes || [];
    const summarize = (nodes) => nodes.map(({ id, data }) => `${id}:${data?.type}:${data?.title || ''}`);
    return toolResult({
      app_id,
      app_name_from_dsl: dsl.app.name,
      current_hash: draft.hash,
      current_node_count: currentNodes.length,
      proposed_node_count: nextNodes.length,
      current_nodes: summarize(currentNodes),
      proposed_nodes: summarize(nextNodes),
      note: 'A subsequent update requires this exact current_hash and confirmation_app_id equal to app_id. Features and variables will be preserved from the cloud draft.',
    });
  } catch (error) { return toolError(error); }
});

server.registerTool('update_workflow', {
  description: 'Replace only the graph of an existing Dify Cloud workflow draft from DSL. Requires the hash returned by get_workflow/preview_workflow_update and confirmation_app_id equal to the target app ID. Does not publish.',
  inputSchema: {
    app_id: z.string().uuid(),
    dsl_yaml: z.string(),
    expected_hash: z.string().min(1),
    confirmation_app_id: z.string().uuid(),
  },
  annotations: { destructiveHint: true, openWorldHint: false },
}, async ({ app_id, dsl_yaml, expected_hash, confirmation_app_id }) => {
  try {
    requireAppAccess(app_id);
    if (confirmation_app_id !== app_id) throw new Error('confirmation_app_id must exactly match app_id.');
    const dsl = readDsl(dsl_yaml);
    const current = await getDraft(app_id);
    if (current.hash !== expected_hash) throw new Error('Draft changed since preview; read it again before updating.');
    const body = {
      graph: dsl.workflow.graph,
      features: current.features,
      hash: current.hash,
      conversation_variables: current.conversation_variables || [],
    };
    const result = await requestConsoleJson(`/apps/${app_id}/workflows/draft`, { method: 'POST', body });
    return toolResult({ app_id, result: result.result, hash: result.hash, updated_at: result.updated_at, published: false });
  } catch (error) { return toolError(error); }
});

server.registerTool('preview_chatflow_replace', {
  description: 'Preview replacing an existing Dify Chatflow app from advanced-chat DSL. Does not save changes.',
  inputSchema: { app_id: z.string().uuid(), dsl_yaml: z.string() },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async ({ app_id, dsl_yaml }) => {
  try {
    requireAppAccess(app_id);
    const dsl = readChatflowDsl(dsl_yaml);
    const current = await getDraft(app_id);
    const summarize = (nodes) => nodes.map(({ id, data }) => `${id}:${data?.type}:${data?.title || ''}`);
    return toolResult({
      app_id,
      app_name_from_dsl: dsl.app.name,
      app_mode: dsl.app.mode,
      current_hash: current.hash,
      current_node_count: current.graph?.nodes?.length || 0,
      proposed_node_count: dsl.workflow.graph.nodes.length,
      current_nodes: summarize(current.graph?.nodes || []),
      proposed_nodes: summarize(dsl.workflow.graph.nodes),
      memory_nodes: dsl.workflow.graph.nodes.filter((node) => node.data?.memory?.window).map((node) => ({
        id: node.id,
        window_enabled: node.data.memory.window.enabled,
        window_size: node.data.memory.window.size,
      })),
      note: 'Replacement uses Dify app import with this exact app_id and current_hash; it does not publish. App name/mode and draft graph will be replaced.',
    });
  } catch (error) { return toolError(error); }
});

server.registerTool('replace_chatflow', {
  description: 'Replace an existing Dify Cloud Chatflow app from advanced-chat DSL, preserving its app ID. Requires current hash and exact app ID confirmation. Does not publish.',
  inputSchema: {
    app_id: z.string().uuid(),
    dsl_yaml: z.string(),
    expected_hash: z.string().min(1),
    confirmation_app_id: z.string().uuid(),
  },
  annotations: { destructiveHint: true, openWorldHint: false },
}, async ({ app_id, dsl_yaml, expected_hash, confirmation_app_id }) => {
  try {
    requireAppAccess(app_id);
    if (confirmation_app_id !== app_id) throw new Error('confirmation_app_id must exactly match app_id.');
    const dsl = readChatflowDsl(dsl_yaml);
    const current = await getDraft(app_id);
    if (current.hash !== expected_hash) throw new Error('Chatflow draft changed since preview; read it again before replacing.');
    const result = await requestConsoleJson(`/apps/${app_id}/workflows/draft`, {
      method: 'POST',
      body: {
        graph: dsl.workflow.graph,
        features: dsl.workflow.features,
        conversation_variables: dsl.workflow.conversation_variables || [],
        hash: current.hash,
      },
    });
    return toolResult({
      app_id,
      hash: result.hash,
      updated_at: result.updated_at,
      published: false,
    });
  } catch (error) { return toolError(error); }
});

server.registerTool('create_workflow', {
  description: 'Create a Dify Cloud workflow by importing DSL. Requires confirmation_name exactly equal to the DSL app name.',
  inputSchema: { dsl_yaml: z.string(), confirmation_name: z.string().min(1) },
  annotations: { destructiveHint: true, openWorldHint: false },
}, async ({ dsl_yaml, confirmation_name }) => {
  try {
    const dsl = readDsl(dsl_yaml);
    if (confirmation_name !== dsl.app.name) throw new Error('confirmation_name must exactly match the DSL app name.');
    const result = await requestConsoleJson('/apps/imports', {
      method: 'POST', body: { mode: 'yaml-content', yaml_content: dsl_yaml },
    });
    if (result.app_id) allowedAppIds.add(result.app_id);
    return toolResult({ app_id: result.app_id, app_mode: result.app_mode, status: result.status, warnings: result.warnings || [] });
  } catch (error) { return toolError(error); }
});

server.registerTool('run_workflow', {
  description: 'Run a published Dify Cloud workflow using the app API key mapped to app_id in DIFY_WORKFLOW_API_KEYS.',
  inputSchema: { app_id: z.string().uuid(), inputs: z.record(z.string(), z.unknown()), user: z.string().default('codex-mcp') },
  annotations: { openWorldHint: false },
}, async ({ app_id, inputs, user }) => {
  try {
    requireAppAccess(app_id);
    const apiKey = appApiKeys[app_id];
    if (typeof apiKey !== 'string' || !apiKey) throw new Error(`No run API key configured for app ${app_id}.`);
    const result = await requestJson(`${assertCloudBaseUrl()}/v1/workflows/run`, {
      token: apiKey, method: 'POST', body: { inputs, response_mode: 'blocking', user },
    });
    return toolResult(result);
  } catch (error) { return toolError(error); }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await server.connect(new StdioServerTransport());
}
