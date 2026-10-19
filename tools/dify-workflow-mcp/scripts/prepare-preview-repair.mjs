import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [snapshotPath, outputPath] = process.argv.slice(2);
if (!snapshotPath || !outputPath) throw new Error('Usage: prepare-preview-repair.mjs <current-draft.json> <candidate.json>');
const current = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
if (!current.hash || !Array.isArray(current.graph?.nodes)) throw new Error('A fresh cloud draft with its hash is required.');
const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../workflows/preview/src');
const graph = structuredClone(current.graph);
for (const [id, file] of [['2000000000005', 'preview_input.py'], ['2000000000003', 'preview_guard.py']]) {
  const node = graph.nodes.find(item => item.id === id);
  if (node?.data?.type !== 'code') throw new Error(`Unexpected preview code node ${id}`);
  node.data.code = fs.readFileSync(path.join(sourceDir, file), 'utf8');
}
const llm = graph.nodes.find(node => node.id === '2000000000002');
const system = llm?.data?.prompt_template?.find(prompt => prompt.role === 'system');
if (!system) throw new Error('Existing preview system prompt is required.');
if (!system.text.includes('提问预演修复协议 v1')) {
  system.text += '\n\n' + fs.readFileSync(path.join(sourceDir, 'repair-prompt.txt'), 'utf8').trim();
}
fs.writeFileSync(outputPath, JSON.stringify({
  app_id: 'bf81cd44-a49f-4048-901f-e95e941dc429', expected_hash: current.hash,
  graph, features: current.features, environment_variables: current.environment_variables,
  conversation_variables: current.conversation_variables,
}, null, 2));
console.log(JSON.stringify({ expected_hash: current.hash, changed_nodes: ['2000000000005', '2000000000002', '2000000000003'], output: outputPath }));
