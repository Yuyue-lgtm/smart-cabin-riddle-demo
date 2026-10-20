import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { projectRoot, profilesPath, ecsOrigin, readPrivateEnv, writePrivateEnv } from './ecs-console.mjs';
import { appKinds, assertSeparateProfiles, fingerprint, workflowContent, remapKnowledge, describeDiff,
  readApp, readKnowledge, cloneKnowledge, saveDraft, publishChecked, saveSnapshot, sealReleaseFolder } from './ecs-release.mjs';
import { runDraftRegression } from './ecs-regression.mjs';

const loadJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const privateFolder = path.join(projectRoot, 'tmp/dify-ecs');
const setupFile = path.join(privateFolder, 'setup.json');
const keyFile = path.join(privateFolder, '.env.test-keys');
const localEnv = path.join(projectRoot, '.env.local');
const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const log = message => console.log(message);

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function runLocalTests() {
  log('运行本地回归测试…');
  const files = fs.readdirSync(path.join(projectRoot, 'tests')).filter(file => file.endsWith('.test.cjs')).sort();
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=dot', ...files.map(file => `tests/${file}`)],
    { cwd: projectRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    // Test output contains fixtures only; no remote responses or credentials are logged here.
    throw new Error(`Local regression failed; run node --test tests/*.test.cjs to inspect (${result.status})`);
  }
  log('本地回归测试通过。');
}

async function appsSnapshot(request, profile, folder, prefix) {
  const result = {};
  for (const kind of appKinds) {
    result[kind] = await readApp(request, profile.apps[kind]);
    saveSnapshot(folder, `${prefix}-${kind}`, result[kind]);
  }
  return result;
}

async function assertPublishedStable(request, apps) {
  for (const kind of appKinds) {
    const current = await request(`/apps/${apps[kind].id}/workflows/publish`);
    if (current.id !== apps[kind].published.id
      || fingerprint(workflowContent(current)) !== fingerprint(apps[kind].content)) {
      throw new Error(`${kind}: published version changed during release`);
    }
  }
}

async function setup(request, profiles) {
  const production = profiles.environments.alibaba;
  const journal = fs.existsSync(setupFile) ? loadJson(setupFile) : { apps: {}, published: {}, created_at: new Date().toISOString() };
  const recorded = profiles.environments['alibaba-test'];
  if (recorded) {
    assertSeparateProfiles(production, recorded);
    for (const kind of appKinds) await readApp(request, recorded.apps[kind]);
    await readKnowledge(request, recorded.knowledge.dataset_id);
    await ensureTestKeys(request, recorded);
    log('测试资源已存在，核对后复用；不再次复制。');
    return configureLocal(recorded);
  }
  const backup = journal.backup || path.join(projectRoot, 'dify/releases', `${timestamp()}-ecs-setup`);
  if (!journal.backup) { journal.backup = backup; saveJson(setupFile, journal); }
  let sources;
  if (journal.source_apps) sources = journal.source_apps;
  else {
    sources = await appsSnapshot(request, production, backup, 'production');
    for (const kind of appKinds) {
      if (fingerprint(sources[kind].content) !== fingerprint(sources[kind].draft_content)) {
        throw new Error(`Production ${kind} has unpublished changes; review before copying`);
      }
    }
    journal.source_apps = sources; saveJson(setupFile, journal);
  }
  await assertPublishedStable(request, sources);
  const sourceKnowledge = await readKnowledge(request, production.knowledge.dataset_id);
  saveJson(path.join(backup, 'production-knowledge.json'), sourceKnowledge);
  if (journal.knowledge?.dataset_id) {
    const copied = await readKnowledge(request, journal.knowledge.dataset_id);
    if (copied.revision !== sourceKnowledge.revision) throw new Error('Existing test knowledge differs; inspect setup journal');
    journal.knowledge = copied;
  } else {
    journal.knowledge = await cloneKnowledge(request, sourceKnowledge, '测试 · 旅途主持人经验库', info => {
      journal.knowledge = { ...journal.knowledge, ...info }; saveJson(setupFile, journal);
    });
  }
  saveJson(setupFile, journal);
  for (const kind of appKinds) {
    if (!journal.apps[kind]) {
      const name = `测试 · ${sources[kind].name}`;
      const existing = await request(`/apps?page=1&limit=100&name=${encodeURIComponent(name)}`);
      if (existing.data?.some(app => app.name === name)) throw new Error(`Unmapped test app already exists: ${kind}; inspect before copying`);
      const copied = await request(`/apps/${production.apps[kind]}/copy`, { method: 'POST', body: {
        name, description: '阿里云独立测试应用，本地 Demo 使用；通过项目发布命令同步到正式应用。' } });
      if (!copied.id || copied.status === 'pending') throw new Error('App copy requires manual dependency review');
      journal.apps[kind] = copied.id; saveJson(setupFile, journal);
    }
    const id = journal.apps[kind];
    const draft = await request(`/apps/${id}/workflows/draft`);
    const next = remapKnowledge(sources[kind].published, production.knowledge.dataset_id, journal.knowledge.dataset_id).workflow;
    if (journal.published[kind]) {
      const current = await request(`/apps/${id}/workflows/publish`);
      if (fingerprint(workflowContent(current)) !== fingerprint(next)) throw new Error('Previously created test app changed; do not overwrite');
    } else {
      const saved = await saveDraft(request, id, next, draft);
      await publishChecked(request, id, saved, 'ecs-test-initial');
      journal.published[kind] = true; saveJson(setupFile, journal);
    }
    const existingKeys = readPrivateEnv(keyFile);
    const keyName = `DIFY_${kind === 'host' ? 'CHATFLOW' : kind.toUpperCase()}_API_KEY`;
    if (!existingKeys[keyName]) {
      const key = await request(`/apps/${id}/api-keys`, { method: 'POST', body: {} });
      if (!key.token) throw new Error('App API key was not returned');
      writePrivateEnv(keyFile, { [keyName]: key.token,
        [`DIFY_${kind === 'host' ? 'CHATFLOW' : kind.toUpperCase()}_APP_ID`]: id });
    }
    await request(`/apps/${id}/api-enable`, { method: 'POST', body: { enable_api: true } });
    log(`${kind} 测试应用已就绪：${id}`);
  }
  const testing = { role: 'Testing', dify_version: production.dify_version,
    api_base_url_local: ecsOrigin(), apps: journal.apps,
    knowledge: { dataset_id: journal.knowledge.dataset_id, document_id: journal.knowledge.document_id,
      indexing_technique: 'economy' }, created_at: journal.created_at };
  assertSeparateProfiles(production, testing);
  runLocalTests();
  const report = await runDraftRegression(request, testing.apps, label => log(`测试环境回归：${label}`), testing.knowledge.dataset_id);
  saveJson(path.join(backup, 'test-regression.json'), report);
  await assertPublishedStable(request, sources);
  profiles.environments['alibaba-test'] = testing;
  profiles.environments.cloud.role = 'Historical backup; no further routine development';
  profiles.alibaba_test_apps_created = true;
  profiles.local_demo_configuration = 'alibaba-test';
  profiles.latest_verified_ecs_snapshot = path.relative(path.join(projectRoot, 'dify'), backup);
  production.published_graph_hashes = Object.fromEntries(appKinds.map(kind => [kind, sources[kind].published.hash]));
  production.published_graph_verified_at = new Date().toISOString();
  saveJson(profilesPath, profiles);
  journal.completed = true; saveJson(setupFile, journal);
  await configureLocal(testing);
  sealReleaseFolder(backup);
  log('独立测试环境创建与回归通过，正式应用发布版本保持原样。');
}

async function ensureTestKeys(request, testing) {
  for (const [kind, name] of [['host', 'CHATFLOW'], ['situation', 'SITUATION'], ['preview', 'PREVIEW']]) {
    const values = readPrivateEnv(keyFile), keyName = `DIFY_${name}_API_KEY`, idName = `DIFY_${name}_APP_ID`;
    if (values[keyName] && values[idName] === testing.apps[kind]) continue;
    const list = await request(`/apps/${testing.apps[kind]}/api-keys`);
    let key = list.data?.find(item => item.token === values[keyName]) || list.data?.[0];
    if (!key) key = await request(`/apps/${testing.apps[kind]}/api-keys`, { method: 'POST', body: {} });
    if (!key.token) throw new Error('Cannot recover a private TEST app key');
    writePrivateEnv(keyFile, { [keyName]: key.token, [idName]: testing.apps[kind] });
  }
}

async function configureLocal(testing) {
  const keys = readPrivateEnv(keyFile);
  const names = { host: 'CHATFLOW', situation: 'SITUATION', preview: 'PREVIEW' };
  if (Object.values(names).some(name => !keys[`DIFY_${name}_API_KEY`])) throw new Error('Private test keys are missing; inspect the setup journal');
  fs.mkdirSync(privateFolder, { recursive: true, mode: 0o700 });
  const backup = path.join(privateFolder, '.env.cloud-backup');
  if (!fs.existsSync(backup) && fs.existsSync(localEnv)) fs.copyFileSync(localEnv, backup, fs.constants.COPYFILE_EXCL);
  if (fs.existsSync(backup)) fs.chmodSync(backup, 0o600);
  const changes = { DIFY_API_BASE_URL: ecsOrigin(), DIFY_ENVIRONMENT: 'alibaba-test', PORT: '4175' };
  for (const [kind, name] of Object.entries(names)) {
    changes[`DIFY_${name}_APP_ID`] = testing.apps[kind];
    changes[`DIFY_${name}_API_KEY`] = keys[`DIFY_${name}_API_KEY`];
  }
  writePrivateEnv(localEnv, changes);
  log('本地 .env.local 已切换到阿里云测试应用；Cloud 旧配置已私有备份。请使用 node tools/dify.mjs dev 启动。');
}

export async function promoteRelease(request, profiles, publish, {
  outputRoot = path.join(projectRoot, 'dify/releases'), localTests = runLocalTests,
  regression = runDraftRegression, saveProfiles = value => saveJson(profilesPath, value),
} = {}) {
  const production = profiles.environments.alibaba, testing = profiles.environments['alibaba-test'];
  assertSeparateProfiles(production, testing);
  const version = `${timestamp()}-ecs`;
  const folder = path.join(outputRoot, version);
  const journal = { schema_version: 1, version, created_at: new Date().toISOString(),
    instance: 'alibaba', phase: 'backing_up', applied: {}, published: {}, no_secrets: true };
  const receipt = path.join(folder, 'release.json');
  const persist = () => saveJson(receipt, journal);
  persist();
  const previous = await appsSnapshot(request, production, folder, 'before');
  const source = await appsSnapshot(request, testing, folder, 'test');
  for (const kind of appKinds) {
    if (fingerprint(source[kind].content) !== fingerprint(source[kind].draft_content)) {
      throw new Error(`Test ${kind} has unpublished changes; publish/test that app first`);
    }
    if (fingerprint(previous[kind].content) !== fingerprint(previous[kind].draft_content)) {
      throw new Error(`Production ${kind} has unpublished changes; preserve/review those before promotion`);
    }
  }
  const [oldKnowledge, nextKnowledge] = [await readKnowledge(request, production.knowledge.dataset_id),
    await readKnowledge(request, testing.knowledge.dataset_id)];
  saveJson(path.join(folder, 'before-knowledge.json'), oldKnowledge);
  saveJson(path.join(folder, 'test-knowledge.json'), nextKnowledge);
  journal.knowledge_changed = oldKnowledge.revision !== nextKnowledge.revision;
  journal.diff = Object.fromEntries(appKinds.map(kind => [kind, describeDiff(previous[kind].content,
    remapKnowledge(source[kind].published, testing.knowledge.dataset_id, production.knowledge.dataset_id).workflow)]));
  journal.phase = 'planned'; persist();
  log(JSON.stringify({ version, knowledge_changed: journal.knowledge_changed, diff: journal.diff }, null, 2));
  if (!publish) {
    sealReleaseFolder(folder);
    log('已保存备份和差异；执行 node tools/dify.mjs release --publish 重新核对并验证、发布。'); return;
  }
  try { localTests(); } catch (error) {
    journal.phase = 'local_test_failed'; journal.failure = error.message;
    persist(); sealReleaseFolder(folder); throw error;
  }
  try {
    journal.test_regression = await regression(request, testing.apps, label => log(`测试环境回归：${label}`), testing.knowledge.dataset_id);
  } catch (error) {
    journal.phase = 'test_failed'; journal.failure = error.message;
    journal.test_regression = error.regression_report || { ok: false, error: error.message };
    persist(); sealReleaseFolder(folder); throw error;
  }
  journal.phase = 'test_passed'; persist();
  await assertPublishedStable(request, previous);
  await assertPublishedStable(request, source);
  if ((await readKnowledge(request, testing.knowledge.dataset_id)).revision !== nextKnowledge.revision) {
    throw new Error('Test knowledge changed during regression');
  }
  let targetKnowledge = oldKnowledge;
  if (journal.knowledge_changed) {
    try {
      targetKnowledge = await cloneKnowledge(request, nextKnowledge, `正式经验 ${version.slice(0, 19)}`, info => {
        journal.new_knowledge = { ...journal.new_knowledge, ...info }; persist();
      });
    } catch (error) {
      journal.phase = 'knowledge_copy_failed'; journal.failure = error.message;
      persist(); sealReleaseFolder(folder); throw error;
    }
    journal.new_knowledge = targetKnowledge; persist();
  }
  const candidates = Object.fromEntries(appKinds.map(kind => [kind,
    remapKnowledge(source[kind].published, testing.knowledge.dataset_id, targetKnowledge.dataset_id).workflow]));
  try {
    for (const kind of appKinds) {
      journal.draft_attempt = kind; persist();
      const draft = await saveDraft(request, production.apps[kind], candidates[kind], previous[kind].draft);
      journal.applied[kind] = draft; journal.phase = 'production_draft'; persist();
    }
    journal.production_draft_regression = await regression(request, production.apps,
      label => log(`正式草稿回归：${label}`), targetKnowledge.dataset_id);
    await assertPublishedStable(request, previous);
    await assertPublishedStable(request, source);
    for (const [id, expected] of [[testing.knowledge.dataset_id, nextKnowledge.revision],
      [targetKnowledge.dataset_id, targetKnowledge.revision]]) {
      if ((await readKnowledge(request, id)).revision !== expected) throw new Error('Knowledge changed after regression');
    }
    journal.phase = 'publishing'; persist();
    for (const kind of appKinds) {
      // Record the attempt before POST, so an uncertain response cannot hide a partial publication.
      journal.publish_attempt = kind; persist();
      const published = await publishChecked(request, production.apps[kind], journal.applied[kind], version);
      journal.published[kind] = { id: published.id, hash: published.hash,
        fingerprint: fingerprint(workflowContent(published)) }; persist();
    }
  } catch (error) {
    journal.phase = 'failed'; journal.failure = error.message; persist();
    if (error.regression_report) { journal.failed_regression = error.regression_report; persist(); }
    log(`发布停止，备份及进度保存在 ${path.relative(projectRoot, folder)}。`);
    // Only restore drafts still matching this release. Never overwrite another editor's work.
    for (const kind of appKinds) {
      if (!journal.applied[kind] && journal.draft_attempt !== kind) continue;
      const current = await request(`/apps/${production.apps[kind]}/workflows/draft`);
      if (fingerprint(workflowContent(current)) !== fingerprint(candidates[kind])) {
        journal.rollback_conflict = kind; persist(); continue;
      }
      const restored = await saveDraft(request, production.apps[kind], previous[kind].draft_content, current);
      if (journal.published[kind] || journal.publish_attempt === kind) {
        const live = await request(`/apps/${production.apps[kind]}/workflows/publish`);
        if (fingerprint(workflowContent(live)) === fingerprint(candidates[kind])) {
          await publishChecked(request, production.apps[kind], restored, 'release-rollback');
        } else if (fingerprint(workflowContent(live)) !== fingerprint(previous[kind].content)) {
          journal.rollback_conflict = kind; persist();
        }
      }
      journal.restored_drafts ||= []; journal.restored_drafts.push(kind); persist();
    }
    sealReleaseFolder(folder); throw error;
  }
  production.knowledge = { ...production.knowledge, dataset_id: targetKnowledge.dataset_id,
    document_id: targetKnowledge.document_id };
  production.published_graph_hashes = Object.fromEntries(appKinds.map(kind => [kind, journal.published[kind].hash]));
  production.last_release = version;
  profiles.latest_verified_ecs_snapshot = path.relative(path.join(projectRoot, 'dify'), folder);
  saveProfiles(profiles);
  journal.phase = 'published'; journal.completed_at = new Date().toISOString(); persist();
  sealReleaseFolder(folder);
  log(`正式应用已发布，App ID/API Key 保持不变：${version}`);
}

export async function runCommand(command, args, request) {
  const profiles = loadJson(profilesPath);
  if (command === 'status') {
    const output = { cloud: 'historical reference', local: profiles.local_demo_configuration, environments: {} };
    for (const name of ['alibaba', 'alibaba-test']) {
      const profile = profiles.environments[name];
      if (!profile) { output.environments[name] = 'not initialized'; continue; }
      output.environments[name] = {};
      for (const kind of appKinds) {
        const app = await readApp(request, profile.apps[kind]);
        output.environments[name][kind] = { app_id: app.id, published_hash: app.published.hash,
          draft_matches_published: fingerprint(app.content) === fingerprint(app.draft_content) };
      }
    }
    log(JSON.stringify(output, null, 2));
  } else if (command === 'setup') await setup(request, profiles);
  else if (command === 'release') {
    if (args.some(arg => arg !== '--publish')) throw new Error('Usage: release [--publish]');
    await promoteRelease(request, profiles, args.includes('--publish'));
  } else if (command === 'test') {
    assertSeparateProfiles(profiles.environments.alibaba, profiles.environments['alibaba-test']);
    runLocalTests();
    const result = await runDraftRegression(request, profiles.environments['alibaba-test'].apps,
      label => log(`回归：${label}`), profiles.environments['alibaba-test'].knowledge.dataset_id);
    const file = path.join(privateFolder, `regression-${timestamp()}.json`);
    saveJson(file, result); log(`回归通过：${path.relative(projectRoot, file)}`);
  } else if (command === 'dev') {
    assertSeparateProfiles(profiles.environments.alibaba, profiles.environments['alibaba-test']);
    const testing = profiles.environments['alibaba-test'];
    const env = readPrivateEnv(localEnv);
    if (env.DIFY_CHATFLOW_APP_ID !== testing.apps.host || env.DIFY_API_BASE_URL !== ecsOrigin()) {
      throw new Error('Local configuration is not the recorded ECS test environment; run setup');
    }
    const { verifyTestApiKeys } = await import('./ecs-doctor.mjs');
    await verifyTestApiKeys(env);
    log('Dify隧道和三套测试应用Key检查通过。');
    const child = spawn(process.execPath, ['dev-server.cjs'], { cwd: projectRoot, stdio: 'inherit',
      env: { ...process.env, ...env, PORT: process.env.PORT || '4175', RUNTIME_ENV: 'local' } });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => {
      if (code) reject(new Error(`Local server exited: ${code}`)); else resolve();
    }); });
  } else throw new Error(`Unknown Dify command: ${command}`);
}
