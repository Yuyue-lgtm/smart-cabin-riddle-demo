import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import YAML from '../node_modules/yaml/dist/index.js';

const sha256 = content => createHash('sha256').update(content).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const kinds = ['host', 'situation', 'preview'];
const credentialPatterns = [
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\b(?:app|sk)-[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
];

function assertNoCredentials(text, label) {
  if (credentialPatterns.some(pattern => pattern.test(text))) {
    throw new Error(`${label}: possible credential; archive refused without printing content`);
  }
}

function localFile(folder, relative) {
  const resolved = path.resolve(folder, relative);
  if (!resolved.startsWith(`${path.resolve(folder)}${path.sep}`) || fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('Archive paths must be regular files inside the bundle');
  }
  return resolved;
}

function checkDsl(text, label) {
  assertNoCredentials(text, label);
  const dsl = YAML.parse(text);
  if (dsl.kind !== 'app' || !Array.isArray(dsl.workflow?.graph?.nodes)) {
    throw new Error(`${label}: not a complete application DSL`);
  }
  for (const variable of dsl.workflow.environment_variables || []) {
    if (variable.value_type === 'secret' && variable.value) {
      throw new Error(`${label}: nonempty secret variable; archive refused`);
    }
  }
  return dsl;
}

export function verifyArchive(folder) {
  const manifest = readJson(path.join(folder, 'manifest.json'));
  if (manifest.schema_version !== 1 || manifest.secrets_exported !== false) {
    throw new Error('Unsupported or unsafe archive manifest');
  }
  assertNoCredentials(JSON.stringify(manifest), 'manifest');
  const expectedFiles = [
    ...kinds.flatMap(kind => [`cloud/${kind}.yml`, `alibaba-import/${kind}.yml`]),
    'knowledge/knowhow-source.jsonl', 'knowledge/knowhow-source.md',
    'evidence/cloud-migration-manifest.json', 'evidence/alibaba-import-manifest.json',
  ];
  const paths = manifest.files.map(file => file.path);
  if (new Set(paths).size !== paths.length
      || !isDeepStrictEqual([...paths].sort(), expectedFiles.sort())) {
    throw new Error('Archive must contain all three application pairs and knowledge sources');
  }
  for (const file of manifest.files) {
    const content = fs.readFileSync(localFile(folder, file.path));
    if (content.length !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`${file.path}: checksum mismatch`);
    }
    assertNoCredentials(content.toString('utf8'), file.path);
  }
  const sourceManifest = readJson(path.join(folder, 'evidence/cloud-migration-manifest.json'));
  const targetManifest = readJson(path.join(folder, 'evidence/alibaba-import-manifest.json'));
  for (const kind of kinds) {
    const source = checkDsl(fs.readFileSync(path.join(folder, 'cloud', `${kind}.yml`), 'utf8'), kind);
    const targetText = fs.readFileSync(path.join(folder, 'alibaba-import', `${kind}.yml`), 'utf8');
    const target = checkDsl(targetText, kind);
    const entry = sourceManifest.apps.find(app => app.kind === kind);
    const targetEntry = targetManifest.apps.find(app => app.kind === kind);
    if (!entry || !targetEntry || source.workflow.graph.nodes.length !== entry.node_count
        || sha256(targetText) !== targetEntry.sha256) throw new Error(`${kind}: source evidence mismatch`);
    const portable = structuredClone(source);
    for (const node of portable.workflow.graph.nodes) {
      if (node.data.type === 'knowledge-retrieval') node.data.dataset_ids = [];
    }
    if (sha256(YAML.stringify(portable, { lineWidth: 120 })) !== entry.sha256
        || !isDeepStrictEqual(portable.workflow, target.workflow)) {
      throw new Error(`${kind}: workflow differs beyond documented knowledge bindings`);
    }
    if (target.dependencies.some(dependency =>
      dependency.value?.marketplace_plugin_unique_identifier !== targetManifest.target_plugin)) {
      throw new Error(`${kind}: plugin differs from target evidence`);
    }
  }
  const jsonl = fs.readFileSync(path.join(folder, 'knowledge/knowhow-source.jsonl'), 'utf8');
  const rows = jsonl.trim().split(/\r?\n/).map(JSON.parse);
  const expected = Array.from({ length: 28 }, (_, i) => `HK${String(i + 1).padStart(2, '0')}`);
  if (!isDeepStrictEqual(rows.map(row => row.knowhow_id).sort(), expected)
      || sha256(jsonl) !== sourceManifest.knowledge[0]?.jsonl_sha256) {
    throw new Error('Knowledge source differs from the verified 28-record baseline');
  }
  const markdown = fs.readFileSync(path.join(folder, 'knowledge/knowhow-source.md'), 'utf8');
  if (!isDeepStrictEqual(markdown.trim().split(/\n\s*\n/).map(JSON.parse), rows)) {
    throw new Error('Knowledge import document differs from JSONL source');
  }
  return { version: manifest.version, files: manifest.files.length, knowledge_records: rows.length,
    live_readback_performed: false };
}

export function archiveBaseline(sourceDirectory, outputDirectory) {
  const source = path.resolve(sourceDirectory);
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) throw new Error('Output already exists; version snapshots are immutable');
  const cloud = readJson(path.join(source, 'manifest.json'));
  const target = readJson(path.join(source, 'target-import-manifest.json'));
  if (cloud.secrets_exported !== false) throw new Error('Source does not confirm a secret-free export');
  const files = new Map();
  for (const kind of kinds) {
    files.set(`cloud/${kind}.yml`, fs.readFileSync(path.join(source, `${kind}.source.yml`)));
    files.set(`alibaba-import/${kind}.yml`, fs.readFileSync(path.join(source, `${kind}.target.yml`)));
  }
  for (const extension of ['jsonl', 'md']) {
    files.set(`knowledge/knowhow-source.${extension}`, fs.readFileSync(path.join(source, `knowhow-source.${extension}`)));
  }
  files.set('evidence/cloud-migration-manifest.json', fs.readFileSync(path.join(source, 'manifest.json')));
  files.set('evidence/alibaba-import-manifest.json', fs.readFileSync(path.join(source, 'target-import-manifest.json')));
  for (const [name, buffer] of files) {
    assertNoCredentials(buffer.toString('utf8'), name);
    if (name.endsWith('.yml')) checkDsl(buffer.toString('utf8'), name);
  }
  const manifest = {
    schema_version: 1, version: path.basename(output), archived_at: new Date().toISOString(),
    source_captured_at: cloud.created_at, secrets_exported: false,
    provenance: {
      cloud: 'Published Cloud export verified at source_captured_at; not a new live readback.',
      alibaba_import: 'Dependency-adapted migration inputs; NOT an export of the published ECS graph. Knowledge bindings are intentionally empty.',
      knowledge: 'Verified Cloud segments used for the ECS migration; historical authoring JSONL is preserved separately in docs.',
    },
    target_dify_version: '1.17.1', target_plugin: target.target_plugin,
    cloud_published_hashes: Object.fromEntries(cloud.apps.map(app => [app.kind, app.published_hash])),
    ecs_published_hashes: null,
    files: [...files].map(([name, buffer]) => ({ path: name, bytes: buffer.length, sha256: sha256(buffer) })),
  };
  // Validate the entire bundle before promoting it into the version directory.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(output), '.archive-'));
  try {
    for (const [name, buffer] of files) {
      const file = path.join(staging, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buffer, { mode: 0o600, flag: 'wx' });
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const result = verifyArchive(staging);
    fs.renameSync(staging, output);
    return result;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, source, output] = process.argv.slice(2);
  if (mode === '--verify' && source && !output) {
    console.log(JSON.stringify(verifyArchive(path.resolve(source))));
  } else if (mode === '--source' && source && process.argv[4] === '--output' && process.argv[5]) {
    console.log(JSON.stringify(archiveBaseline(source, process.argv[5])));
  } else {
    throw new Error('Usage: archive-dify-baseline.mjs --source <migration-folder> --output <new-version-folder> | --verify <version-folder>');
  }
}
