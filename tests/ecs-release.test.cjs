const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const load = () => import('../tools/dify-workflow-mcp/src/ecs-release.mjs');
const workflow = () => ({ hash: 'before', id: 'published-1', features: {}, environment_variables: [],
  conversation_variables: [{ id: 'v1', name: 'memory', value: '' }],
  graph: { nodes: [{ id: 'retrieval', data: { type: 'knowledge-retrieval', dataset_ids: ['test-kb'] } },
    { id: 'model', data: { type: 'llm', model: { name: 'deepseek-flash', completion_params: { thinking: false } } } }], edges: [] } });

test('test and production profiles cannot share application or knowledge IDs', async () => {
  const { assertSeparateProfiles } = await load();
  const a = { apps: { host: 'h1', situation: 's1', preview: 'p1' }, knowledge: { dataset_id: 'k1' } };
  const b = { apps: { host: 'h2', situation: 's2', preview: 'p2' }, knowledge: { dataset_id: 'k2' } };
  assert.doesNotThrow(() => assertSeparateProfiles(a, b));
  assert.throws(() => assertSeparateProfiles(a, { ...b, apps: { ...b.apps, host: a.apps.host } }), /separate/);
  assert.throws(() => assertSeparateProfiles(a, { ...b, knowledge: a.knowledge }), /separate/);
  assert.throws(() => assertSeparateProfiles(a, null), /not initialized/);
});

test('promotion remaps only known knowledge references while preserving model and conversation settings', async () => {
  const { remapKnowledge, workflowContent } = await load();
  const original = workflow();
  const result = remapKnowledge(original, 'test-kb', 'prod-kb');
  assert.equal(result.changed_bindings, 1);
  assert.deepEqual(original.graph.nodes[0].data.dataset_ids, ['test-kb']);
  assert.deepEqual(result.workflow.graph.nodes[0].data.dataset_ids, ['prod-kb']);
  assert.deepEqual(result.workflow.graph.nodes[1], original.graph.nodes[1]);
  assert.deepEqual(result.workflow.conversation_variables, original.conversation_variables);
  assert.throws(() => remapKnowledge(original, 'other-kb', 'prod-kb'), /Unexpected dataset/);
  const secret = workflow(); secret.environment_variables = [{ name: 'credential', value_type: 'secret', value: 'masked' }];
  assert.throws(() => workflowContent(secret), /Secret workflow variables/);
});

test('draft synchronization stops before POST when another editor changed the version', async () => {
  const { saveDraft, workflowContent } = await load();
  const requests = [];
  const expected = workflow();
  await assert.rejects(saveDraft(async (url, options) => {
    requests.push({ url, options }); return { ...workflow(), hash: 'someone-else' };
  }, 'prod', workflowContent(expected), expected), /Concurrent draft change/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options, undefined);
});

test('draft sync uses 1.17.1 environment patch and verifies graph plus variables on readback', async () => {
  const { saveDraft, workflowContent } = await load();
  const before = workflow(), next = workflowContent(before);
  next.features = { file_upload: { enabled: false } };
  let body;
  let saved = before;
  const result = await saveDraft(async (_url, options) => {
    if (options) { body = options.body; saved = { ...next, hash: 'saved' }; return { hash: 'saved' }; }
    return saved;
  }, 'prod', next, before);
  assert.equal(body.hash, 'before');
  assert.equal(body.environment_variables, undefined);
  assert.deepEqual(body.environment_variable_patch, { environment_variables: [], deleted_environment_variable_ids: [] });
  assert.equal(result.hash, 'saved');
});

test('publication rechecks the exact tested draft and published graph', async () => {
  const { publishChecked } = await load();
  let posts = 0;
  await assert.rejects(publishChecked(async (_url, options) => {
    if (options) posts++;
    return { ...workflow(), hash: 'changed' };
  }, 'prod', workflow(), 'release'), /changed after regression/);
  assert.equal(posts, 0);
  await assert.rejects(publishChecked(async (url, options) => {
    if (options) { posts++; return {}; }
    const result = workflow();
    if (url.endsWith('/publish')) result.graph.nodes[1].data.model.name = 'wrong-model';
    return result;
  }, 'prod', workflow(), 'release'), /Published workflow readback mismatch/);
  assert.equal(posts, 1);
});

test('knowledge reads reject incomplete, disabled or split records rather than releasing partial data', async () => {
  const { readKnowledge } = await load();
  const request = async url => {
    if (url.includes('/segments')) return { data: [{ enabled: false, status: 'completed', position: 1,
      content: JSON.stringify({ knowhow_id: 'HK01', version: '1' }) }] };
    if (url.includes('/documents?')) return { data: [{ id: 'doc', indexing_status: 'completed' }] };
    if (url.endsWith('/doc')) return { document_process_rule: { mode: 'custom', rules: {} } };
    return { indexing_technique: 'economy', retrieval_model: { search_method: 'keyword_search', top_k: 3 } };
  };
  await assert.rejects(readKnowledge(request, 'kb'), /enabled and indexed/);
});

test('self-host console credentials cannot be sent to Cloud or another origin', async t => {
  const { createConsoleClient } = await import('../tools/dify-workflow-mcp/src/console-client.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecs-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.env');
  fs.writeFileSync(file, 'DIFY_BASE_URL=https://cloud.dify.ai\nDIFY_CONSOLE_TOKEN=test-access\n');
  let calls = 0;
  const request = createConsoleClient({ envPath: file, env: {}, allowedOrigin: 'http://127.0.0.1:8081',
    fetchImpl: async () => { calls++; return new Response('{}'); } });
  await assert.rejects(request('/apps'), /restricted/);
  assert.equal(calls, 0);
  fs.writeFileSync(file, 'DIFY_BASE_URL=http://127.0.0.1:8081\nDIFY_CONSOLE_TOKEN=test-access\n');
  await request('/apps'); assert.equal(calls, 1);
});

test('private environment updates preserve unrelated settings and never leave duplicate credential keys', async t => {
  const { writePrivateEnv, readPrivateEnv } = await import('../tools/dify-workflow-mcp/src/ecs-console.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecs-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.env');
  fs.writeFileSync(file, 'KEEP=yes\nDIFY_API_BASE_URL=old\nDIFY_API_BASE_URL=duplicate\n');
  writePrivateEnv(file, { DIFY_API_BASE_URL: 'http://127.0.0.1:8081' });
  assert.deepEqual(readPrivateEnv(file), { KEEP: 'yes', DIFY_API_BASE_URL: 'http://127.0.0.1:8081' });
  assert.equal((fs.readFileSync(file, 'utf8').match(/DIFY_API_BASE_URL=/g) || []).length, 1);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('draft streaming failures or truncated output cannot count as regression success', async () => {
  const { parseWorkflowStream } = await import('../tools/dify-workflow-mcp/src/ecs-regression.mjs');
  const stream = data => `data: ${JSON.stringify(data)}\n\n`;
  assert.throws(() => parseWorkflowStream(stream({ event: 'workflow_started', data: {} })), /did not complete/);
  assert.throws(() => parseWorkflowStream(stream({ event: 'workflow_finished', data: { status: 'failed' } })), /failed/);
  const result = parseWorkflowStream(stream({ event: 'workflow_finished', data: { id: 'run', status: 'succeeded', outputs: { output: '{}' } } }));
  assert.equal(result.workflow_run_id, 'run');
});

async function fakeRelease(t, { failPublish = false, failDraftRegression = false, uncertainDraft = false } = {}) {
  const { promoteRelease } = await import('../tools/dify-workflow-mcp/src/ecs-project.mjs');
  const { workflowContent, fingerprint } = await load();
  const YAML = require('../tools/dify-workflow-mcp/node_modules/yaml');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecs-promote-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const production = { apps: { host: 'h1', situation: 's1', preview: 'p1' }, knowledge: { dataset_id: 'prod-kb' } };
  const testing = { apps: { host: 'h2', situation: 's2', preview: 'p2' }, knowledge: { dataset_id: 'test-kb' } };
  const profiles = { environments: { alibaba: production, 'alibaba-test': testing } };
  const apps = new Map();
  let sequence = 1, posts = 0, regressionRuns = 0, savedProfiles = false;
  for (const [role, profile] of Object.entries({ production, testing })) {
    for (const id of Object.values(profile.apps)) {
      const content = workflow(); content.id = `${id}-published`;
      content.graph.nodes[0].data.dataset_ids = [profile.knowledge.dataset_id];
      content.graph.nodes[1].data.prompt = role;
      apps.set(id, { published: structuredClone(content), draft: structuredClone(content) });
    }
  }
  const before = Object.fromEntries(Object.values(production.apps).map(id =>
    [id, fingerprint(workflowContent(apps.get(id).published))]));
  const request = async (url, options) => {
    if (options) posts++;
    if (url.startsWith('/datasets/')) {
      if (url.includes('/segments')) return { data: [{ position: 1, status: 'completed', enabled: true,
        content: JSON.stringify({ knowhow_id: 'HK01', version: '1', title: 'fixture' }) }] };
      if (url.includes('/documents?')) return { data: [{ id: 'doc', indexing_status: 'completed' }] };
      if (url.endsWith('/doc')) return { document_process_rule: { mode: 'custom', rules: { segmentation: { max_tokens: 1024 } } } };
      return { indexing_technique: 'economy', retrieval_model: { search_method: 'keyword_search', top_k: 3 } };
    }
    const id = url.split('/')[2], app = apps.get(id);
    if (!app) throw new Error(`Unknown fixture application: ${url}`);
    if (url.includes('/export?')) return { data: YAML.stringify({ kind: 'app', version: '0.7.0', app: { name: id },
      dependencies: [], workflow: workflowContent(app.published) }) };
    if (url.endsWith('/draft')) {
      if (options) {
        app.draft = { graph: options.body.graph, features: options.body.features,
          conversation_variables: options.body.conversation_variables,
          environment_variables: options.body.environment_variable_patch.environment_variables, hash: `saved-${sequence++}` };
        if (uncertainDraft && id === 'h1') { uncertainDraft = false; throw new Error('fixture uncertain draft response'); }
      }
      return structuredClone(app.draft);
    }
    if (url.endsWith('/publish')) {
      if (options) {
        if (failPublish && id === 's1') { failPublish = false; throw new Error('fixture publish failure'); }
        app.published = { ...structuredClone(app.draft), id: `version-${sequence++}` };
      }
      return structuredClone(app.published);
    }
    return { id, name: id, mode: id.startsWith('h') ? 'advanced-chat' : 'workflow' };
  };
  async function run(publish) {
    return promoteRelease(request, profiles, publish, { outputRoot: directory, localTests: () => {},
      regression: async (_request, target) => {
        regressionRuns++;
        if (failDraftRegression && target.host === 'h1') throw new Error('fixture draft regression failure');
        return { ok: true };
      }, saveProfiles: () => { savedProfiles = true; } });
  }
  return { run, apps, before, production, profiles, directory,
    stats: () => ({ posts, regressionRuns, savedProfiles }), fingerprint, workflowContent };
}

test('release planning writes live backups and diffs with no remote mutations', async t => {
  const fixture = await fakeRelease(t);
  await fixture.run(false);
  assert.equal(fixture.stats().posts, 0);
  assert.equal(fixture.stats().regressionRuns, 0);
  const version = fs.readdirSync(fixture.directory)[0];
  const report = JSON.parse(fs.readFileSync(path.join(fixture.directory, version, 'release.json'), 'utf8'));
  assert.equal(report.phase, 'planned');
  assert.equal(report.diff.host.changed, true);
  assert.ok(fs.existsSync(path.join(fixture.directory, version, 'before-host.yml')));
  const { verifyReleaseFolder } = await load();
  const folder = path.join(fixture.directory, version);
  assert.equal(verifyReleaseFolder(folder).ok, true);
  fs.appendFileSync(path.join(folder, 'before-host.yml'), '\n# modified\n');
  assert.throws(() => verifyReleaseFolder(folder), /checksum mismatch/);
});

test('release publishes existing application IDs only after test and production-draft regressions', async t => {
  const fixture = await fakeRelease(t);
  await fixture.run(true);
  assert.equal(fixture.stats().regressionRuns, 2);
  assert.equal(fixture.stats().savedProfiles, true);
  for (const id of Object.values(fixture.production.apps)) {
    const app = fixture.apps.get(id);
    assert.equal(app.published.graph.nodes[1].data.prompt, 'testing');
    assert.deepEqual(app.published.graph.nodes[0].data.dataset_ids, ['prod-kb']);
  }
});

test('failed production-draft regression restores drafts without publishing anything', async t => {
  const fixture = await fakeRelease(t, { failDraftRegression: true });
  await assert.rejects(fixture.run(true), /fixture draft regression failure/);
  assert.equal(fixture.stats().savedProfiles, false);
  for (const id of Object.values(fixture.production.apps)) {
    const app = fixture.apps.get(id);
    assert.equal(fixture.fingerprint(fixture.workflowContent(app.published)), fixture.before[id]);
    assert.equal(fixture.fingerprint(fixture.workflowContent(app.draft)), fixture.before[id]);
  }
});

test('a partial publication failure restores already-published applications from the backup', async t => {
  const fixture = await fakeRelease(t, { failPublish: true });
  await assert.rejects(fixture.run(true), /fixture publish failure/);
  for (const id of Object.values(fixture.production.apps)) {
    const app = fixture.apps.get(id);
    assert.equal(fixture.fingerprint(fixture.workflowContent(app.published)), fixture.before[id]);
    assert.equal(fixture.fingerprint(fixture.workflowContent(app.draft)), fixture.before[id]);
  }
});

test('lost draft-save responses still trigger checked recovery of the attempted application', async t => {
  const fixture = await fakeRelease(t, { uncertainDraft: true });
  await assert.rejects(fixture.run(true), /fixture uncertain draft response/);
  for (const id of Object.values(fixture.production.apps)) {
    const app = fixture.apps.get(id);
    assert.equal(fixture.fingerprint(fixture.workflowContent(app.draft)), fixture.before[id]);
    assert.equal(fixture.fingerprint(fixture.workflowContent(app.published)), fixture.before[id]);
  }
});
