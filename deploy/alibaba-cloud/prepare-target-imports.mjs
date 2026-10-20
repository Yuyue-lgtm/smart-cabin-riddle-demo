import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import YAML from '../../tools/dify-workflow-mcp/node_modules/yaml/dist/index.js';

const [sourceDirectory, pluginIdentifier] = process.argv.slice(2);
if (!sourceDirectory || !/^langgenius\/deepseek:\d+\.\d+\.\d+@[a-f0-9]{64}$/.test(pluginIdentifier || '')) {
  throw new Error('Usage: node prepare-target-imports.mjs <source-directory> <verified-installed-plugin-identifier>');
}
const folder = path.resolve(sourceDirectory);
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
const sha256 = text => createHash('sha256').update(text).digest('hex');
const result = { created_at: new Date().toISOString(), source_manifest: 'manifest.json',
  target_plugin: pluginIdentifier, changes: 'dependency-only; graph unchanged; retrieval bindings still required', apps: [] };
for (const entry of manifest.apps) {
  const originalText = fs.readFileSync(path.join(folder, entry.file), 'utf8');
  if (sha256(originalText) !== entry.sha256) throw new Error(`${entry.kind}: import source checksum mismatch`);
  const source = YAML.parse(originalText);
  const target = structuredClone(source);
  if (target.dependencies.length !== 1
    || !target.dependencies[0].value.marketplace_plugin_unique_identifier.startsWith('langgenius/deepseek:')) {
    throw new Error(`${entry.kind}: unexpected plugin dependency`);
  }
  target.dependencies[0].value.marketplace_plugin_unique_identifier = pluginIdentifier;
  if (!isDeepStrictEqual(source.workflow, target.workflow)) throw new Error(`${entry.kind}: workflow changed`);
  const file = `${entry.kind}.target.yml`;
  const text = YAML.stringify(target, { lineWidth: 120 });
  fs.writeFileSync(path.join(folder, file), text, { mode: 0o600, flag: 'wx' });
  result.apps.push({ kind: entry.kind, file, name: target.app.name, source_published_hash: entry.published_hash,
    sha256: sha256(text), graph_unchanged: true, node_count: target.workflow.graph.nodes.length });
}
fs.writeFileSync(path.join(folder, 'target-import-manifest.json'), JSON.stringify(result, null, 2) + '\n',
  { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
