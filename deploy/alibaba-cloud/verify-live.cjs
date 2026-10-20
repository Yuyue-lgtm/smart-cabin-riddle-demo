const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const base = process.argv[2] || 'http://127.0.0.1:4173';
const testing = process.argv.includes('--test');
const id = `ecs-acceptance-${Date.now()}`;
const user = `${id}-fictional-user`;
const report = [];
const snapshot = {
  game_id: id, round_id: `${id}-round-1`, scene_version: `${id}-scene-1`, p0_epoch: 0,
  trigger_type: 'chat', player_input: '',
  car: { speed: 80, environment: '高速路晴天白天', destination: '模拟目的地', sleep_comfort_seats: [],
    zone_lights: { driver: true, front: true, rearLeft: true, rearRight: true } },
  passengers: { relationship: 'family', selected_seat: 'front', selected_seat_label: '副驾', user_seat: 'front',
    states: { driver: '普通', front: '普通', rear_left: '普通', rear_right: '普通' } },
  game: { status: 'playing', round_index: 1, total_rounds: 6, question_count: 0, max_questions: 15,
    current_answer: '安全带', current_theme: '日常用品', covered_fact_keys: [], asked_questions: [], public_clues: [] },
  perception: {}, host_preferences: {},
  interaction: { current_speaker: 'front', current_speaker_label: '副驾', user_seat: 'front',
    speaker_source: 'real_user', recent_messages: [], suppress_passenger_action: true },
};

async function request(label, body) {
  const started = Date.now();
  const response = await fetch(`${base}/api/workflow`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, user_id: user }),
    signal: AbortSignal.timeout(75000) });
  const output = await response.json();
  const row = { label, http: response.status, elapsed_ms: Date.now() - started, route: output.route,
    app_id: output.app_id, workflow_run_id: output.workflow_run_id, error: output.error };
  report.push(row);
  assert.equal(response.status, 200, `${label}: ${output.error || response.status}`);
  return output;
}

function validateHost(result) {
  assert.equal(result.route, 'chat');
  assert.equal(result.context_verified, true);
  assert.equal(result.host_result.decision_trace.guard_status, 'passed');
  assert.ok(result.host_result.ai_reply_text.trim());
  assert.doesNotMatch(result.host_result.ai_reply_text, /安全带|<think>|context_scope|execution_actions/);
  return result.host_result;
}

async function situation(type, priority, extra = {}, chat = true) {
  const input = { ...structuredClone(snapshot), ...extra, trigger_type: 'event', player_input: '',
    event: { id: `${id}-${type}`, type, priority, source: 'manual', ...(extra.event || {}) } };
  const analysis = await request(type, { route: 'situation', input_payload: input });
  assert.equal(analysis.route, 'situation');
  assert.equal(analysis.scene_output.host_response, null);
  if (!chat) {
    assert.equal(analysis.situation_handoff, null);
    assert.equal(analysis.scene_output.request_proactive_speech, false);
    return;
  }
  assert.ok(analysis.situation_handoff, `${type}: no handoff`);
  const result = await request(`${type}_reply`, { route: 'chat', operation: 'situation_reply',
    input_payload: input, situation_handoff: analysis.situation_handoff });
  const host = validateHost(result);
  if (type === 'passenger_sleep' || type === 'passenger_wake') {
    const action = type === 'passenger_sleep' ? 'cabin.apply_sleep_comfort' : 'cabin.restore_sleep_comfort';
    assert.ok(host.execution.actions.some(item => item.type === action && item.seat === 'rearRight'));
  }
}

(async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.runtime, testing ? 'local' : 'production');
  if (testing) {
    const profiles = require('../../dify/environments.json');
    const apps = profiles.environments['alibaba-test'].apps;
    assert.equal(health.workflow_proxy.environment, 'alibaba-test');
    assert.equal(health.workflow_proxy.chatflow_app_id, apps.host);
    assert.equal(health.workflow_proxy.situation_app_id, apps.situation);
    assert.equal(health.workflow_proxy.preview_app_id, apps.preview);
  }
  assert.ok(health.workflow_proxy.chatflow_configured && health.workflow_proxy.situation_configured && health.workflow_proxy.preview_configured);
  const first = await request('passenger_question', { route: 'chat', input_payload: {
    ...snapshot, player_input: '当前这道题，它是人造的吗？' } });
  validateHost(first);
  assert.match(first.host_result.ai_reply_text, /是|人造|制造/);
  const second = await request('same_conversation', { route: 'chat', conversation_id: first.conversation_id,
    input_payload: { ...snapshot, player_input: '我想自己再想想。' } });
  validateHost(second);
  assert.equal(second.conversation_id, first.conversation_id);
  await situation('environment_change', 'P1', { event: { previous_value: '车库', value: '高速路晴天白天' } });
  await situation('hard_brake', 'P0', { p0_epoch: 1, game: { ...snapshot.game, status: 'paused' } }, false);
  await situation('passenger_sleep', 'P2', { scene_version: `${id}-sleep`,
    passengers: { ...snapshot.passengers, states: { ...snapshot.passengers.states, rear_right: '睡着' } }, event: { seat: 'rearRight' } });
  await situation('passenger_wake', 'P3', { scene_version: `${id}-wake`,
    car: { ...snapshot.car, sleep_comfort_seats: ['rearRight'] }, event: { seat: 'rearRight' } });
  const preview = await request('question_preview', { route: 'preview', input_payload: {
    ...snapshot, trigger_type: 'event', event: { id: `${id}-preview`, type: 'start_game' },
    game: { ...snapshot.game, status: 'ready', current_answer: '雨伞' },
    round_question_plan_request: { plan_id: `${id}-plan`, step_count: 4, persona_age_groups: ['child', 'elder'] },
  } });
  assert.ok(['ready', 'partial'].includes(preview.preview_status));
  const plan = JSON.parse(preview.workflow_output).round_question_plan;
  assert.ok(plan.steps.length > 0);
  assert.ok(plan.steps.every(step => step.host_reply_text === undefined));
  console.log(JSON.stringify({ ok: true, test_user: user, conversation_fingerprint: crypto.createHash('sha256')
    .update(first.conversation_id).digest('hex').slice(0, 12), preview_status: preview.preview_status,
    preview_steps: plan.steps.length, report }, null, 2));
})().catch(error => { console.log(JSON.stringify({ ok: false, error: error.message, report }, null, 2)); process.exitCode = 1; });
