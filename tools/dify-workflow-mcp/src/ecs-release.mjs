import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import YAML from '../node_modules/yaml/dist/index.js';

export const appKinds = ['host', 'situation', 'preview'];
export const fingerprint = value => createHash('sha256').update(JSON.stringify(sortKeys(value))).digest('hex');
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
  return value;
}

export function workflowContent(value) {
  if (!value?.graph?.nodes?.length || !value.features) throw new Error('Incomplete workflow');
  const variables = value.environment_variables || [];
  if (variables.some(variable => variable.value_type === 'secret')) {
    throw new Error('Secret workflow variables require an explicit credential migration; release stopped');
  }
  return { graph: structuredClone(value.graph), features: structuredClone(value.features),
    conversation_variables: structuredClone(value.conversation_variables || []),
    environment_variables: structuredClone(variables) };
}

export function assertSeparateProfiles(production, testing) {
  if (!production?.apps || !testing?.apps || !production.knowledge?.dataset_id || !testing.knowledge?.dataset_id) {
    throw new Error('Testing environment is not initialized; run setup first');
  }
  const all = [...Object.values(production.apps), ...Object.values(testing.apps)];
  if (appKinds.some(kind => !production.apps[kind] || !testing.apps[kind])
      || new Set(all).size !== 6 || production.knowledge.dataset_id === testing.knowledge.dataset_id) {
    throw new Error('Test and production application/knowledge IDs must be separate');
  }
}

export function remapKnowledge(workflow, from, to) {
  const next = workflowContent(workflow);
  let count = 0;
  for (const node of next.graph.nodes) {
    if (node.data.type !== 'knowledge-retrieval') continue;
    if (!Array.isArray(node.data.dataset_ids) || node.data.dataset_ids.length !== 1 || node.data.dataset_ids[0] !== from) {
      throw new Error(`Unexpected dataset binding at node ${node.id}; explicit review required`);
    }
    node.data.dataset_ids = [to]; count++;
  }
  return { workflow: next, changed_bindings: count };
}

export function describeDiff(before, after) {
  const previous = new Map(before.graph.nodes.map(node => [node.id, node]));
  const current = new Map(after.graph.nodes.map(node => [node.id, node]));
  return { changed: fingerprint(before) !== fingerprint(after),
    added_nodes: [...current.keys()].filter(id => !previous.has(id)),
    removed_nodes: [...previous.keys()].filter(id => !current.has(id)),
    changed_nodes: [...current.keys()].filter(id => previous.has(id) && !isDeepStrictEqual(previous.get(id), current.get(id))),
    edges_changed: !isDeepStrictEqual(before.graph.edges, after.graph.edges),
    features_changed: !isDeepStrictEqual(before.features, after.features),
    variables_changed: !isDeepStrictEqual(before.conversation_variables, after.conversation_variables)
      || !isDeepStrictEqual(before.environment_variables, after.environment_variables) };
}

export async function readApp(request, id) {
  const info = await request(`/apps/${id}`);
  const draft = await request(`/apps/${id}/workflows/draft`);
  const published = await request(`/apps/${id}/workflows/publish`);
  if (!published?.graph) throw new Error(`App ${id} has no published workflow`);
  const exported = await request(`/apps/${id}/export?include_secret=false&workflow_id=${published.id}`);
  const dsl = YAML.parse(exported.data);
  if (!dsl.workflow) throw new Error('Incomplete export');
  // Dify exports encrypted dataset references, while workflow reads expose verified IDs.
  for (const node of dsl.workflow.graph.nodes) {
    if (node.data.type === 'knowledge-retrieval') {
      const original = published.graph.nodes.find(item => item.id === node.id);
      node.data.dataset_ids = structuredClone(original.data.dataset_ids);
    }
  }
  if (!isDeepStrictEqual(dsl.workflow.graph, published.graph)) throw new Error('Published export graph mismatch');
  return { id, name: info.name, mode: info.mode, draft, published, dsl,
    content: workflowContent(published), draft_content: workflowContent(draft) };
}

export async function readKnowledge(request, datasetId) {
  const dataset = await request(`/datasets/${datasetId}`);
  if (dataset.indexing_technique !== 'economy') throw new Error('Only the existing economy knowledge format is supported');
  const documents = await request(`/datasets/${datasetId}/documents?page=1&limit=100`);
  if (documents.has_more || documents.data.length !== 1) throw new Error('Expected one complete knowledge document');
  const document = documents.data[0];
  if (document.indexing_status !== 'completed' || document.enabled === false || document.archived === true) {
    throw new Error('Knowledge document is not active and completely indexed');
  }
  const details = await request(`/datasets/${datasetId}/documents/${document.id}`);
  const rule = details.document_process_rule || details.dataset_process_rule || document.process_rule_dict;
  if (!rule?.mode || !rule.rules) throw new Error('Knowledge processing rules are missing; refusing to guess import settings');
  const processRule = { mode: rule.mode, rules: typeof rule.rules === 'string' ? JSON.parse(rule.rules) : rule.rules };
  const retrievalModel = dataset.retrieval_model_dict || dataset.retrieval_model;
  if (!retrievalModel?.search_method || !Number.isFinite(retrievalModel.top_k)) {
    throw new Error('Knowledge retrieval settings are missing');
  }
  const segments = [];
  for (let page = 1; ; page++) {
    const result = await request(`/datasets/${datasetId}/documents/${document.id}/segments?page=${page}&limit=100`);
    segments.push(...result.data);
    if (!result.has_more) break;
  }
  if (!segments.length || segments.some(segment => !segment.enabled || segment.status !== 'completed')) {
    throw new Error('All knowledge segments must be enabled and indexed');
  }
  const rows = segments.sort((a, b) => a.position - b.position).map(segment => JSON.parse(segment.content));
  if (new Set(rows.map(row => row.knowhow_id)).size !== rows.length || rows.some(row => !row.knowhow_id || !row.version)) {
    throw new Error('Knowledge records have missing or duplicate IDs/versions');
  }
  return { dataset_id: datasetId, document_id: document.id, rows,
    fingerprint: fingerprint(rows), revision: fingerprint({ rows, processRule, retrievalModel }),
    indexing_technique: dataset.indexing_technique, process_rule: processRule, retrieval_model: retrievalModel };
}

export async function cloneKnowledge(request, source, name, onCreated = () => {}) {
  const dataset = await request('/datasets', { method: 'POST', body: {
    name, description: '旅途主持人独立版本知识库，由项目发布工具创建。', indexing_technique: 'economy', permission: 'only_me' } });
  await onCreated({ dataset_id: dataset.id });
  await request(`/datasets/${dataset.id}`, { method: 'PATCH', body: { retrieval_model: source.retrieval_model } });
  const form = new FormData();
  form.set('file', new Blob([source.rows.map(row => JSON.stringify(row)).join('\n\n') + '\n'],
    { type: 'text/markdown' }), 'knowhow-source.md');
  const file = await request('/files/upload', { method: 'POST', form });
  const created = await request(`/datasets/${dataset.id}/documents`, { method: 'POST', body: {
    indexing_technique: 'economy', doc_form: 'text_model', doc_language: 'Chinese',
    process_rule: source.process_rule, retrieval_model: source.retrieval_model,
    data_source: { info_list: { data_source_type: 'upload_file', file_info_list: { file_ids: [file.id] } } },
  } });
  const documentId = created.documents?.[0]?.id;
  if (!documentId) throw new Error('Knowledge import did not return a document');
  await onCreated({ dataset_id: dataset.id, document_id: documentId });
  for (let i = 0; i < 90; i++) {
    const result = await request(`/datasets/${dataset.id}/documents/${documentId}/indexing-status`);
    if (result.indexing_status === 'completed') {
      const copied = await readKnowledge(request, dataset.id);
      if (source.revision !== copied.revision) throw new Error('Knowledge copy changed records or import/retrieval settings');
      return copied;
    }
    if (['error', 'paused'].includes(result.indexing_status)) throw new Error('Knowledge indexing failed');
    await delay(2000);
  }
  throw new Error('Knowledge indexing timed out; resource IDs are recorded for inspection');
}

export async function saveDraft(request, id, next, expected) {
  const current = await request(`/apps/${id}/workflows/draft`);
  if (current.hash !== expected.hash || fingerprint(workflowContent(current)) !== fingerprint(workflowContent(expected))) {
    throw new Error(`Concurrent draft change at ${id}; stopped without overwrite`);
  }
  const body = { graph: next.graph, features: next.features, conversation_variables: next.conversation_variables,
    hash: current.hash, environment_variable_patch: {
      environment_variables: next.environment_variables,
      deleted_environment_variable_ids: current.environment_variables.filter(variable =>
        !next.environment_variables.some(nextVariable => nextVariable.id === variable.id)).map(variable => variable.id),
    } };
  await request(`/apps/${id}/workflows/draft`, { method: 'POST', body });
  const saved = await request(`/apps/${id}/workflows/draft`);
  if (fingerprint(workflowContent(saved)) !== fingerprint(next)) throw new Error('Saved draft readback mismatch');
  return saved;
}

export async function publishChecked(request, id, expected, version) {
  const current = await request(`/apps/${id}/workflows/draft`);
  if (current.hash !== expected.hash || fingerprint(workflowContent(current)) !== fingerprint(workflowContent(expected))) {
    throw new Error('Draft changed after regression; refusing publication');
  }
  await request(`/apps/${id}/workflows/publish`, { method: 'POST', body: {
    marked_name: version.slice(0, 20), marked_comment: '项目发布命令：备份、差异检查和回归验证后发布。' } });
  const published = await request(`/apps/${id}/workflows/publish`);
  if (fingerprint(workflowContent(published)) !== fingerprint(workflowContent(expected))) {
    throw new Error('Published workflow readback mismatch');
  }
  return published;
}

export function saveSnapshot(folder, label, app) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const dsl = YAML.stringify(app.dsl, { lineWidth: 120 });
  if (/\b(?:app|sk)-[A-Za-z0-9_-]{20,}\b|-----BEGIN .*PRIVATE KEY-----/.test(dsl)) {
    throw new Error('Possible credential in export; snapshot refused');
  }
  fs.writeFileSync(path.join(folder, `${label}.yml`), dsl, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(folder, `${label}.json`), JSON.stringify({ id: app.id,
    published_hash: app.published.hash, published_id: app.published.id,
    content: app.content, draft: app.draft }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}

export function sealReleaseFolder(folder) {
  const receiptFile = path.join(folder, 'release.json');
  const receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) : null;
  for (const name of fs.readdirSync(folder).filter(file => file.endsWith('-knowledge.json'))) {
    const knowledge = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
    const rows = knowledge.rows;
    if (!Array.isArray(rows) || !rows.length) throw new Error('Knowledge archive is incomplete');
    const prefix = name.slice(0, -5);
    fs.writeFileSync(path.join(folder, `${prefix}.jsonl`), rows.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(folder, `${prefix}.md`), rows.map(row => JSON.stringify(row)).join('\n\n') + '\n', { mode: 0o600 });
  }
  const versionFile = path.join(folder, 'VERSION.md');
  if (!fs.existsSync(versionFile)) {
    const summary = receipt ? `状态：\`${receipt.phase}\`。测试应用回归：${receipt.test_regression?.ok ? '通过' : '未确认'}；正式草稿回归：${receipt.production_draft_regression?.ok ? '通过' : '未确认'}。\n\n`
      + `版本：\`${receipt.version}\`。具体差异、局部发布/回退进度和运行ID见 [release.json](release.json)。\n`
      : '这是创建独立测试环境前，从ECS实际读取的正式发布图、草稿和知识库备份；测试结果见同目录JSON。\n';
    fs.writeFileSync(versionFile, '# ECS 工作流版本记录\n\n' + summary
      + '\n完整DSL保留节点代码、提示词和模型参数；JSON保存发布/草稿版本。知识库同时保存JSON元数据、JSONL原文和空行分隔的Markdown导入文件。\n'
      + '\n不包含API Key、模型凭证、Console会话或用户聊天。文件完整性见manifest.json；应用/知识库ID应按目标实例核对。\n'
      + '\n原有换题语义问题和HK10门槛矛盾没有借环境分离修复；不得把结构/接口回归通过当成全部自然语言语义正确。\n', { mode: 0o600 });
  }
  const files = fs.readdirSync(folder).filter(name => name !== 'manifest.json')
    .sort().map(name => {
      const file = path.join(folder, name);
      if (!fs.lstatSync(file).isFile()) throw new Error('Unexpected non-file in release folder');
      const content = fs.readFileSync(file);
      if (/\b(?:app|sk)-[A-Za-z0-9_-]{20,}\b|-----BEGIN .*PRIVATE KEY-----/.test(content.toString('utf8'))) {
        throw new Error('Possible credential in release archive; sealing refused');
      }
      return { path: name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
    });
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ schema_version: 1,
    captured_at: new Date().toISOString(), instance: 'alibaba', live_exports: true,
    secrets_exported: false, files }, null, 2) + '\n', { mode: 0o600 });
}

export function verifyReleaseFolder(folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  if (manifest.schema_version !== 1 || manifest.secrets_exported !== false || !manifest.files?.length) {
    throw new Error('Incomplete release manifest');
  }
  const recorded = new Set();
  for (const file of manifest.files) {
    if (path.basename(file.path) !== file.path || recorded.has(file.path)) throw new Error('Invalid release file path');
    recorded.add(file.path);
    const resolved = path.join(folder, file.path);
    if (!fs.lstatSync(resolved).isFile() || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Invalid archive file');
    const content = fs.readFileSync(resolved);
    if (content.length !== file.bytes || createHash('sha256').update(content).digest('hex') !== file.sha256) {
      throw new Error(`${file.path}: release checksum mismatch`);
    }
  }
  const actual = fs.readdirSync(folder).filter(name => name !== 'manifest.json');
  if (actual.length !== recorded.size || actual.some(name => !recorded.has(name))) throw new Error('Unrecorded release files');
  return { ok: true, files: recorded.size, instance: manifest.instance };
}
