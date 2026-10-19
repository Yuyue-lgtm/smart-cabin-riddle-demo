import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { patchDialogueReliability } from './lib/dialogue-reliability.mjs';

const connector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.resolve(connector, '../../tmp/dify-import/dialogue-reliability');
const manifestPath = path.join(folder, 'release.json');
const candidatePath = path.join(folder, 'candidate.yml');
const appId = '74bef8bd-22bd-4e19-91da-5e8d645dd8ed';
const mode = process.argv[2] || 'prepare';
assert.ok(['prepare', 'save', 'publish', 'status'].includes(mode));
const client = new Client({ name: 'dialogue-reliability-update', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.join(connector, 'src/index.mjs')], stderr: 'pipe' });
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find(item => item.type === 'text')?.text || '';
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

await client.connect(transport);
try {
  const current = await call('get_workflow', { app_id: appId });
  if (mode === 'prepare') {
    const candidate = YAML.parse(fs.readFileSync(path.join(connector, 'workflows/parallel/host-dialogue-v4.yml'), 'utf8'));
    candidate.workflow.graph = patchDialogueReliability(current.graph);
    candidate.workflow.features = current.features;
    candidate.workflow.conversation_variables = current.conversation_variables;
    candidate.workflow.environment_variables = current.environment_variables;
    fs.mkdirSync(folder, { recursive: true });
    save(path.join(folder, 'before.json'), current);
    save(path.join(folder, `before-${current.hash}.json`), current);
    fs.writeFileSync(candidatePath, YAML.stringify(candidate, { lineWidth: 120 }), { mode: 0o600 });
    const before = new Map(current.graph.nodes.map(node => [node.id, node.data]));
    const changed = candidate.workflow.graph.nodes.filter(node => JSON.stringify(before.get(node.id)) !== JSON.stringify(node.data))
      .map(node => ({ id: node.id, title: node.data.title, added: !before.has(node.id) }));
    const manifest = { app_id: appId, expected_hash: current.hash, changed_nodes: changed };
    save(manifestPath, manifest);
    console.log(JSON.stringify(manifest, null, 2));
  } else if (mode === 'status') {
    console.log(JSON.stringify({ app_id: appId, hash: current.hash }));
  } else {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.app_id, appId);
    assert.equal(current.hash, mode === 'save' ? manifest.expected_hash : manifest.saved_hash,
      'Cloud draft changed; review it again before saving or publishing.');
    if (mode === 'save') {
      const dsl = fs.readFileSync(candidatePath, 'utf8');
      const candidate = YAML.parse(dsl);
      await call('replace_chatflow', { app_id: appId, confirmation_app_id: appId,
        expected_hash: current.hash, dsl_yaml: dsl });
      const verified = await call('get_workflow', { app_id: appId });
      assert.deepEqual(verified.graph.nodes.map(node => ({ id: node.id, data: node.data })),
        candidate.workflow.graph.nodes.map(node => ({ id: node.id, data: node.data })));
      assert.deepEqual(verified.graph.edges, candidate.workflow.graph.edges);
      assert.deepEqual(verified.features, current.features);
      assert.deepEqual(verified.conversation_variables, current.conversation_variables);
      manifest.saved_hash = verified.hash;
      save(manifestPath, manifest);
      console.log(JSON.stringify({ saved: true, hash: verified.hash, published: false }));
    } else {
      const report = JSON.parse(fs.readFileSync(path.join(folder, 'verification.json'), 'utf8'));
      assert.equal(report.hash, current.hash, 'Verification must match the exact draft being published.');
      assert.equal(report.passed, true);
      const env = dotenv.parse(fs.readFileSync(path.join(connector, '.env'), 'utf8'));
      const proxy = env.DIFY_PROXY_URL ?? 'http://127.0.0.1:7897';
      if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));
      const endpoint = `https://cloud.dify.ai/console/api/apps/${appId}/workflows/publish`;
      const headers = { Authorization: `Bearer ${env.DIFY_CONSOLE_TOKEN}`, 'X-CSRF-Token': env.DIFY_CSRF_TOKEN,
        Cookie: `${env.DIFY_CSRF_COOKIE_NAME || 'csrf_token'}=${env.DIFY_CSRF_TOKEN}`, 'Content-Type': 'application/json' };
      const previous = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) });
      assert.equal(previous.ok, true, 'Could not back up the published workflow.');
      const previousPublished = await previous.json();
      save(path.join(folder, `published-before-${previousPublished.hash}.json`), previousPublished);
      const response = await fetch(endpoint, { method: 'POST', headers, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ marked_name: 'Host reliability',
          marked_comment: 'Low effort, structured JSON, one retry; keep safety guards.' }) });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(`Publish failed: HTTP ${response.status}; ${JSON.stringify(detail).slice(0, 1200)}`);
      }
      const published = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) }).then(r => r.json());
      assert.equal(published.hash, current.hash);
      manifest.published_hash = published.hash;
      manifest.published_at = new Date().toISOString();
      save(manifestPath, manifest);
      console.log(JSON.stringify({ published: true, hash: published.hash, version: published.version }));
    }
  }
} finally {
  await client.close();
}
