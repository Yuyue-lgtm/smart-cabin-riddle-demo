import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
const url = process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/';
const id = randomUUID(), user = `cabin-policy-live-${id}`;
let conversation = '';
const snapshot = { game_id: user, round_id: `${user}-round-1`, scene_version: `sv-${id}`, p0_epoch: 0,
  trigger_type: 'chat', game: { status: 'playing', current_answer: '海豚', round_index: 1, question_count: 3, max_questions: 15,
    public_clues: ['它不是人造的。', '它生活在水里。'] },
  car: { speed: 50, environment: '城区晴天白天' },
  passengers: { selected_seat: 'front', states: { driver: 'normal', front: 'normal', rearLeft: 'normal', rearRight: 'normal' } } };
async function post(input, extra = {}) {
  const response = await fetch(new URL('/api/workflow', url), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: user, conversation_id: conversation, input_payload: JSON.stringify(input), ...extra }), signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  if (body.conversation_id) conversation = body.conversation_id;
  return body;
}
const reports = [];
for (const query of ['给我一点提示', '关闭副驾灯光', '我好冷', '还有多久到', '换个主题']) {
  const response = await post({ ...snapshot, player_input: query }, { route: 'chat' });
  const output = JSON.parse(response.workflow_output);
  assert.equal(output.decision_trace.guard_status, 'passed');
  assert.ok(!output.ai_reply_text.includes('海豚'));
  assert.deepEqual(output.covered_fact_keys, []);
  if (query === '给我一点提示') {
    assert.match(output.ai_reply_text, /它生活在水里/);
    assert.doesNotMatch(output.ai_reply_text, /已公开回答|已公开：/);
  }
  if (query === '关闭副驾灯光') assert.deepEqual(output.execution.actions, [{ type: 'cabin.set_zone_light', seat: 'front', enabled: false }]);
  else assert.deepEqual(output.execution.actions, []);
  reports.push({ query, run_id: response.workflow_run_id, speech: output.ai_reply_text, actions: output.execution.actions });
  console.log(JSON.stringify(reports.at(-1)));
}
const distracted = structuredClone(snapshot);
distracted.trigger_type = 'event'; distracted.passengers.states.driver = 'distracted';
distracted.event = { id: `distracted-${id}`, type: 'driver_distracted', priority: 'P1', state: 'distracted', seat: 'driver' };
const analysis = await post(distracted, { route: 'situation' });
assert.equal(analysis.scene_output.analysis_status, 'ready');
assert.equal(analysis.scene_output.request_proactive_speech, true);
assert.ok(analysis.scene_output.perception.signals.some(signal => signal.field === 'driver_state' && signal.value === '分心'));
const reply = await post({ ...distracted, dialogue_request: { kind: 'situation_event', event_id: distracted.event.id } },
  { route: 'chat', operation: 'situation_reply', situation_handoff: analysis.situation_handoff });
const host = JSON.parse(reply.workflow_output);
assert.equal(host.decision_trace.guard_status, 'passed'); assert.deepEqual(host.execution.actions, []);
assert.ok(host.perception.signals.some(signal => signal.field === 'driver_state' && signal.value === '分心'));
reports.push({ event: 'driver_distracted', situation_run_id: analysis.workflow_run_id, run_id: reply.workflow_run_id, speech: host.ai_reply_text });
const paused = { ...snapshot, trigger_type: 'event', game: { ...snapshot.game, status: 'paused' },
  event: { id: `interruption-${id}`, type: 'temporary_interruption', priority: 'P0' } };
const observation = await post(paused, { route: 'situation' });
assert.equal(observation.scene_output.request_proactive_speech, false);
reports.push({ event: 'temporary_interruption', run_id: observation.workflow_run_id, speech: null });
fs.writeFileSync('tmp/dify-import/cabin-policy/api-verification.json', JSON.stringify({ passed: true, reports, checked_at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
console.log('PASS: published API public recap, light permission, unsupported requests, distraction handoff and local-only interruption.');
