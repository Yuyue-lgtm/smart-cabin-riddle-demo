import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { requestConsoleJson as request } from '../src/index.mjs';
import { patchInput, patchDialogueGuard, patchKnowhowCodeNodes, addFeedbackRoute } from './lib/host-experiences.mjs';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'tools/dify-workflow-mcp/workflows/host/src');
const folder = path.join(root, 'tmp/dify-import/host-experiences');
const apps = { situation: 'bc1ce5be-d5c5-4885-84c5-72c2c1f63d18', dialogue: '74bef8bd-22bd-4e19-91da-5e8d645dd8ed' };
const mode = process.argv[2] || 'prepare';
const read = name => fs.readFileSync(path.join(source, name), 'utf8').trim();
const save = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
fs.mkdirSync(folder, { recursive: true });

if (mode === 'knowledge-file' || mode === 'knowledge-status') {
  const current = await request(`/apps/${apps.situation}/workflows/draft`);
  const datasetId = current.graph.nodes.find(node => node.data.type === 'knowledge-retrieval').data.dataset_ids[0];
  const documents = await request(`/datasets/${datasetId}/documents?page=1&limit=100`);
  const document = documents.data.find(row => row.name === '主持经验库-v1.md');
  assert.ok(document);
  if (mode === 'knowledge-file') {
    save('knowledge-document-before.json', document);
    const dataset = await request(`/datasets/${datasetId}`);
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.join(root, 'docs/主持经验库-v1.md'))], { type: 'text/markdown' }), '主持经验库-v1.md');
    form.append('source', 'datasets');
    const upload = await request('/files/upload?source=datasets', { method: 'POST', form });
    assert.ok(upload.id);
    const result = await request(`/datasets/${datasetId}/documents`, { method: 'POST', body: {
      original_document_id: document.id, indexing_technique: dataset.indexing_technique,
      data_source: { info_list: { data_source_type: 'upload_file', file_info_list: { file_ids: [upload.id] } } },
      process_rule: { mode: 'custom', rules: { ...document.process_rule_dict.rules,
        segmentation: { separator: '\n\n', max_tokens: 1024, chunk_overlap: 0 } } },
      doc_form: 'text_model', doc_language: 'Chinese',
    } });
    save('knowledge-reindex.json', result);
    console.log(JSON.stringify({ uploaded_file_id: upload.id, document_id: document.id, reindex_requested: true }));
  } else {
    const segments = await request(`/datasets/${datasetId}/documents/${document.id}/segments?page=1&limit=100`);
    const rows = segments.data.map(row => ({ id: JSON.parse(row.content).knowhow_id, status: row.status, enabled: row.enabled }));
    const expectedCount = fs.readFileSync(path.join(root, 'docs/主持经验库-v1.jsonl'), 'utf8').trim().split(/\r?\n/).length;
    const report = { dataset_id: datasetId, document_id: document.id, indexing_status: document.indexing_status, total: rows.length,
      checked_at: new Date().toISOString(), statuses: rows,
      expected_count: expectedCount,
      ready: rows.length === expectedCount && new Set(rows.map(row => row.id)).size === expectedCount && rows.every(row => row.status === 'completed' && row.enabled) };
    save('knowledge-release.json', report); console.log(JSON.stringify(report));
  }
} else if (mode === 'knowledge') {
  const current = await request(`/apps/${apps.situation}/workflows/draft`);
  const datasetId = current.graph.nodes.find(node => node.data.type === 'knowledge-retrieval').data.dataset_ids[0];
  const documents = await request(`/datasets/${datasetId}/documents?page=1&limit=100`);
  const document = documents.data.find(row => row.name === '主持经验库-v1.md');
  assert.ok(document, 'Existing host experience document not found.');
  const prefix = `/datasets/${datasetId}/documents/${document.id}`;
  const before = await request(`${prefix}/segments?page=1&limit=100`);
  save('knowledge-before.json', before);
  const rows = fs.readFileSync(path.join(root, 'docs/主持经验库-v1.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const changed = [];
  const onlyIds = process.argv.find(arg => arg.startsWith('--ids='))?.slice(6).split(',');
  for (const row of rows) {
    if (onlyIds && !onlyIds.includes(row.knowhow_id)) continue;
    const existing = before.data.find(segment => { try { return JSON.parse(segment.content).knowhow_id === row.knowhow_id; } catch { return false; } });
    if (existing && JSON.stringify(JSON.parse(existing.content)) === JSON.stringify(row)) continue;
    const result = await request(existing ? `${prefix}/segments/${existing.id}` : `${prefix}/segment`, {
      method: existing ? 'PATCH' : 'POST', body: { content: JSON.stringify(row), keywords: [row.knowhow_id, row.title] },
    });
    changed.push({ knowhow_id: row.knowhow_id, segment_id: result.data?.id, created: !existing });
  }
  const after = await request(`${prefix}/segments?page=1&limit=100`);
  const ids = after.data.map(row => JSON.parse(row.content).knowhow_id);
  assert.equal(new Set(ids).size, rows.length);
  assert.ok(rows.every(row => ids.includes(row.knowhow_id)));
  const report = { dataset_id: datasetId, document_id: document.id, total: ids.length, changed, checked_at: new Date().toISOString(),
    statuses: after.data.map(row => ({ id: JSON.parse(row.content).knowhow_id, status: row.status, enabled: row.enabled })) };
  save('knowledge-release.json', report);
  console.log(JSON.stringify(report));
} else if (mode === 'sync-local') {
  for (const [kind, id] of Object.entries(apps)) {
    const published = await request(`/apps/${id}/workflows/publish`);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, `${kind}-release.json`)));
    assert.equal(published.hash, manifest.published_hash);
    const name = kind === 'dialogue' ? 'host-dialogue-v4.yml' : 'cabin-situation-v1.yml';
    const target = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel', name);
    const dsl = YAML.parse(fs.readFileSync(target, 'utf8'));
    for (const key of ['graph', 'features', 'environment_variables', 'conversation_variables']) {
      if (published[key] !== undefined) dsl.workflow[key] = published[key];
    }
    fs.writeFileSync(target, YAML.stringify(dsl, { lineWidth: 120 }));
    console.log(JSON.stringify({ synced: name, published_hash: published.hash }));
  }
} else {
  assert.ok(['prepare', 'save', 'publish', 'status'].includes(mode));
  for (const [kind, appId] of Object.entries(apps)) {
    const current = await request(`/apps/${appId}/workflows/draft`);
    if (mode === 'status') { console.log(JSON.stringify({ kind, hash: current.hash })); continue; }
    if (mode === 'prepare') {
      const candidate = structuredClone(current);
      if (kind === 'situation') addFeedbackRoute(candidate.graph);
      else {
        patchInput(candidate.graph.nodes.find(node => node.id === '1000000000002'), 'dialogue');
        patchDialogueGuard(candidate.graph);
        patchKnowhowCodeNodes(candidate.graph);
        for (const node of candidate.graph.nodes.filter(node => node.data.type === 'llm')) {
          const prompt = node.data.prompt_template.find(row => row.role === 'system');
          if (!prompt.text.includes('主持偏好与连续观察：')) prompt.text += '\n\n' + read('experience-dialogue-prompt.txt');
        }
      }
      save(`${kind}-before.json`, current); save(`${kind}-candidate.json`, candidate);
      const changes = candidate.graph.nodes.filter(node => JSON.stringify(node) !== JSON.stringify(current.graph.nodes.find(row => row.id === node.id))).map(node => node.id);
      save(`${kind}-release.json`, { app_id: appId, expected_hash: current.hash, changed_nodes: changes });
      console.log(JSON.stringify({ kind, expected_hash: current.hash, changed_nodes: changes }));
    } else {
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, `${kind}-release.json`)));
      assert.equal(current.hash, mode === 'save' ? manifest.expected_hash : manifest.saved_hash, 'Cloud draft changed since review.');
      if (mode === 'save') {
        const candidate = JSON.parse(fs.readFileSync(path.join(folder, `${kind}-candidate.json`)));
        await request(`/apps/${appId}/workflows/draft`, { method: 'POST', body: {
          graph: candidate.graph, features: current.features, conversation_variables: current.conversation_variables || [], hash: current.hash,
        } });
        const verified = await request(`/apps/${appId}/workflows/draft`);
        assert.deepEqual(verified.graph.nodes.map(node => ({ id: node.id, data: node.data })), candidate.graph.nodes.map(node => ({ id: node.id, data: node.data })));
        assert.deepEqual(verified.graph.edges, candidate.graph.edges);
        assert.deepEqual(verified.features, current.features);
        manifest.saved_hash = verified.hash; save(`${kind}-release.json`, manifest);
        console.log(JSON.stringify({ kind, saved_hash: verified.hash, published: false }));
      } else {
        const validation = JSON.parse(fs.readFileSync(path.join(folder, 'verification.json')));
        assert.equal(validation.passed, true);
        assert.equal(validation.hashes[kind], current.hash, 'Verify the exact saved draft before publishing.');
        save(`${kind}-published-before.json`, await request(`/apps/${appId}/workflows/publish`));
        await request(`/apps/${appId}/workflows/publish`, { method: 'POST', body: {
          marked_name: 'Host experiences v3', marked_comment: '28 experiences including guarded low-pressure invitations for real inactive passengers.',
        } });
        const published = await request(`/apps/${appId}/workflows/publish`);
        assert.equal(published.hash, current.hash);
        manifest.published_hash = published.hash; manifest.published_at = new Date().toISOString();
        save(`${kind}-release.json`, manifest); console.log(JSON.stringify({ kind, published_hash: published.hash }));
      }
    }
  }
}
