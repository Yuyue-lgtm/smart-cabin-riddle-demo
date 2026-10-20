const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const YAML = require('../tools/dify-workflow-mcp/node_modules/yaml');

const script = path.resolve(__dirname, '../deploy/alibaba-cloud/prepare-target-imports.mjs');
const installed = `langgenius/deepseek:0.0.25@${'a'.repeat(64)}`;
const sourcePlugin = `langgenius/deepseek:0.0.24@${'b'.repeat(64)}`;

function fixture(t, invalidChecksum = false) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-target-import-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const source = { app: { name: 'fixture' }, version: '0.7.0', kind: 'app',
    dependencies: [{ type: 'marketplace', value: { marketplace_plugin_unique_identifier: sourcePlugin } }],
    workflow: { graph: { nodes: [{ id: 'model', data: { type: 'llm',
      model: { name: 'deepseek-flash', completion_params: { thinking: false, max_tokens: 4096 } } } }], edges: [] },
    environment_variables: [], conversation_variables: [] } };
  const text = YAML.stringify(source);
  fs.writeFileSync(path.join(folder, 'host.import.yml'), text);
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ apps: [{ kind: 'host',
    file: 'host.import.yml', published_hash: 'source-hash',
    sha256: invalidChecksum ? 'invalid' : createHash('sha256').update(text).digest('hex') }] }));
  return { folder, source, text };
}

test('target imports change only the verified plugin dependency, not graph or model settings', t => {
  const { folder, source, text } = fixture(t);
  const result = spawnSync(process.execPath, [script, folder, installed], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const target = YAML.parse(fs.readFileSync(path.join(folder, 'host.target.yml'), 'utf8'));
  assert.deepEqual(target.workflow, source.workflow);
  assert.equal(target.dependencies[0].value.marketplace_plugin_unique_identifier, installed);
  assert.equal(fs.readFileSync(path.join(folder, 'host.import.yml'), 'utf8'), text);
  assert.equal(JSON.parse(result.stdout).apps[0].graph_unchanged, true);
  assert.equal(fs.statSync(path.join(folder, 'host.target.yml')).mode & 0o777, 0o600);
  const repeat = spawnSync(process.execPath, [script, folder, installed], { encoding: 'utf8' });
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /EEXIST/);
});

test('target imports reject an altered migration source before writing a target file', t => {
  const { folder } = fixture(t, true);
  const result = spawnSync(process.execPath, [script, folder, installed], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum mismatch/);
  assert.equal(fs.existsSync(path.join(folder, 'host.target.yml')), false);
});

test('target imports reject unverified or non-DeepSeek plugin identifiers', t => {
  const { folder } = fixture(t);
  const result = spawnSync(process.execPath, [script, folder, 'unknown/plugin:latest'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(folder, 'host.target.yml')), false);
});
