import fs from 'node:fs';
import assert from 'node:assert/strict';

const stamp = Date.now();
const scope = { game_id: `experience-api-${stamp}`, round_id: `experience-api-${stamp}-round-6`, scene_version: 'experience-api-v2' };
const state = { ...scope, trigger_type: 'event',
  game: { status: 'victory', round_index: 6, total_rounds: 10, current_answer: '海豚', current_theme: '动物' },
  passengers: { selected_seat: 'front', states: { driver: 'awake', front: 'awake', rearLeft: 'awake', rearRight: 'awake' } },
  host_preferences: { praise: true, brief: false, invitations: true, independent: false },
  performance: { completed_rounds: 6, team_correct: 6, per_seat_correct: { front: 6 }, streak_seat: 'front', streak_count: 6,
    last_result: { round_index: 6, correct_seat: 'front', contributors: ['front'] } },
  host_feedback: { id: `feedback-${stamp}`, subject_seat: 'front', selected_id: 'HK12', candidate_ids: ['HK12', 'HK10'],
    personal_correct: 6, team_correct: 6, streak_count: 6, contributors: ['front'] },
  event: { id: `feedback-${stamp}`, type: 'post_result_feedback', priority: 'P4', source: 'performance_monitor' } };
let conversationId = '';
async function run(route, input, extra = {}) {
  const response = await fetch(`${process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186'}/api/workflow`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ route, input_payload: JSON.stringify(input), user_id: `experience-api-user-${stamp}`, conversation_id: conversationId, ...extra }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error || result.message);
  assert.equal(result.route, route);
  if (result.conversation_id) conversationId = result.conversation_id;
  return result;
}
const feedback = await run('situation', state);
const host = JSON.parse(feedback.workflow_output);
assert.equal(feedback.scene_output.request_proactive_speech, true);
assert.equal(host.scene_output.feedback_id, state.host_feedback.id);
assert.equal(feedback.cached, false);
assert.equal(host.decision_trace.guard_status, 'passed');
assert.equal(feedback.scene_output.host_response, null);
assert.equal(host.ai_reply_text, '');
assert.ok(host.retrieved_knowhow.some(row => row.knowhow_id === 'HK12'));
assert.equal(host.execution.actions.length, 0);
const spokenFeedback = await run('chat', { ...state, dialogue_request: { kind: 'situation_event', event_id: state.event.id } },
  { operation: 'situation_reply', situation_handoff: feedback.situation_handoff });
assert.equal(spokenFeedback.host_result.decision_trace.guard_status, 'passed');
assert.ok(spokenFeedback.host_result.ai_reply_text && !spokenFeedback.host_result.ai_reply_text.includes('海豚'));
const chatInput = { ...state, trigger_type: 'chat', player_input: '我刚答对了，夸一下我', event: null };
const chat = await run('chat', chatInput);
assert.equal(chat.context_verified, true);
assert.equal(chat.host_result.is_correct, false);
assert.equal(chat.host_result.ui_change.show_answer, false);
assert.ok(chat.host_result.ai_reply_text && !chat.host_result.ai_reply_text.includes('海豚'));
assert.ok(chat.host_result.debug.model_attempts.length);
const report = { passed: true, checked_at: new Date().toISOString(),
  feedback: { run_id: feedback.workflow_run_id, chat_run_id: spokenFeedback.workflow_run_id,
    text: spokenFeedback.host_result.ai_reply_text, applied: spokenFeedback.host_result.applied_knowhow_ids },
  chat: { run_id: chat.workflow_run_id, text: chat.host_result.ai_reply_text, context_verified: chat.context_verified } };
fs.writeFileSync(new URL('../../../tmp/dify-import/host-experiences/api-verification.json', import.meta.url), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
