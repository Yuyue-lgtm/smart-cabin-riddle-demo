import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const connector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.resolve(connector, '../../tmp/dify-import/dialogue-reliability');
const appId = '74bef8bd-22bd-4e19-91da-5e8d645dd8ed';
const endpoint = `https://cloud.dify.ai/console/api/apps/${appId}`;
const loadEnv = () => dotenv.parse(fs.readFileSync(path.join(connector, '.env'), 'utf8'));
const env = loadEnv();
const proxy = env.DIFY_PROXY_URL ?? 'http://127.0.0.1:7897';
if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));
const headers = () => {
  const current = loadEnv();
  return { Authorization: `Bearer ${current.DIFY_CONSOLE_TOKEN}`, 'X-CSRF-Token': current.DIFY_CSRF_TOKEN,
    Cookie: `${current.DIFY_CSRF_COOKIE_NAME || 'csrf_token'}=${current.DIFY_CSRF_TOKEN}`, 'Content-Type': 'application/json' };
};
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: headers(), signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`Console request failed: HTTP ${response.status}; ${detail.message || detail.code || 'request rejected'}`);
  }
  return response;
}
const getDraft = () => request(`${endpoint}/workflows/draft`).then(r => r.json());
async function saveGraph(graph, expectedHash) {
  const current = await getDraft();
  assert.equal(current.hash, expectedHash, 'Concurrent draft edit detected.');
  await request(`${endpoint}/workflows/draft`, { method: 'POST', body: JSON.stringify({
    graph, hash: current.hash, features: current.features, conversation_variables: current.conversation_variables,
  }) });
  return getDraft();
}
const summary = [];
async function run(name, inputs, query, conversationId = '', parentMessageId = '') {
  const started = Date.now();
  const response = await request(`${endpoint}/advanced-chat/workflows/draft/run`, {
    method: 'POST', body: JSON.stringify({ inputs, query, response_mode: 'streaming',
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(parentMessageId ? { parent_message_id: parentMessageId } : {}) }),
  });
  const raw = await response.text();
  const events = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).flatMap(line => {
    try { return [JSON.parse(line.slice(5))]; } catch { return []; }
  });
  const nodes = events.filter(event => event.event === 'node_finished').map(event => event.data);
  const finished = events.find(event => event.event === 'workflow_finished')?.data;
  const result = nodes.find(node => node.node_id === '1000000000020')?.outputs?.host_result;
  const host = result ? JSON.parse(result) : null;
  const answer = events.filter(event => event.event === 'message').map(event => event.answer || '').join('');
  const row = { name, status: finished?.status, elapsed_ms: Date.now() - started,
    run_id: events.find(event => event.event === 'workflow_started')?.data?.id,
    error: finished?.error || events.find(event => event.event === 'error')?.message || null,
    answer, retry_count: host?.debug?.model_retry_count || 0,
    attempts: host?.debug?.model_attempts, guard_status: host?.decision_trace?.guard_status,
    llm_calls: nodes.filter(node => node.node_type === 'llm').length };
  summary.push(row);
  console.log(JSON.stringify(row));
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({ events }, null, 2), { mode: 0o600 });
  assert.ok(['succeeded', 'partial-succeeded'].includes(finished?.status), `${name}: ${row.error || 'missing completion'}`);
  assert.ok(host, `${name}: missing host result`);
  if (finished.status === 'partial-succeeded') {
    assert.equal(host.debug.model_retry_count, 1);
    assert.ok(nodes.some(node => node.node_type === 'llm' && node.status === 'exception'));
  }
  assert.equal(answer, host.ai_reply_text);
  assert.ok(!answer.includes('我陪你慢慢想'));
  if (query !== JSON.parse(inputs.snapshot).game.current_answer) {
    assert.ok(!answer.includes(JSON.parse(inputs.snapshot).game.current_answer), `${name}: answer leaked`);
  }
  return { host, nodes, conversationId: events.find(event => event.conversation_id)?.conversation_id,
    messageId: events.find(event => event.event === 'message_end')?.message_id };
}

const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'release.json'), 'utf8'));
const draft = await getDraft();
assert.equal(draft.hash, manifest.saved_hash);
const fixtures = [];
for (const id of ['cd25b122-6001-4e35-aee3-62d1fc723bfc', '7de38769-8187-42fe-b8b1-14248342d557', '391a482f-3a4c-4ef2-a9ac-f647790fa2cc']) {
  const trace = await request(`${endpoint}/workflow-runs/${id}/node-executions`).then(r => r.json());
  const input = trace.data.find(node => node.node_id === '1000000000002')?.inputs;
  assert.equal(typeof input?.snapshot, 'string');
  assert.equal(typeof input?.query, 'string');
  fixtures.push({ id, query: input.query, inputs: { snapshot: input.snapshot, situation: input.situation || '{}' } });
}
fs.writeFileSync(path.join(folder, 'replay-inputs.json'), JSON.stringify(fixtures, null, 2), { mode: 0o600 });
for (let repeat = 0; repeat < (process.argv.includes('--probes-only') || process.argv.includes('--memory-only') ? 0 : 3); repeat++) {
  for (const [index, fixture] of fixtures.entries()) {
    const response = await run(`replay-${index}-${repeat}`, fixture.inputs, fixture.query);
    assert.equal(response.host.debug.model_output_status, 'valid');
    assert.ok(['passed', 'hint_blocked'].includes(response.host.decision_trace.guard_status));
    if (index === 0 || index === 2) assert.match(response.host.ai_reply_text, /^是/, `${fixture.id}: incorrect attribute answer`);
    if (index === 1) assert.doesNotMatch(response.host.ai_reply_text, /身边|车里|车上|人造|虚构|日常|常见/, 'Acknowledgement must not introduce puzzle facts.');
    assert.ok(response.host.debug.model_attempts.some(attempt => attempt.status === 'valid'));
  }
}

if (!process.argv.includes('--memory-only')) {
  let activeHash = draft.hash;
  try {
    for (const mode of ['truncated', 'exception', 'exhausted']) {
      const exhausted = mode === 'exhausted';
      const injected = structuredClone(draft.graph);
      injected.nodes.find(node => node.id === '1000000000005').data.model.completion_params.max_tokens = mode === 'exception' ? 0 : 1;
      if (exhausted) injected.nodes.find(node => node.id === '1000000000023').data.model.completion_params.max_tokens = 1;
      activeHash = (await saveGraph(injected, activeHash)).hash;
      const result = await run(`forced-${mode}`, fixtures[0].inputs, fixtures[0].query);
      assert.equal(result.host.debug.model_retry_count, 1);
      assert.equal(result.nodes.filter(node => node.node_type === 'llm').length, 2);
      assert.equal(result.host.debug.model_output_status, exhausted ? 'retry_exhausted' : 'valid');
      if (mode === 'exception') assert.equal(result.nodes.find(node => node.node_id === '1000000000005').status, 'exception');
      if (exhausted) {
        assert.equal(result.host.decision_trace.guard_status, 'model_output_fallback');
        assert.ok(result.host.debug.model_failure_reason_codes.length);
        assert.deepEqual(result.host.covered_fact_keys, []);
        assert.equal(result.host.is_correct, false);
      }
    }
  } finally {
    const restored = await saveGraph(draft.graph, activeHash);
    assert.equal(restored.hash, draft.hash);
  }
}

if (process.argv.includes('--probes-only')) process.exit(0);

const snapshot = JSON.parse(fixtures[0].inputs.snapshot);
snapshot.game.current_answer = '安全带';
snapshot.game.status = 'playing';
snapshot.game.round_question_plan = { steps: [] };
snapshot.game.covered_fact_keys = [];
snapshot.game.asked_questions = [];
snapshot.game_id = 'reliability-memory-test';
snapshot.round_id = 'reliability-memory-test-round-1';
snapshot.round_context = {};
snapshot.scene_version = 'reliability-scene-1';
snapshot.event = null;
const inputs = { snapshot: JSON.stringify(snapshot), situation: '{}' };
const name = await run('memory-name', inputs, '我叫小橙，请记住我的名字。');
const correct = await run('memory-round-ended', inputs, '安全带', name.conversationId, name.messageId);
assert.equal(correct.host.is_correct, true);
assert.equal(correct.nodes.filter(node => node.node_type === 'llm').length, 0);
snapshot.round_id = 'reliability-memory-test-round-2';
snapshot.game.current_answer = '海豚';
snapshot.game.round_index = 2;
snapshot.round_context = { previous_game_id: snapshot.game_id, previous_round_id: 'reliability-memory-test-round-1' };
inputs.snapshot = JSON.stringify(snapshot);
const next = await run('memory-current-round', inputs, '它是人造的吗？', correct.conversationId, correct.messageId);
assert.match(next.host.ai_reply_text, /^(不|否)/);
assert.equal(next.conversationId, name.conversationId);
const remembered = await run('memory-retained-name', inputs, '你还记得我叫什么吗？', next.conversationId, next.messageId);
assert.ok(remembered.host.ai_reply_text.includes('小橙'));
const hint = await run('hint-still-blocked', inputs, '给我一点提示吧', remembered.conversationId, remembered.messageId);
assert.equal(hint.host.decision_trace.hint_blocked, true);
assert.deepEqual(hint.host.covered_fact_keys, []);
assert.equal((await getDraft()).hash, draft.hash);
if (process.argv.includes('--memory-only')) {
  console.log(JSON.stringify({ memory_passed: true, case_count: summary.length, hash: draft.hash }));
  process.exit(0);
}
const report = { passed: true, hash: draft.hash, finished_at: new Date().toISOString(), cases: summary };
fs.writeFileSync(path.join(folder, 'verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ passed: true, case_count: summary.length, hash: draft.hash }));
