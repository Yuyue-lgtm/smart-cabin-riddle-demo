import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { requestConsoleJson as request } from '../src/index.mjs';
import { patchStructuredReliability } from './lib/structured-reliability.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const folder = path.join(root, 'tmp/dify-import/structured-reliability-v2');
export const apps = {
  dialogue: '74bef8bd-22bd-4e19-91da-5e8d645dd8ed',
  situation: 'bc1ce5be-d5c5-4885-84c5-72c2c1f63d18',
  preview: 'bf81cd44-a49f-4048-901f-e95e941dc429',
};
export const save = (name, data) => fs.writeFileSync(path.join(folder, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
export const load = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));

export async function saveGraph(kind, graph, expectedHash) {
  const base = `/apps/${apps[kind]}/workflows`;
  const current = await request(`${base}/draft`);
  assert.equal(current.hash, expectedHash, `${kind}: draft changed; review before overwriting`);
  await request(`${base}/draft`, { method: 'POST', body: {
    graph, features: current.features, conversation_variables: current.conversation_variables || [], hash: current.hash,
  } });
  const updated = await request(`${base}/draft`);
  assert.deepEqual(updated.graph, graph);
  for (const key of ['features', 'conversation_variables', 'environment_variables']) {
    assert.deepEqual(updated[key], current[key], `${kind}: changed ${key}`);
  }
  return updated;
}

async function main() {
  const mode = process.argv[2] || 'status';
  assert.ok(['status', 'prepare', 'save', 'publish', 'sync-local'].includes(mode));
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  for (const [kind, id] of Object.entries(apps)) {
    const current = await request(`/apps/${id}/workflows/draft`);
    const published = await request(`/apps/${id}/workflows/publish`);
    if (mode === 'status') {
      console.log(JSON.stringify({ kind, draft_hash: current.hash, published_hash: published.hash }));
      continue;
    }
    if (mode === 'prepare') {
      const candidate = { ...current, graph: patchStructuredReliability(current.graph, kind) };
      if (!fs.existsSync(path.join(folder, `${kind}-before.json`))) save(`${kind}-before.json`, { draft: current, published });
      save(`${kind}-before-${current.hash}.json`, { draft: current, published });
      save(`${kind}-candidate.json`, candidate);
      const changed = candidate.graph.nodes.filter(node => JSON.stringify(node) !== JSON.stringify(current.graph.nodes.find(row => row.id === node.id)))
        .map(node => ({ id: node.id, title: node.data.title }));
      const release = { app_id: id, expected_hash: current.hash, previous_published_hash: published.hash, changed_nodes: changed };
      save(`${kind}-release.json`, release);
      console.log(JSON.stringify({ kind, ...release }));
    } else {
      const release = load(`${kind}-release.json`);
      assert.equal(current.hash, mode === 'save' ? release.expected_hash : release.saved_hash, `${kind}: draft changed`);
      if (mode === 'save') {
        const updated = await saveGraph(kind, load(`${kind}-candidate.json`).graph, current.hash);
        release.saved_hash = updated.hash;
        save(`${kind}-release.json`, release);
        console.log(JSON.stringify({ kind, saved_hash: updated.hash, published: false }));
      } else if (mode === 'publish') {
        const report = load('verification.json');
        assert.equal(report.passed, true);
        assert.equal(report.hashes[kind], current.hash, `${kind}: verification does not match current draft`);
        await request(`/apps/${id}/workflows/publish`, { method: 'POST', body: {
          marked_name: '结构化回复可靠性修复',
          marked_comment: '主模型低强度思考、重试非思考；分离推理，最终文本校验Schema与业务守卫；修复参与事件白名单；原失败输入及多场景/重试/安全回归通过。',
        } });
        const verified = await request(`/apps/${id}/workflows/publish`);
        assert.equal(verified.hash, current.hash);
        release.published_hash = verified.hash;
        release.published_at = new Date().toISOString();
        save(`${kind}-release.json`, release);
        console.log(JSON.stringify({ kind, published_hash: verified.hash }));
      } else {
        assert.equal(published.hash, release.published_hash);
        const local = kind === 'preview' ? path.join(root, 'tools/dify-workflow-mcp/workflows/preview/question-preview-v1.yml')
          : path.join(root, `tools/dify-workflow-mcp/workflows/parallel/${kind === 'dialogue' ? 'host-dialogue-v4' : 'cabin-situation-v1'}.yml`);
        const dsl = YAML.parse(fs.readFileSync(kind === 'preview'
          ? path.join(root, 'tools/dify-workflow-mcp/workflows/parallel/cabin-situation-v1.yml') : local, 'utf8'));
        if (kind === 'preview') dsl.app = { ...dsl.app, name: '提问预演', mode: 'workflow', description: '每题乘客提问链及一次安全前缀修复。' };
        for (const key of ['graph', 'features', 'environment_variables', 'conversation_variables']) {
          if (published[key] !== undefined) dsl.workflow[key] = published[key];
        }
        fs.writeFileSync(local, YAML.stringify(dsl, { lineWidth: 120 }), { mode: 0o600 });
        console.log(JSON.stringify({ kind, synced: true, hash: published.hash }));
      }
    }
  }
  if (mode === 'sync-local') {
    const file = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel/cloud-apps.json');
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...current, preview_app_id: apps.preview, published: true,
      published_hashes: Object.fromEntries(Object.keys(apps).map(kind => [kind, load(`${kind}-release.json`).published_hash])),
      checked_at: new Date().toISOString() }, null, 2) + '\n');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
