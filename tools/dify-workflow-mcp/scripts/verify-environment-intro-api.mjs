import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handleWorkflowBody } from '../../../api/dify-bff.js';

const user = `environment-intro-verification-${Date.now()}`;
const reports = [];
let conversation = '';
for (const [index, environment, answer, theme] of [
  [2, '风景区雪景白天', '雪人', '雪景'],
  [3, '城区雨天白天', '雨伞', '雨天'],
  [4, '城区晴天白天', '红绿灯', '城区'],
]) {
  const input = { game_id: user, round_id: `${user}-round-${index}`, scene_version: `intro-v${index}`,
    trigger_type: 'event', p0_epoch: 0, player_input: '', dialogue_request: { kind: 'environment_round_intro' },
    event: { id: `intro-${index}`, type: 'round_changed', source: 'environment_riddle', priority: 'P3', value: environment },
    game: { status: 'playing', round_index: index, question_count: 0, current_answer: answer, current_theme: theme, max_questions: 15 },
    car: { environment, speed: 50 },
    passengers: { selected_seat: 'front', states: { driver: 'normal', front: 'normal', rear_left: 'normal', rear_right: 'normal' } } };
  const started = Date.now();
  const result = await handleWorkflowBody({ route: 'chat', operation: 'environment_round_intro',
    user_id: user, conversation_id: conversation, input_payload: JSON.stringify(input) });
  const payload = result.payload;
  const output = payload.host_result;
  const report = { environment, status: result.status, elapsed_ms: Date.now() - started,
    operation: payload.operation, reply: output?.ai_reply_text, guard: output?.decision_trace?.guard_status,
    run_id: payload.workflow_run_id, conversation_id: payload.conversation_id, diagnostic: payload.diagnostic, error: payload.error };
  reports.push(report);
  fs.mkdirSync('tmp/environment-round-intro', { recursive: true });
  fs.writeFileSync('tmp/environment-round-intro/live-verification.json', JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(report));
  assert.equal(result.status, 200);
  assert.equal(payload.operation, 'environment_round_intro');
  assert.equal(output.intent, 'event');
  assert.equal(output.decision_trace.guard_status, 'passed');
  assert.ok(output.ai_reply_text && output.ai_reply_text.length <= 100 && !output.ai_reply_text.includes(answer));
  assert.deepEqual(output.execution.actions, []);
  assert.deepEqual(output.covered_fact_keys, []);
  conversation = payload.conversation_id;
}
