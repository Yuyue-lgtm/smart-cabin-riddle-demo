import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const url = process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/';
const id = randomUUID();
const snapshot = {
  game_id: `comfort-live-${id}`, round_id: `comfort-live-${id}-round-1`, scene_version: `sv-${id}`, p0_epoch: 0,
  trigger_type: 'event', game: { status: 'playing', current_answer: '海豚', round_index: 1, question_count: 2, max_questions: 15 },
  car: { speed: 50, environment: '风景区晴天深夜', destination: '酒店' },
  passengers: { selected_seat: 'front', states: { driver: '普通', front: '普通', rear_left: '普通', rear_right: '睡着' } },
  event: { id: `sleep-${id}`, type: 'passenger_sleep', seat: 'rearRight', priority: 'P2', source: 'regression_test' },
};
async function post(body) {
  const response = await fetch(new URL('/api/workflow', url), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, user_id: `comfort-live-${id}` }), signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200);
  return response.json();
}
const analysis = await post({ route: 'situation', input_payload: JSON.stringify(snapshot) });
const scene = analysis.scene_output;
assert.equal(scene.analysis_status, 'ready');
const report = { situation_run_id: analysis.workflow_run_id, proactive: scene.request_proactive_speech, request_host_decision: scene.request_host_decision };
assert.equal(scene.request_host_decision, true);
function checkDeviceSpeech(output) {
  assert.ok(output.ai_reply_text);
  for (const pattern of [/灯/u, /空调|温度/u, /音量|声音|静音/u]) assert.match(output.ai_reply_text, pattern);
}
if (scene.request_proactive_speech || scene.request_host_decision) {
  assert.ok(analysis.situation_handoff);
  const input = { ...snapshot, dialogue_request: { kind: 'situation_event', event_id: snapshot.event.id } };
  const response = await post({ route: 'chat', operation: 'situation_reply', situation_handoff: analysis.situation_handoff,
    input_payload: JSON.stringify(input) });
  const output = JSON.parse(response.workflow_output);
  assert.equal(output.decision_trace.guard_status, 'passed');
  assert.deepEqual(output.execution.actions, [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }]);
  assert.match(output.ai_reply_text, /记忆/);
  assert.doesNotMatch(output.ai_reply_text, /关闭空调|空调关闭/);
  report.chat_run_id = response.workflow_run_id;
  report.actions = output.execution.actions;
  report.speech = output.ai_reply_text;
  checkDeviceSpeech(output);
  const second = structuredClone(snapshot);
  second.scene_version = `sv-second-sleep-${id}`;
  second.event = { ...snapshot.event, id: `sleep-second-${id}`, seat: 'rearLeft' };
  second.passengers.states.rear_left = '睡着';
  second.car.sleep_comfort_seats = ['rearRight'];
  second.car.zone_lights = { driver: true, front: true, rearLeft: true, rearRight: false };
  const secondAnalysis = await post({ route: 'situation', input_payload: JSON.stringify(second) });
  const secondResponse = await post({ route: 'chat', operation: 'situation_reply', situation_handoff: secondAnalysis.situation_handoff,
    conversation_id: response.conversation_id,
    input_payload: JSON.stringify({ ...second, dialogue_request: { kind: 'situation_event', event_id: second.event.id } }) });
  const secondOutput = JSON.parse(secondResponse.workflow_output);
  assert.equal(secondOutput.decision_trace.guard_status, 'passed');
  assert.deepEqual(secondOutput.execution.actions, [{ type: 'cabin.apply_sleep_comfort', seat: 'rearLeft' }]);
  assert.match(secondOutput.ai_reply_text, /记忆/);
  checkDeviceSpeech(secondOutput);
  report.second_sleep = { situation_run_id: secondAnalysis.workflow_run_id, chat_run_id: secondResponse.workflow_run_id,
    actions: secondOutput.execution.actions, speech: secondOutput.ai_reply_text };
  const wakeSnapshot = structuredClone(snapshot);
  wakeSnapshot.scene_version = `sv-wake-${id}`;
  wakeSnapshot.event = { id: `wake-${id}`, type: 'passenger_wake', seat: 'rearRight', priority: 'P3', source: 'regression_test' };
  wakeSnapshot.passengers.states.rear_right = '普通';
  wakeSnapshot.car.sleep_comfort_seats = ['rearRight'];
  const wakeAnalysis = await post({ route: 'situation', input_payload: JSON.stringify(wakeSnapshot) });
  assert.equal(wakeAnalysis.scene_output.analysis_status, 'ready');
  assert.equal(wakeAnalysis.scene_output.request_host_decision, true);
  assert.ok(wakeAnalysis.situation_handoff);
  const wakeInput = { ...wakeSnapshot, dialogue_request: { kind: 'situation_event', event_id: wakeSnapshot.event.id } };
  const wakeResponse = await post({ route: 'chat', operation: 'situation_reply', situation_handoff: wakeAnalysis.situation_handoff,
    conversation_id: response.conversation_id, input_payload: JSON.stringify(wakeInput) });
  const wakeOutput = JSON.parse(wakeResponse.workflow_output);
  assert.equal(wakeOutput.decision_trace.guard_status, 'passed');
  assert.deepEqual(wakeOutput.execution.actions, [{ type: 'cabin.restore_sleep_comfort', seat: 'rearRight' }]);
  checkDeviceSpeech(wakeOutput);
  report.wake = { situation_run_id: wakeAnalysis.workflow_run_id, chat_run_id: wakeResponse.workflow_run_id,
    same_conversation: wakeResponse.conversation_id === response.conversation_id,
    actions: wakeOutput.execution.actions, speech: wakeOutput.ai_reply_text };
  assert.equal(report.wake.same_conversation, true);
}
fs.writeFileSync('tmp/dify-import/sleep-comfort/api-verification.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report));
