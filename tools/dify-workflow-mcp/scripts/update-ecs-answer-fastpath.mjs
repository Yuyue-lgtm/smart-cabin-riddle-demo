import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createEcsConsole, profilesPath, projectRoot } from '../src/ecs-console.mjs';
import { describeDiff, fingerprint, publishChecked, saveDraft, workflowContent } from '../src/ecs-release.mjs';
import { parseWorkflowStream } from '../src/ecs-regression.mjs';

const source = path.join(projectRoot, 'tools/dify-workflow-mcp/workflows/host/src');
export function patchAnswerFastpath(original) {
  const next = workflowContent(original);
  const input = next.graph.nodes.find(node => node.id === '1000000000002');
  const p0 = next.graph.nodes.find(node => node.id === '1000000000004');
  assert.ok(input && p0, 'Expected host input and deterministic response nodes');
  const old = input.data.code;
  const parsed = spawnSync('python3', ['-c', `import ast,json,sys
tree=ast.parse(sys.stdin.read())
functions=[node for node in tree.body if isinstance(node,ast.FunctionDef)]
matches=[node for node in functions if node.name=='main' and [arg.arg for arg in node.args.args]==['input_payload','cabin_snapshot']]
assert len(matches)==1
node=matches[0]
helper=next((item for item in functions if item.name=='answer_candidate_kind'),None)
print(json.dumps({'start':helper.lineno if helper else node.lineno,'end':node.end_lineno}))`], { input: old, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const span = JSON.parse(parsed.stdout);
  const lines = old.split('\n');
  input.data.code = lines.slice(0, span.start - 1).join('\n') + '\n'
    + fs.readFileSync(path.join(source, 'realtime_input.py'), 'utf8').trim() + '\n'
    + lines.slice(span.end).join('\n');
  const p0Start = p0.data.code.indexOf('def main(payload: object, exact_correct: bool, event_type: str)');
  assert.ok(p0Start > 0, 'Deterministic response source layout changed');
  p0.data.code = p0.data.code.slice(0, p0Start) + fs.readFileSync(path.join(source, 'realtime_p0.py'), 'utf8');
  const diff = describeDiff(workflowContent(original), next);
  assert.ok(diff.changed_nodes.every(id => ['1000000000002', '1000000000004'].includes(id)));
  assert.equal(diff.edges_changed || diff.features_changed || diff.variables_changed, false);
  return next;
}

async function main() {
  const mode = process.argv[2];
  assert.ok(['prepare', 'save', 'verify', 'publish'].includes(mode));
  const folder = process.argv[3] || path.join(projectRoot, 'tmp/dify-ecs', `${new Date().toISOString().replace(/[:.]/g, '-')}-answer-fastpath`);
  const file = name => path.join(folder, name + '.json');
  const load = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  const request = createEcsConsole();
  const appId = profiles.environments['alibaba-test'].apps.host;
  const formalId = profiles.environments.alibaba.apps.host;
  if (mode === 'prepare') {
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const draft = await request(`/apps/${appId}/workflows/draft`);
    const published = await request(`/apps/${appId}/workflows/publish`);
    const formalDraft = await request(`/apps/${formalId}/workflows/draft`);
    const formalPublished = await request(`/apps/${formalId}/workflows/publish`);
    const candidate = patchAnswerFastpath(draft);
    save('before', { appId, formalId, draft, published, formalDraft, formalPublished });
    save('candidate', candidate);
    console.log(JSON.stringify({ folder, diff: describeDiff(workflowContent(draft), candidate) }));
    return;
  }
  assert.ok(process.argv[3], 'Supply the prepared folder');
  const before = load('before');
  assert.equal(before.appId, appId);
  assert.equal(before.formalId, formalId);
  const assertFormalUnchanged = async () => {
    for (const [route, original] of [['draft', before.formalDraft], ['publish', before.formalPublished]]) {
      assert.equal(fingerprint(workflowContent(await request(`/apps/${formalId}/workflows/${route}`))), fingerprint(workflowContent(original)), 'Formal host changed; stop for review');
    }
  };
  await assertFormalUnchanged();
  const candidate = load('candidate');
  if (mode === 'save') {
    const saved = await saveDraft(request, appId, candidate, before.draft);
    save('saved', saved);
    console.log(JSON.stringify({ saved: true, hash: saved.hash }));
    return;
  }
  const current = await request(`/apps/${appId}/workflows/draft`);
  assert.equal(current.hash, load('saved').hash);
  assert.equal(fingerprint(workflowContent(current)), fingerprint(candidate));
  if (mode === 'publish') {
    const verified = load('verification');
    assert.equal(verified.passed, true);
    assert.equal(verified.hash, current.hash);
    assert.equal(fingerprint(workflowContent(await request(`/apps/${appId}/workflows/publish`))), fingerprint(workflowContent(before.published)), 'Published version changed meanwhile');
    const published = await publishChecked(request, appId, current, '答案包含优先快速确认');
    await assertFormalUnchanged();
    save('published', { hash: published.hash, published_at: new Date().toISOString(), formal_unchanged: true });
    console.log(JSON.stringify({ published: true, hash: published.hash, formal_unchanged: true }));
    return;
  }
  const fixtures = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tests/fixtures/answer-fastpath.json'), 'utf8'));
  const queries = ['雨伞', '是雨伞吗', '是不是雨伞？', '我觉得可能是雨伞吧', '不是雨伞', '雨伞已经排除了', '是雨伞还是雨衣', '我家有把雨伞', '它是人造的吗'];
  const report = { passed: false, hash: current.hash, reports: [] };
  for (const query of queries) {
    const expected = fixtures.find(row => row.text === query);
    assert.ok(expected);
    const id = `answer-fast-${Date.now()}`;
    const snapshot = { game_id: id, round_id: `${id}-r1`, scene_version: `${id}-sv1`, trigger_type: 'chat',
      game: { status: 'playing', current_answer: '雨伞', question_count: 3, max_questions: 15, public_clues: [], asked_questions: [], covered_fact_keys: [] },
      car: { speed: 50, environment: '雨天' },
      passengers: { selected_seat: 'front', states: { driver: 'normal', front: 'normal', rearLeft: 'normal', rearRight: 'normal' } } };
    const start = Date.now();
    const response = await request(`/apps/${appId}/advanced-chat/workflows/draft/run`, { method: 'POST', raw: true,
      body: { query, inputs: { snapshot: JSON.stringify(snapshot), situation: '{}' } } });
    const stream = await response.text();
    const { data, workflow_run_id } = parseWorkflowStream(stream);
    const events = stream.split('\n').filter(line => line.startsWith('data:')).flatMap(line => {
      try { return [JSON.parse(line.slice(5))]; } catch { return []; }
    });
    const host = JSON.parse(data.outputs.host_result || events.find(row => row.event === 'node_finished' && row.data?.node_id === '1000000000020')?.data.outputs.host_result);
    const modelNodes = events.filter(row => row.event === 'node_finished' && row.data?.node_type === 'llm');
    const row = { query, expected: expected.kind, is_correct: host.is_correct, speech: host.ai_reply_text,
      guard: host.decision_trace?.guard_status, rule: host.decision_trace?.matched_rule,
      model_nodes: modelNodes.map(row => row.data.node_id), elapsed_ms: Date.now() - start, run_id: workflow_run_id };
    report.reports.push(row);
    save('verification', report);
    console.log(JSON.stringify(row));
    assert.equal(host.is_correct, expected.kind === 'confirmed');
    assert.equal(host.decision_trace.guard_status, 'passed');
    if (expected.kind !== 'none') {
      assert.equal(modelNodes.length, 0, 'Answer candidates must skip all LLM nodes');
      assert.equal(host.decision_trace.answer_confirmation.confirmation, expected.kind);
    } else assert.ok(modelNodes.length > 0, 'Unrelated questions must retain normal dialogue');
    if (expected.kind !== 'confirmed') assert.equal(host.ui_change.show_answer, false);
  }
  await assertFormalUnchanged();
  report.passed = true;
  report.completed_at = new Date().toISOString();
  save('verification', report);
  console.log(JSON.stringify({ passed: true, folder, cases: report.reports.length }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
