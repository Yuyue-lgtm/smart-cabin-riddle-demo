import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requestConsoleJson as request } from '../src/index.mjs';
import { apps, save, load, saveGraph } from './update-structured-reliability.mjs';

const smoke = process.argv.includes('--smoke');
const memoryOnly = process.argv.includes('--memory-only');
const hashes = {};
for (const [kind, id] of Object.entries(apps)) {
  const draft = await request(`/apps/${id}/workflows/draft`);
  assert.equal(draft.hash, load(`${kind}-release.json`).saved_hash);
  hashes[kind] = draft.hash;
}
const reports = [];
const progress = process.argv.includes('--resume') ? load('verification-progress.json') : { hashes, results: {} };
assert.deepEqual(progress.hashes, hashes, 'Cannot resume verification against a different draft');
const prefix = progress.prefix || `stability-${randomUUID()}`;
progress.prefix = prefix;
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;

async function run(name, kind, snapshot, situation = {}, query = '', conversation = null, expected = 'succeeded') {
  if (process.argv.includes('--resume') && progress.results[name] && !name.startsWith('force-')) {
    const cached = progress.results[name];
    reports.push(cached.report);
    return cached;
  }
  const started = Date.now();
  const url = kind === 'dialogue' ? 'advanced-chat/workflows/draft/run' : 'workflows/draft/run';
  const inputs = kind === 'preview' ? { input_payload: JSON.stringify(snapshot) }
    : { snapshot: JSON.stringify(snapshot), ...(kind === 'dialogue' ? { situation: JSON.stringify(situation) } : {}) };
  const response = await request(`/apps/${apps[kind]}/${url}`, { method: 'POST', raw: true, body: {
    inputs, query, response_mode: 'streaming',
    ...(conversation?.id ? { conversation_id: conversation.id, parent_message_id: conversation.messageId } : {}),
  } });
  const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith('data:')).flatMap(line => {
    try { return [JSON.parse(line.slice(5))]; } catch { return []; }
  });
  save(`${name}.json`, { events });
  const finish = events.find(row => row.event === 'workflow_finished')?.data;
  const nodes = events.filter(row => row.event === 'node_finished').map(row => row.data);
  const models = nodes.filter(row => row.node_type === 'llm');
  const host = parse(nodes.find(row => row.node_id === '1000000000020')?.outputs?.host_result || 'null');
  const scene = parse(finish?.outputs?.scene_output || 'null');
  const preview = kind === 'preview' ? parse(finish?.outputs?.workflow_output || 'null') : null;
  const answer = events.filter(row => row.event === 'message').map(row => row.answer || '').join('');
  const report = { name, kind, status: finish?.status, elapsed_ms: Date.now() - started,
    run_id: events.find(row => row.event === 'workflow_started')?.data?.id,
    node_errors: nodes.filter(row => row.status === 'failed' || row.status === 'exception')
      .map(row => ({ node_id: row.node_id, type: row.node_type, error_class: /parse structured output/i.test([row.error, row.outputs?.error_message].join(' ')) ? 'structured_output_parse_failed' : 'node_error' })),
    model_calls: models.length, retrieval_calls: nodes.filter(row => row.node_type === 'knowledge-retrieval').length,
    model_output_status: host?.debug?.model_output_status, retries: host?.debug?.model_retry_count || 0,
    guard_status: host?.decision_trace?.guard_status, speech: host?.ai_reply_text,
    proactive: scene?.request_proactive_speech, analysis_status: scene?.analysis_status,
    preview_status: preview?.preview_status,
  };
  reports.push(report);
  console.log(JSON.stringify(report));
  assert.equal(finish?.status, expected, `${name}: ${finish?.error || events.find(row => row.event === 'error')?.message || 'workflow did not finish'}`);
  if (expected === 'succeeded') assert.equal(report.node_errors.length, 0, name);
  assert.doesNotMatch(answer, /<\/?think\b|dify-deepseek-reasoning/i, `${name}: reasoning reached answer`);
  if (host) {
    assert.equal(answer, host.ai_reply_text);
    if (query !== snapshot.game?.current_answer) {
      assert.ok(!answer.includes(snapshot.game.current_answer), `${name}: answer leaked`);
    }
  }
  const result = { host, scene, preview, nodes, models, report, conversation: {
    id: events.find(row => row.conversation_id)?.conversation_id,
    messageId: events.find(row => row.event === 'message_end')?.message_id,
  } };
  progress.results[name] = result;
  save('verification-progress.json', progress);
  return result;
}

function snapshot(type, extra = {}, answer = '海豚') {
  return { game_id: prefix, round_id: `${prefix}-round-1`, scene_version: 'reliability-scene-1', trigger_type: type ? 'event' : 'chat',
    game: { status: 'playing', round_index: 1, total_rounds: 10, current_answer: answer, question_count: 2, max_questions: 15,
      covered_fact_keys: [], asked_questions: [], round_question_plan: { steps: [] } },
    car: { environment: '高速路晴天白天', speed: 80, destination: '学校' },
    passengers: { selected_seat: 'front', states: { driver: '普通', front: '普通', rearLeft: '普通', rearRight: '普通' } },
    ...(type ? { event: { id: `${prefix}-${type}`, type, priority: ['environment_change', 'driver_tired', 'speed_overspeed'].includes(type) ? 'P1' : 'P2', source: 'manual_control', ...extra } } : {}),
  };
}

const original = load('failed-environment-nodes.json').data.find(row => row.node_id === '1000000000002').inputs;
function originalEnvironment() {
  const state = parse(original.snapshot), scene = parse(original.situation);
  state.game_id = prefix;
  state.round_id = `${prefix}-round-1`;
  state.scene_version = 'reliability-original-environment';
  state.event.id = `${prefix}-original-env`;
  state.dialogue_request = { kind: 'situation_event', event_id: state.event.id };
  Object.assign(scene, { game_id: state.game_id, round_id: state.round_id, scene_version: state.scene_version,
    event_id: state.event.id, generated_at_ms: Date.now(), expires_at_ms: Date.now() + 60000 });
  return { state, scene, query: original.query };
}

function assertHost(result) {
  assert.ok(result.host?.ai_reply_text, result.report.name);
  assert.ok(['passed', 'hint_blocked'].includes(result.host.decision_trace.guard_status), result.report.name);
  if (result.models.length) assert.equal(result.host.debug.model_output_status, 'valid', result.report.name);
}

async function batches(rows, execute) {
  for (let offset = 0; offset < rows.length; offset += 2) {
    const results = await Promise.allSettled(rows.slice(offset, offset + 2).map(execute));
    const rejected = results.find(row => row.status === 'rejected');
    if (rejected) throw rejected.reason;
  }
}

if (!memoryOnly) {
await batches(Array.from({ length: smoke ? 2 : 6 }, (_, index) => index), async repeat => {
  const input = originalEnvironment();
  const result = await run(`original-environment-${repeat}`, 'dialogue', input.state, input.scene, input.query);
  assertHost(result);
  assert.equal(result.report.retries, 0);
  assert.match(result.host.ai_reply_text, /高速/);
});

const attributes = [
  ['海豚', '它是人造的吗？', /^(不是|不|否)/], ['安全带', '它是人造的吗？', /^是/],
  ['米老鼠', '它是虚构角色吗？', /^是/], ['米老鼠', '它在现实中真实存在吗？', /^(不是|不|否)/],
  ['雨伞', '它能拿在手里吗？', /^(是|能|可以|对)/], ['雪人', '它是活的动物吗？', /^(不是|不|否)/],
  ['红绿灯', '它是人造的吗？', /^是/], ['书包', '它通常可以背在身上吗？', /^(是|能|可以|对)/],
];
await batches([...attributes.entries()].slice(0, smoke ? 2 : attributes.length), async ([index, [answer, query, expected]]) => {
  const result = await run(`attribute-${index}`, 'dialogue', snapshot(null, {}, answer), {}, query);
  assertHost(result); assert.match(result.host.ai_reply_text, expected);
  if (answer === '雪人') assert.doesNotMatch(result.host.ai_reply_text, /它(?:是|属于|确实是)(?:活的)?动物/);
});
if (smoke) process.exit(0);

for (const [index, query] of ['给我一点提示', '暗示一下答案吧', '告诉我隐藏线索', '好的'].entries()) {
  const result = await run(`hint-or-ack-${index}`, 'dialogue', snapshot(null), {}, query);
  assertHost(result);
  assert.deepEqual(result.host.covered_fact_keys, []);
  if (index < 3) assert.equal(result.host.decision_trace.hint_blocked, true);
  else assert.doesNotMatch(result.host.ai_reply_text, /人造|海里|动物|哺乳|身边|车里|车上/);
}

for (const [index, environment] of ['城区夜晚', '隧道', '车库', '风景区傍晚'].entries()) {
  const state = snapshot('environment_change', { value: environment, previous_value: '高速路晴天白天' });
  state.car.environment = environment;
  const analysis = await run(`environment-analysis-${index}`, 'situation', state);
  assert.equal(analysis.report.model_calls, 0); assert.equal(analysis.report.retrieval_calls, 0);
  assert.equal(analysis.scene.request_proactive_speech, true);
  state.dialogue_request = { kind: 'situation_event', event_id: state.event.id };
  assertHost(await run(`environment-speech-${index}`, 'dialogue', state, analysis.scene, '座舱环境刚刚变化，请回应本次事件。'));
}

for (const [type, extra] of [
  ['speed_overspeed', { value: 130, previous_value: 80, threshold_kmh: 120 }],
  ['driver_tired', { state: 'fatigued', duration_ms: 16000 }],
  ['passenger_sleep', { seat: 'rearLeft' }],
  ['near_destination', {}], ['passenger_inactive', { seat: 'front', duration_ms: 30000, source: 'participation_monitor' }],
]) {
  const state = snapshot(type, extra);
  if (type === 'speed_overspeed') state.car.speed = 130;
  if (type === 'driver_tired') state.passengers.states.driver = '疲惫';
  if (type === 'passenger_sleep') state.passengers.states.rearLeft = '睡着';
  if (type === 'passenger_inactive') {
    state.event.priority = 'P4';
    state.participation = { seat: 'front', version: 1, inactive_duration_ms: 30000,
      dialogue_silence_ms: 5000, remaining_ms: 50000, real_user_turn_count: 0, invitation_declined: false };
  }
  const analysis = await run(`${type}-analysis`, 'situation', state);
  assert.equal(analysis.scene.analysis_status, 'ready');
  if (state.event.priority === 'P1') {
    assert.equal(analysis.report.model_calls, 0); assert.equal(analysis.scene.request_proactive_speech, true);
  }
  if (analysis.scene.request_proactive_speech) {
    state.dialogue_request = { kind: 'situation_event', event_id: state.event.id };
    const result = await run(`${type}-speech`, 'dialogue', state, analysis.scene, `座舱事件：${type}，请回应本次事件。`);
    assertHost(result); assert.deepEqual(result.host.execution.actions, []);
    assert.deepEqual(result.host.covered_fact_keys, []);
    if (type === 'passenger_inactive') assert.equal(result.host.debug.event_context?.valid ?? true, true);
  }
}

const brake = snapshot('hard_brake'); brake.event.priority = 'P0'; brake.game.status = 'paused';
const safety = await run('p0-safety-background', 'situation', brake);
assert.equal(safety.report.model_calls, 0); assert.equal(safety.scene.request_proactive_speech, false);
const correct = await run('correct-answer-rule', 'dialogue', snapshot(null), {}, '海豚');
assert.equal(correct.report.model_calls, 0); assert.equal(correct.host.is_correct, true);
}

let memoryState = snapshot(null, {}, '安全带');
const name = await run('memory-name', 'dialogue', memoryState, {}, '我叫小橙，请记住。'); assertHost(name);
memoryState = { ...memoryState, round_id: `${prefix}-round-2`, round_context: { previous_game_id: prefix, previous_round_id: `${prefix}-round-1` },
  game: { ...memoryState.game, round_index: 2, current_answer: '海豚' } };
const next = await run('memory-new-round', 'dialogue', memoryState, {}, '它是人造的吗？', name.conversation);
assertHost(next); assert.match(next.host.ai_reply_text, /^(不是|不|否)/); assert.equal(next.conversation.id, name.conversation.id);
const remembered = await run('memory-retained-name', 'dialogue', memoryState, {}, '还记得我叫什么吗？', next.conversation);
assertHost(remembered); assert.match(remembered.host.ai_reply_text, /小橙/);
if (memoryOnly) {
  console.log(JSON.stringify({ passed: true, phase: 'memory-only', hashes, case_count: reports.length }));
  process.exit(0);
}
for (const [index, query] of ['把背景音乐打开', '把背景音乐关闭'].entries()) {
  const result = await run(`music-${index}`, 'dialogue', snapshot(null), {}, query); assertHost(result);
  assert.deepEqual(result.host.execution.actions.map(({ type, enabled }) => ({ type, enabled })),
    [{ type: 'music.set_enabled', enabled: index === 0 }]);
}

for (const [index, answer] of ['安全带', '雨伞', '米老鼠'].entries()) {
  const state = snapshot(null, {}, answer);
  state.round_question_plan_request = { step_count: 4, persona_age_groups: ['adult'], variant_groups: ['default', 'adult'] };
  const preview = await run(`preview-${index}`, 'preview', state);
  assert.ok(['ready', 'partial', 'failed'].includes(preview.preview.preview_status), `preview-${index}: missing diagnostic`);
  if (preview.preview.preview_status !== 'ready') {
    const diagnostic = preview.preview.preview_diagnostic;
    assert.equal(diagnostic.repairable, true);
    state.round_question_plan_request.repair = { attempt: 1,
      plan_id: preview.preview.round_question_plan.plan_id,
      accepted_steps: preview.preview.round_question_plan.steps,
      validation_errors: diagnostic.validation_errors };
    const repaired = await run(`preview-repair-${index}`, 'preview', state);
    assert.equal(repaired.preview.preview_status, 'ready');
  }
}

const draft = await request(`/apps/${apps.dialogue}/workflows/draft`);
let currentHash = draft.hash;
try {
  for (const mode of ['force-retry-both-valid', 'force-content-conflict', 'force-primary-failure', 'force-both-failure', 'force-model-exception']) {
    const graph = structuredClone(draft.graph);
    if (mode === 'force-retry-both-valid') {
      graph.nodes.find(node => node.id === '1000000000022').data.cases[0].conditions[0].value = false;
    } else if (mode === 'force-content-conflict') {
      graph.nodes.find(node => node.id === '1000000000021').data.code += `
_before_injected_conflict = main
def main(director_text: str, payload: str = "", director_context: str = "") -> dict:
    value = {"intent":"event","reply_mode":"chat_only","ai_reply_text":"副驾要不要一起猜一问？","covered_fact_keys":[],"execution_actions":[],"strategy":"invite_collaboration","target_seat":None,"reason_codes":[],"applied_knowhow_ids":[]}
    return _before_injected_conflict(json.dumps(value, ensure_ascii=False), value, payload, director_context)
`;
    } else {
      graph.nodes.find(node => node.id === '1000000000005').data.model.completion_params.max_tokens = mode === 'force-model-exception' ? 0 : 1;
      if (mode === 'force-both-failure') graph.nodes.find(node => node.id === '1000000000023').data.model.completion_params.max_tokens = 1;
    }
    currentHash = (await saveGraph('dialogue', graph, currentHash)).hash;
    const input = originalEnvironment();
    const result = await run(mode, 'dialogue', input.state, input.scene, input.query, null,
      mode === 'force-model-exception' ? 'partial-succeeded' : 'succeeded');
    assert.equal(result.report.model_calls, 2);
    assert.equal(result.report.retries, 1);
    if (mode === 'force-both-failure') {
      assert.equal(result.host.ai_reply_text, ''); assert.equal(result.host.debug.model_output_status, 'retry_exhausted');
      assert.equal(result.host.decision_trace.guard_status, 'event_reply_skipped');
      assert.deepEqual(result.host.covered_fact_keys, []); assert.equal(result.host.is_correct, false);
    } else {
      assertHost(result);
      if (mode === 'force-retry-both-valid') assert.ok(result.host.debug.model_attempts.every(attempt => attempt.status === 'valid'));
      if (mode === 'force-content-conflict') assert.match(result.host.debug.model_attempts[0].reason_codes.join(','), /content_guard/);
    }
  }
} finally {
  const restored = await saveGraph('dialogue', draft.graph, currentHash);
  assert.equal(restored.hash, hashes.dialogue);
}
for (const [kind, id] of Object.entries(apps)) {
  assert.equal((await request(`/apps/${id}/workflows/draft`)).hash, hashes[kind]);
}
save('verification.json', { passed: true, hashes, checked_at: new Date().toISOString(), reports });
console.log(JSON.stringify({ passed: true, case_count: reports.length, hashes }));
