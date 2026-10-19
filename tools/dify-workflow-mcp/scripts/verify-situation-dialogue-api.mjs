import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186';
const stamp = Date.now(), reports = [];
const user = `serial-independent-api-${stamp}`;
let conversationId = '';
const state = { trigger_type: 'event', game_id: `serial-api-${stamp}`, round_id: `serial-api-${stamp}-1`, scene_version: 'serial-api-1',
  game: { status: 'playing', round_index: 1, total_rounds: 10, current_answer: '海豚', max_questions: 15, question_count: 0 },
  car: { environment: '城区晴天白天', speed: 80, destination: '学校' },
  passengers: { selected_seat: 'front', states: { driver: '普通', front: '普通', rearLeft: '普通', rearRight: '普通' } },
  event: { id: `serial-api-env-${stamp}`, type: 'environment_change', priority: 'P1', value: '城区晴天白天', previous_value: '车库' } };

async function call(route, input, extra = {}) {
  const started = Date.now();
  const response = await fetch(`${base}/api/workflow`, { method: 'POST', signal: AbortSignal.timeout(65000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route, input_payload: input,
      user_id: user, conversation_id: conversationId, ...extra }) });
  const result = await response.json();
  assert.equal(response.status, 200, result.error || result.message);
  if (result.conversation_id) {
    if (conversationId) assert.equal(result.conversation_id, conversationId);
    conversationId = result.conversation_id;
  }
  reports.push({ route, operation: extra.operation || '', event_type: input.event?.type,
    elapsed_ms: Date.now() - started, workflow_run_id: result.workflow_run_id, text: result.host_result?.ai_reply_text || '',
    analysis_status: result.scene_output?.analysis_status, context_verified: result.context_verified });
  console.log(JSON.stringify(reports.at(-1)));
  return result;
}

async function eventReply(input) {
  const analysis = await call('situation', input);
  assert.equal(analysis.scene_output.host_response, null);
  assert.equal(JSON.parse(analysis.workflow_output).ai_reply_text, '');
  assert.equal(analysis.scene_output.request_proactive_speech, true);
  if (input.event.type === 'passenger_inactive') {
    assert.equal(analysis.scene_output.participation_version, input.participation.version);
    assert.ok(analysis.scene_output.retrieved_knowhow.some(row => row.knowhow_id === 'HK28'));
  }
  const reply = await call('chat', { ...input, dialogue_request: { kind: 'situation_event', event_id: input.event.id } }, {
    operation: 'situation_reply', situation_handoff: analysis.situation_handoff,
  });
  assert.equal(reply.operation, 'situation_reply');
  assert.equal(reply.context_verified, true);
  assert.equal(reply.host_result.decision_trace.guard_status, 'passed');
  assert.equal(reply.host_result.is_correct, false);
  assert.deepEqual(reply.host_result.covered_fact_keys, []);
  assert.deepEqual(reply.host_result.execution.actions, []);
  assert.ok(reply.host_result.ai_reply_text && !reply.host_result.ai_reply_text.includes('海豚'));
  if (input.event.type === 'passenger_inactive') {
    assert.equal(reply.host_result.strategy, 'invite_collaboration');
    assert.ok(!/\d+\s*(秒|毫秒)|沉默了|一直没说话/.test(reply.host_result.ai_reply_text));
  }
  return reply;
}

const first = await eventReply(state);
assert.match(first.host_result.ai_reply_text, /市区|城区/);
const answer = await call('chat', { ...state, trigger_type: 'chat', event: null, player_input: '它是人造的吗？' }, { query: '它是人造的吗？' });
assert.match(answer.host_result.ai_reply_text, /不是|^不/);
state.scene_version = 'serial-api-2'; state.car.environment = '隧道';
state.event = { ...state.event, id: `serial-api-tunnel-${stamp}`, value: '隧道', previous_value: '城区晴天白天' };
const tunnel = await eventReply(state);
assert.match(tunnel.host_result.ai_reply_text, /隧道/);
state.scene_version = 'serial-api-participation';
state.passengers.states.front = '普通';
state.participation = { seat: 'front', version: 19, inactive_duration_ms: 37506,
  dialogue_silence_ms: 2589, remaining_ms: 52494, real_user_turn_count: 0, invitation_declined: false };
state.event = { id: `serial-api-inactive-${stamp}`, type: 'passenger_inactive', priority: 'P4',
  seat: 'front', source: 'participation_monitor' };
const invitation = await eventReply(state);
assert.match(invitation.host_result.ai_reply_text, /副驾|来猜|随时/);
const brake = await call('situation', { ...state, game: { ...state.game, status: 'paused' },
  event: { id: `serial-api-brake-${stamp}`, type: 'hard_brake', priority: 'P0' } });
assert.equal(brake.scene_output.request_proactive_speech, false);
assert.equal(brake.situation_handoff, null);
fs.writeFileSync(new URL('../../../tmp/dify-import/situation-dialogue/api-verification.json', import.meta.url),
  JSON.stringify({ passed: true, checked_at: new Date().toISOString(), same_conversation: true, reports }, null, 2), { mode: 0o600 });
console.log('PASS: published API, sequential event replies, same-conversation ordinary question and new environment, P0 analysis-only.');
