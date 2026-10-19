import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import YAML from 'yaml';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const connector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(connector, '../..');
const appId = 'bc1ce5be-d5c5-4885-84c5-72c2c1f63d18';
const environmentUpdate = process.argv.includes('--environment');
const folder = path.join(root, 'tmp/dify-import', environmentUpdate ? 'environment' : 'participation');
const candidatePath = path.join(folder, 'situation-candidate.yml');
const manifestPath = path.join(folder, 'release.json');
const mode = process.argv[2] || 'prepare';
if (!['prepare', 'save', 'publish', 'status'].includes(mode)) throw new Error('Use prepare, save, publish or status.');
const client = new Client({ name: 'situation-participation-update', version: '1.0.0' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath, args: [path.join(connector, 'src/index.mjs')], stderr: 'pipe',
});

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.find(item => item.type === 'text')?.text || '';
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

function saveManifest(manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
}

await client.connect(transport);
try {
  const current = await call('get_workflow', { app_id: appId });
  if (mode === 'status') {
    console.log(JSON.stringify({ app_id: appId, hash: current.hash }));
  } else if (mode === 'prepare') {
    const generated = YAML.parse(fs.readFileSync(path.join(connector, 'workflows/parallel/cabin-situation-v1.yml'), 'utf8'));
    const candidate = structuredClone(generated);
    candidate.workflow.graph = structuredClone(current.graph);
    const changed = [];
    for (const id of (environmentUpdate ? ['3000000000002', '3000000000014'] : ['3000000000002', '3000000000008', '3000000000014'])) {
      const target = candidate.workflow.graph.nodes.find(node => node.id === id);
      const source = generated.workflow.graph.nodes.find(node => node.id === id);
      assert.equal(target?.data?.type, 'code', id);
      assert.deepEqual(target.data.variables, source.data.variables, `${id}: input bindings changed`);
      if (environmentUpdate && id === '3000000000002') {
        assert.deepEqual(Object.fromEntries(Object.entries(target.data.outputs).filter(([key]) => key !== 'environment_fast_path')),
          Object.fromEntries(Object.entries(source.data.outputs).filter(([key]) => key !== 'environment_fast_path')));
        target.data.outputs = source.data.outputs;
      } else assert.deepEqual(target.data.outputs, source.data.outputs, `${id}: output bindings changed`);
      target.data.code = source.data.code;
      target.data.desc = source.data.desc;
      changed.push(id);
    }
    for (const id of (environmentUpdate ? ['3000000000013'] : ['3000000000007', '3000000000013'])) {
      const target = candidate.workflow.graph.nodes.find(node => node.id === id);
      const source = generated.workflow.graph.nodes.find(node => node.id === id);
      assert.equal(target?.data?.type, 'llm', id);
      const prompt = target.data.prompt_template.find(item => item.role === 'system');
      assert.ok(prompt, `${id}: missing system prompt`);
      prompt.text = source.data.prompt_template.find(item => item.role === 'system').text;
      changed.push(id);
    }
    const note = candidate.workflow.graph.nodes.find(node => node.id === 'scene-note-2');
    note.data.text = generated.workflow.graph.nodes.find(node => node.id === note.id).data.text;
    changed.push(note.id);
    if (environmentUpdate) {
      for (const id of ['3000000000020', '3000000000021']) {
        const existing = candidate.workflow.graph.nodes.find(node => node.id === id);
        const replacement = generated.workflow.graph.nodes.find(node => node.id === id);
        if (existing) {
          assert.equal(existing.data.type, replacement.data.type);
          if (existing.data.type === 'code') existing.data.code = replacement.data.code;
        } else candidate.workflow.graph.nodes.push(structuredClone(replacement));
        changed.push(id);
      }
      const aggregator = candidate.workflow.graph.nodes.find(node => node.id === '3000000000012');
      if (!aggregator.data.variables.some(selector => selector[0] === '3000000000021')) aggregator.data.variables.push(['3000000000021', 'director_context']);
      changed.push(aggregator.id);
      const oldEdge = candidate.workflow.graph.edges.find(edge => edge.source === '3000000000005' && edge.sourceHandle === 'analyze');
      if (oldEdge.target !== '3000000000020') {
        assert.equal(oldEdge.target, '3000000000007');
        candidate.workflow.graph.edges = candidate.workflow.graph.edges.filter(edge => edge !== oldEdge);
        for (const edge of generated.workflow.graph.edges.filter(edge => ['3000000000020', '3000000000021'].includes(edge.source)
          || edge.target === '3000000000020')) candidate.workflow.graph.edges.push(structuredClone(edge));
      }
    }
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'before.json'), JSON.stringify(current, null, 2), { mode: 0o600 });
    fs.writeFileSync(candidatePath, YAML.stringify(candidate, { lineWidth: 120 }));
    const manifest = { app_id: appId, expected_hash: current.hash, changed_nodes: changed, candidate: candidatePath };
    saveManifest(manifest);
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.app_id, appId);
    const expected = mode === 'save' ? manifest.expected_hash : manifest.saved_hash;
    assert.ok(expected, 'Prepare/save the candidate before this operation.');
    assert.equal(current.hash, expected, 'Cloud draft changed; prepare and review it again.');
    const yaml = fs.readFileSync(candidatePath, 'utf8');
    const candidate = YAML.parse(yaml);
    if (mode === 'save') {
      await call('update_workflow', { app_id: appId, confirmation_app_id: appId,
        expected_hash: expected, dsl_yaml: yaml });
      const verified = await call('get_workflow', { app_id: appId });
      assert.deepEqual(verified.graph.nodes.map(node => ({ id: node.id, data: node.data })),
        candidate.workflow.graph.nodes.map(node => ({ id: node.id, data: node.data })), 'Saved node data differs.');
      assert.deepEqual(verified.features, current.features);
      assert.deepEqual(verified.graph.edges, candidate.workflow.graph.edges);
      manifest.saved_hash = verified.hash;
      manifest.saved_at = new Date().toISOString();
      saveManifest(manifest);
      console.log(JSON.stringify({ app_id: appId, saved_hash: verified.hash, published: false }));
    } else {
      const env = dotenv.parse(fs.readFileSync(path.join(connector, '.env'), 'utf8'));
      assert.ok((env.DIFY_ALLOWED_APP_IDS || '').split(',').map(id => id.trim()).includes(appId));
      const proxy = env.DIFY_PROXY_URL ?? 'http://127.0.0.1:7897';
      if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));
      const response = await fetch(`https://cloud.dify.ai/console/api/apps/${appId}/workflows/publish`, {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${env.DIFY_CONSOLE_TOKEN}`, 'X-CSRF-Token': env.DIFY_CSRF_TOKEN,
          Cookie: `${env.DIFY_CSRF_COOKIE_NAME || 'csrf_token'}=${env.DIFY_CSRF_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ marked_name: environmentUpdate ? 'Environment P1' : 'Passenger invite',
          marked_comment: environmentUpdate ? 'One-model environment announcements with deterministic P1 delivery.'
            : 'Replace fixed front-seat cues with guarded situation analysis.' }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Publish failed: HTTP ${response.status}; ${detail.slice(0, 800)}`);
      }
      const published = await response.json();
      manifest.published_hash = current.hash;
      manifest.published_at = new Date().toISOString();
      saveManifest(manifest);
      console.log(JSON.stringify({ app_id: appId, published: true, hash: current.hash,
        created_at: published.created_at || null }));
    }
  }
} finally {
  await client.close();
}
