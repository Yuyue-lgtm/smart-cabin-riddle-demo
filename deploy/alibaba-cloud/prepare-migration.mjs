import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import YAML from '../../tools/dify-workflow-mcp/node_modules/yaml/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = path.join(root, 'tmp/alibaba-cloud/migrations', new Date().toISOString().replace(/[:.]/g, '-'));
const definitions = [
  { kind: 'host', id: '74bef8bd-22bd-4e19-91da-5e8d645dd8ed', file: 'parallel/host-dialogue-v4.yml' },
  { kind: 'situation', id: 'bc1ce5be-d5c5-4885-84c5-72c2c1f63d18', file: 'parallel/cabin-situation-v1.yml' },
  { kind: 'preview', id: 'bf81cd44-a49f-4048-901f-e95e941dc429', file: 'preview/question-preview-v1.yml' },
];
const { requestConsoleJson: request } = await import('../../tools/dify-workflow-mcp/src/index.mjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const save = (name, content) => fs.writeFileSync(path.join(folder, name), content, { mode: 0o600 });
const manifest = { created_at: new Date().toISOString(), source: 'Dify Cloud published',
  target_version_reported_by_owner: '1.17.1', apps: [], knowledge: [], secrets_exported: false, target_modified: false };
const datasets = new Set();
for (const definition of definitions) {
  const base = `/apps/${definition.id}`;
  const published = await request(`${base}/workflows/publish`);
  const draft = await request(`${base}/workflows/draft`);
  if (draft.hash !== published.hash) throw new Error(`${definition.kind}: draft differs from published; review before migration.`);
  const exported = await request(`${base}/export?include_secret=false`);
  const dsl = YAML.parse(exported.data);
  let restoredReferences = 0;
  for (const node of dsl.workflow.graph.nodes.filter(node => node.data.type === 'knowledge-retrieval')) {
    const original = published.graph.nodes.find(item => item.id === node.id && item.data.type === node.data.type);
    if (!original) throw new Error(`${definition.kind}: retrieval node changed.`);
    // Cloud exports encrypt dataset references with a Cloud-only key. Use verified published IDs in the backup.
    if (!isDeepStrictEqual(node.data.dataset_ids, original.data.dataset_ids)) restoredReferences++;
    node.data.dataset_ids = structuredClone(original.data.dataset_ids);
  }
  if (!isDeepStrictEqual(dsl.workflow.graph, published.graph)) throw new Error(`${definition.kind}: export differs beyond dataset reference encoding.`);
  const privateVariables = [];
  for (const variable of dsl.workflow.environment_variables || []) {
    if (variable.value_type === 'secret') { privateVariables.push(variable.name); variable.value = ''; }
  }
  save(`${definition.kind}.source.yml`, YAML.stringify(dsl, { lineWidth: 120 }));
  const local = YAML.parse(fs.readFileSync(path.join(root, 'tools/dify-workflow-mcp/workflows', definition.file), 'utf8'));
  const nodes = dsl.workflow.graph.nodes;
  for (const node of nodes.filter(node => node.data.type === 'knowledge-retrieval')) {
    for (const id of node.data.dataset_ids || []) datasets.add(id);
  }
  const retrievalNodes = nodes.filter(node => node.data.type === 'knowledge-retrieval').map(node => ({
    node_id: node.id, dataset_ids: structuredClone(node.data.dataset_ids) }));
  const importDsl = structuredClone(dsl);
  for (const node of importDsl.workflow.graph.nodes.filter(node => node.data.type === 'knowledge-retrieval')) {
    node.data.dataset_ids = [];
  }
  const text = YAML.stringify(importDsl, { lineWidth: 120 });
  const name = `${definition.kind}.import.yml`;
  save(name, text);
  manifest.apps.push({ kind: definition.kind, cloud_app_id: definition.id, published_hash: published.hash,
    draft_matches_published: true, local_graph_matches_published: isDeepStrictEqual(local.workflow.graph, published.graph),
    file: name, source_file: `${definition.kind}.source.yml`, sha256: sha256(text), node_count: nodes.length,
    dependencies: dsl.dependencies, cloud_encoded_references_restored: restoredReferences,
    models: nodes.filter(node => node.data.model).map(node => ({ node_id: node.id, title: node.data.title,
      provider: node.data.model.provider, name: node.data.model.name, parameters: node.data.model.completion_params })),
    retrieval_nodes: retrievalNodes, requires_dataset_binding_before_publish: retrievalNodes.length > 0,
    private_variables_to_supply: privateVariables,
  });
}
const localRows = fs.readFileSync(path.join(root, 'docs/主持经验库-v1.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
for (const id of datasets) {
  const dataset = await request(`/datasets/${id}`);
  const documents = await request(`/datasets/${id}/documents?page=1&limit=100`);
  if (documents.data.length !== 1) throw new Error('Knowledge source document count changed; inspect before export.');
  const document = documents.data[0];
  const segments = await request(`/datasets/${id}/documents/${document.id}/segments?page=1&limit=100`);
  if (segments.has_more || document.indexing_status !== 'completed'
    || !segments.data.every(segment => segment.enabled && segment.status === 'completed')) {
    throw new Error('Knowledge source is not fully indexed or exceeds the audited page.');
  }
  const rows = segments.data.map(segment => JSON.parse(segment.content));
  if (rows.length !== 28 || new Set(rows.map(row => row.knowhow_id)).size !== rows.length) {
    throw new Error('Expected 28 complete and unique host experience records; inspect source change.');
  }
  const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  save('knowhow-source.jsonl', jsonl);
  save('knowhow-source.md', rows.map(row => JSON.stringify(row)).join('\n\n') + '\n');
  manifest.knowledge.push({ cloud_dataset_id: id, cloud_document_id: document.id,
    indexing_technique: dataset.indexing_technique, recorded_embedding_provider: dataset.embedding_model_provider,
    recorded_embedding_model: dataset.embedding_model, segmentation: document.process_rule_dict?.rules?.segmentation,
    total: rows.length, all_enabled_and_completed: true, jsonl_sha256: sha256(jsonl),
    local_differences: rows.flatMap(row => {
      const local = localRows.find(item => item.knowhow_id === row.knowhow_id);
      return isDeepStrictEqual(row, local) ? [] : [{ id: row.knowhow_id, source_version: row.version,
        local_version: local?.version, fields: [...new Set([...Object.keys(row), ...Object.keys(local || {})])]
          .filter(key => !isDeepStrictEqual(row[key], local?.[key])) }];
    }),
    migration_action: 'Create new economy dataset, import complete segments, rebind both retrieval nodes to its new ID.',
  });
}
save('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ folder: path.relative(root, folder), ...manifest }, null, 2));
