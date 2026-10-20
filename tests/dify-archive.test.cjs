const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');

const baseline = path.resolve(__dirname, '../dify/releases/2026-10-20-migration-baseline');
const moduleUrl = pathToFileURL(path.resolve(__dirname,
  '../tools/dify-workflow-mcp/scripts/archive-dify-baseline.mjs')).href;

function copyBundle(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-dify-archive-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(baseline, directory, { recursive: true });
  return directory;
}

function updateChecksum(directory, relative) {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const content = fs.readFileSync(path.join(directory, relative));
  Object.assign(manifest.files.find(file => file.path === relative), {
    bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'),
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

test('project baseline preserves complete applications and all knowledge, without claiming live readback', async () => {
  const { verifyArchive } = await import(moduleUrl);
  const result = verifyArchive(baseline);
  assert.equal(result.files, 10);
  assert.equal(result.knowledge_records, 28);
  assert.equal(result.live_readback_performed, false);
  const manifest = JSON.parse(fs.readFileSync(path.join(baseline, 'manifest.json'), 'utf8'));
  assert.equal(manifest.ecs_published_hashes, null);
});

test('archive verification detects changed workflow bytes', async t => {
  const { verifyArchive } = await import(moduleUrl);
  const directory = copyBundle(t);
  fs.appendFileSync(path.join(directory, 'cloud/host.yml'), '\n# changed\n');
  assert.throws(() => verifyArchive(directory), /checksum mismatch/);
});

test('updated checksums cannot conceal a leaked credential in the DSL', async t => {
  const { verifyArchive } = await import(moduleUrl);
  const directory = copyBundle(t);
  fs.appendFileSync(path.join(directory, 'cloud/host.yml'), `\n# app-${'x'.repeat(32)}\n`);
  updateChecksum(directory, 'cloud/host.yml');
  assert.throws(() => verifyArchive(directory), /possible credential/);
});

test('knowledge import document must preserve the same whole JSON records as the source', async t => {
  const { verifyArchive } = await import(moduleUrl);
  const directory = copyBundle(t);
  const file = path.join(directory, 'knowledge/knowhow-source.md');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('HK28', 'HK99'));
  updateChecksum(directory, 'knowledge/knowhow-source.md');
  assert.throws(() => verifyArchive(directory), /differs from JSONL/);
});

test('archive creation refuses to overwrite a saved version', async () => {
  const { archiveBaseline } = await import(moduleUrl);
  assert.throws(() => archiveBaseline('/nonexistent-source', baseline), /already exists/);
});

test('saved bundle can reproduce the migration archive without the ignored tmp directory', async t => {
  const { archiveBaseline, verifyArchive } = await import(moduleUrl);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-dify-rebuild-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  fs.mkdirSync(source);
  for (const kind of ['host', 'situation', 'preview']) {
    fs.copyFileSync(path.join(baseline, 'cloud', `${kind}.yml`), path.join(source, `${kind}.source.yml`));
    fs.copyFileSync(path.join(baseline, 'alibaba-import', `${kind}.yml`), path.join(source, `${kind}.target.yml`));
  }
  for (const extension of ['md', 'jsonl']) {
    fs.copyFileSync(path.join(baseline, 'knowledge', `knowhow-source.${extension}`),
      path.join(source, `knowhow-source.${extension}`));
  }
  fs.copyFileSync(path.join(baseline, 'evidence/cloud-migration-manifest.json'), path.join(source, 'manifest.json'));
  fs.copyFileSync(path.join(baseline, 'evidence/alibaba-import-manifest.json'), path.join(source, 'target-import-manifest.json'));
  const output = path.join(directory, 'rebuilt');
  assert.equal(archiveBaseline(source, output).knowledge_records, 28);
  assert.equal(verifyArchive(output).files, 10);
  const original = JSON.parse(fs.readFileSync(path.join(baseline, 'manifest.json'), 'utf8'));
  const rebuilt = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
  assert.deepEqual(rebuilt.files, original.files);
});
