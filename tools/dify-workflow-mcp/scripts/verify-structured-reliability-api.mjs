import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { save } from './update-structured-reliability.mjs';

const base = process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186';
const id = `published-stability-${randomUUID()}`;
const reports = [];
let conversationId = '';
const snapshot = { trigger_type: 'event', game_id: id, round_id: `${id}-round-1`, scene_version: `${id}-scene-1`,
  game: { status: 'playing', round_index: 1, total_rounds: 10, current_answer: '海豚', max_questions: 15, question_count: 0 },
  car: { environment: '高速路晴天白天', speed: 80, destination: '学校' },
  passengers: { selected_seat: 'front', states: { driver: '普通', front: '普通', rearLeft: '普通', rearRight: '普通' } },
  event: { id: `${id}-env`, type: 'environment_change', priority: 'P1', value: '高速路晴天白天', previous_value: '车库' } };

async function call(name, route, state, options = {}) {
  const started = Date.now();
  const response = await fetch(`${base}/api/workflow`, { method: 'POST', signal: AbortSignal.timeout(65000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route, input_payload: state,
      user_id: id, conversation_id: route === 'chat' ? conversationId : '', ...options }) });
  const result = await response.json();
  assert.equal(response.status, 200, `${name}: ${result.error || result.message}`);
  if (result.conversation_id) {
    if (conversationId) assert.equal(result.conversation_id, conversationId);
    conversationId = result.conversation_id;
  }
  const host = result.host_result;
  const row = { name, route, elapsed_ms: Date.now() - started, workflow_run_id: result.workflow_run_id,
    model_output_status: result.diagnostic?.model_output_status, retries: result.diagnostic?.model_retry_count,
    guard_status: host?.decision_trace?.guard_status, context_verified: result.context_verified,
    speech: host?.ai_reply_text, preview_status: result.preview_status, analysis_status: result.scene_output?.analysis_status };
  reports.push(row); console.log(JSON.stringify(row));
  save('published-api-progress.json', { checked_at: new Date().toISOString(), reports });
  if (route === 'chat') {
    assert.equal(result.context_verified, true);
    assert.ok(['passed', 'hint_blocked'].includes(host.decision_trace.guard_status));
    assert.doesNotMatch(host.ai_reply_text, /<\/?think\b/);
    if (options.query !== state.game.current_answer) assert.ok(!host.ai_reply_text.includes(state.game.current_answer));
    if (result.diagnostic?.model_output_status === 'valid') {
      assert.ok(result.diagnostic.model_attempts.some(attempt => attempt.status === 'valid' && attempt.source === 'text'),
        `${name}: published API is not using the verified final-text validation path`);
    }
  }
  return result;
}

async function eventSpeech(name, state) {
  const analysis = await call(`${name}-analysis`, 'situation', state);
  assert.equal(analysis.scene_output.request_proactive_speech, true);
  assert.equal(analysis.scene_output.host_response, null);
  const result = await call(`${name}-speech`, 'chat', { ...state,
    dialogue_request: { kind: 'situation_event', event_id: state.event.id } }, {
    operation: 'situation_reply', situation_handoff: analysis.situation_handoff,
  });
  assert.ok(result.host_result.ai_reply_text);
  assert.deepEqual(result.host_result.covered_fact_keys, []);
  assert.deepEqual(result.host_result.execution.actions, []);
  return result;
}

const environment = await eventSpeech('original-environment', snapshot);
assert.match(environment.host_result.ai_reply_text, /高速/);
const question = { ...snapshot, event: null, trigger_type: 'chat', player_input: '它是人造的吗？' };
assert.match((await call('ordinary-question', 'chat', question, { query: question.player_input })).host_result.ai_reply_text, /^(不是|不|否)/);
assert.match((await call('remember-name', 'chat', question, { query: '我叫小橙，请记住。' })).host_result.ai_reply_text, /小橙/);
assert.equal((await call('previous-round-revealed', 'chat', question, { query: '海豚' })).host_result.is_correct, true);
const next = { ...question, round_id: `${id}-round-2`, scene_version: `${id}-scene-2`,
  round_context: { previous_game_id: id, previous_round_id: snapshot.round_id },
  game: { ...question.game, round_index: 2, current_answer: '安全带' } };
assert.match((await call('new-round', 'chat', next, { query: '它是人造的吗？' })).host_result.ai_reply_text, /^(是|对)/);
assert.match((await call('retain-name', 'chat', next, { query: '还记得我叫什么吗？' })).host_result.ai_reply_text, /小橙/);
const newGame = { ...question, game_id: `${id}-new`, round_id: `${id}-new-round-1`, scene_version: `${id}-new-scene`,
  round_context: { previous_game_id: id, previous_round_id: next.round_id } };
assert.match((await call('new-game-same-conversation', 'chat', newGame, { query: '它是人造的吗？' })).host_result.ai_reply_text, /^(不是|不|否)/);

const inactive = { ...snapshot, event: { id: `${id}-inactive`, type: 'passenger_inactive', priority: 'P4',
  seat: 'front', source: 'participation_monitor', duration_ms: 30000 },
  participation: { seat: 'front', version: 1, inactive_duration_ms: 30000, dialogue_silence_ms: 5000,
    remaining_ms: 50000, real_user_turn_count: 0, invitation_declined: false } };
await eventSpeech('awake-passenger-invitation', inactive);
const brake = await call('p0-background-only', 'situation', { ...snapshot,
  game: { ...snapshot.game, status: 'paused' }, event: { id: `${id}-brake`, type: 'hard_brake', priority: 'P0' } });
assert.equal(brake.scene_output.request_proactive_speech, false);
assert.equal(brake.situation_handoff, null);

const previewState = { ...snapshot, event: { id: `${id}-preview`, type: 'start_game', priority: 'P3' },
  game: { ...snapshot.game, current_answer: '安全带' },
  round_question_plan_request: { step_count: 4, persona_age_groups: ['adult'] } };
let preview = await call('preview', 'preview', previewState);
let previewPrefix = [];
if (preview.preview_status !== 'ready') {
  const result = typeof preview.workflow_output === 'string' ? JSON.parse(preview.workflow_output) : preview.workflow_output;
  const plan = preview.round_question_plan || result.round_question_plan;
  const diagnostic = preview.preview_diagnostic || result.preview_diagnostic;
  assert.equal(diagnostic.repairable, true);
  assert.ok(result.preview_repair);
  previewPrefix = plan.steps;
  // Use the same validated repair envelope as the browser, not its display-only plan.
  previewState.round_question_plan_request.repair = result.preview_repair;
  preview = await call('preview-repair', 'preview', previewState);
  assert.equal(preview.preview_diagnostic.repairable, false);
}
const finalPreview = typeof preview.workflow_output === 'string' ? JSON.parse(preview.workflow_output) : preview.workflow_output;
assert.ok(['ready', 'partial'].includes(preview.preview_status));
assert.ok(finalPreview.round_question_plan.steps.length > 0);
assert.deepEqual(finalPreview.round_question_plan.steps.slice(0, previewPrefix.length), previewPrefix);
assert.ok(!preview.preview_diagnostic.validation_errors.includes('accepted_prefix_invalid'));
assert.ok(!preview.preview_diagnostic.validation_errors.includes('accepted_prefix_changed'));
save('published-api-verification.json', { passed: true, checked_at: new Date().toISOString(),
  same_conversation: true, independent_test_user: true, preview_status: preview.preview_status, reports });
console.log(JSON.stringify({ passed: true, request_count: reports.length, same_conversation: true,
  preview_status: preview.preview_status }));
