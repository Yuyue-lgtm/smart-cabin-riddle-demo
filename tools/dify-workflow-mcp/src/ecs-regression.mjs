import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readKnowledge } from './ecs-release.mjs';

const require = createRequire(import.meta.url);
const { handleWorkflowBody } = require('../../../api/dify-bff.js');

export function parseWorkflowStream(text) {
  const events = text.split(/\r?\n\r?\n/).flatMap(block => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return [];
    try { return [JSON.parse(data)]; } catch { return []; }
  });
  const failed = events.find(event => event.event === 'error'
    || event.event === 'workflow_finished' && event.data?.status !== 'succeeded');
  if (failed) throw new Error('Dify draft regression workflow failed; inspect its run in Dify');
  const complete = events.find(event => event.event === 'workflow_finished');
  if (!complete?.data?.outputs) throw new Error('Dify did not complete the draft workflow');
  return { data: complete.data, workflow_run_id: complete.workflow_run_id || complete.data.id };
}

// Runs in the CLI process, isolated from any running Demo BFF process.
export async function runDraftRegression(request, apps, progress = () => {}, knowledgeId) {
  if (!knowledgeId) throw new Error('A target knowledge ID is required for release regression');
  progress('knowledge_retrieval');
  const knowledge = await readKnowledge(request, knowledgeId);
  const example = knowledge.rows.find(row => row.knowhow_id === 'HK28');
  assert.ok(example, 'HK28 must be preserved in the knowledge source');
  const situationDraft = await request(`/apps/${apps.situation}/workflows/draft`);
  const retrievalNodes = situationDraft.graph.nodes.filter(node => node.data.type === 'knowledge-retrieval');
  assert.equal(retrievalNodes.length, 2);
  assert.ok(retrievalNodes.every(node => node.data.dataset_ids.length === 1 && node.data.dataset_ids[0] === knowledgeId));
  // Use the actual economy retrieval node. Dify's generic hit-testing API requires
  // a default embedding model even when this application uses keyword indexing.
  const hits = await request(`/apps/${apps.situation}/workflows/draft/nodes/${retrievalNodes[0].id}/run`, {
    method: 'POST', body: { inputs: { query: 'participation' } },
  });
  assert.equal(hits.status, 'succeeded');
  assert.equal(hits.inputs?.query, 'participation');
  assert.ok(hits.outputs?.result?.some(record => {
    try { return JSON.parse(record.content).knowhow_id === 'HK28'; } catch { return false; }
  }), 'Target knowledge must directly retrieve HK28');
  const originalFetch = globalThis.fetch;
  const keys = ['DIFY_API_BASE_URL', 'DIFY_CHATFLOW_API_KEY', 'DIFY_SITUATION_API_KEY', 'DIFY_PREVIEW_API_KEY',
    'DIFY_CHATFLOW_APP_ID', 'DIFY_SITUATION_APP_ID', 'DIFY_PREVIEW_APP_ID'];
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const base = 'http://dify-draft-regression.invalid';
  process.env.DIFY_API_BASE_URL = base;
  for (const [kind, env] of [['host', 'CHATFLOW'], ['situation', 'SITUATION'], ['preview', 'PREVIEW']]) {
    process.env[`DIFY_${env}_APP_ID`] = apps[kind];
    process.env[`DIFY_${env}_API_KEY`] = `draft-${kind}`;
  }
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith(`${base}/v1/`)) throw new Error('Unexpected regression request origin');
    const body = JSON.parse(options.body);
    const kind = String(options.headers.Authorization || options.headers.authorization).replace('Bearer draft-', '');
    if (!apps[kind]) throw new Error('Unexpected regression route');
    const chat = kind === 'host';
    const payload = { inputs: body.inputs, ...(chat ? { query: body.query,
      ...(body.conversation_id ? { conversation_id: body.conversation_id } : {}) } : {}) };
    const response = await request(`/apps/${apps[kind]}/${chat ? 'advanced-chat/' : ''}workflows/draft/run`, {
      method: 'POST', body: payload, raw: true,
    });
    const text = await response.text();
    if (chat) return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
    return Response.json(parseWorkflowStream(text));
  };
  const id = `release-test-${Date.now()}`;
  const user = `${id}-fictional`;
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
    perception: {}, host_preferences: {}, interaction: { current_speaker: 'front', current_speaker_label: '副驾',
      user_seat: 'front', speaker_source: 'real_user', recent_messages: [], suppress_passenger_action: true },
  };
  async function send(label, body) {
    progress(label);
    const start = Date.now();
    const { status, payload } = await handleWorkflowBody({ ...body, user_id: user });
    report.push({ label, http: status, route: payload.route, workflow_run_id: payload.workflow_run_id || null,
      elapsed_ms: Date.now() - start, ...(payload.scene_output ? { situation: {
        analysis_status: payload.scene_output.analysis_status, knowhow_status: payload.scene_output.knowhow_status,
        reason_codes: payload.scene_output.reason_codes,
        retrieved_ids: payload.scene_output.retrieved_knowhow?.map(row => row.knowhow_id),
      } } : {}) });
    assert.equal(status, 200, `${label}: ${payload.error || status}`);
    return payload;
  }
  function host(result) {
    assert.equal(result.route, 'chat');
    assert.equal(result.context_verified, true);
    assert.equal(result.host_result?.decision_trace?.guard_status, 'passed');
    assert.ok(result.host_result.ai_reply_text?.trim());
    assert.notEqual(result.host_result.intent, 'fallback');
    assert.doesNotMatch(result.host_result.ai_reply_text, /安全带|<think>|context_scope|execution_actions/);
    return result.host_result;
  }
  async function event(type, priority, extra = {}, shouldChat = true) {
    const input = { ...structuredClone(snapshot), ...extra, trigger_type: 'event', player_input: '',
      event: { id: `${id}-${type}`, type, priority, source: 'manual', ...extra.event } };
    const analysis = await send(type, { route: 'situation', input_payload: input });
    assert.equal(analysis.scene_output.host_response, null);
    if (type === 'passenger_inactive') {
      assert.equal(analysis.scene_output.participation_version, input.participation.version);
    }
    if (!shouldChat) {
      assert.equal(analysis.situation_handoff, null);
      assert.equal(analysis.scene_output.request_proactive_speech, false);
      return;
    }
    assert.ok(analysis.situation_handoff, `${type}: no dialogue handoff`);
    const result = host(await send(`${type}_reply`, { route: 'chat', operation: 'situation_reply',
      input_payload: input, situation_handoff: analysis.situation_handoff }));
    if (type === 'passenger_sleep' || type === 'passenger_wake') {
      const action = type === 'passenger_sleep' ? 'cabin.apply_sleep_comfort' : 'cabin.restore_sleep_comfort';
      assert.ok(result.execution.actions.some(item => item.type === action && item.seat === 'rearRight'));
    }
    if (type === 'passenger_inactive') assert.equal(result.strategy, 'invite_collaboration');
  }
  try {
    const first = await send('passenger_question', { route: 'chat', input_payload: {
      ...snapshot, player_input: '当前这道题，它是人造的吗？' } });
    assert.match(host(first).ai_reply_text, /是|人造|制造/);
    assert.ok(first.conversation_id);
    const second = await send('same_conversation', { route: 'chat', conversation_id: first.conversation_id,
      input_payload: { ...snapshot, player_input: '我想自己再想想。' } });
    host(second); assert.equal(second.conversation_id, first.conversation_id);
    await event('environment_change', 'P1', { event: { previous_value: '车库', value: '高速路晴天白天' } });
    await event('hard_brake', 'P0', { p0_epoch: 1, game: { ...snapshot.game, status: 'paused' } }, false);
    await event('passenger_sleep', 'P2', { scene_version: `${id}-sleep`, event: { seat: 'rearRight' },
      passengers: { ...snapshot.passengers, states: { ...snapshot.passengers.states, rear_right: '睡着' } } });
    await event('passenger_wake', 'P3', { scene_version: `${id}-wake`, event: { seat: 'rearRight' },
      car: { ...snapshot.car, sleep_comfort_seats: ['rearRight'] } });
    await event('passenger_inactive', 'P4', { scene_version: `${id}-inactive`,
      event: { seat: 'front', source: 'participation_monitor' },
      participation: { seat: 'front', version: 19, inactive_duration_ms: 37506,
        dialogue_silence_ms: 2589, remaining_ms: 52494, real_user_turn_count: 0, invitation_declined: false } });
    const preview = await send('question_preview', { route: 'preview', input_payload: {
      ...snapshot, trigger_type: 'event', event: { id: `${id}-preview`, type: 'start_game' },
      game: { ...snapshot.game, status: 'ready', current_answer: '雨伞' },
      round_question_plan_request: { plan_id: `${id}-plan`, step_count: 4, persona_age_groups: ['child', 'elder'] },
    } });
    assert.ok(['ready', 'partial'].includes(preview.preview_status));
    const plan = JSON.parse(preview.workflow_output).round_question_plan;
    assert.ok(plan.steps.length > 0);
    assert.ok(plan.steps.every(step => step.host_reply_text === undefined));
    return { ok: true, fictional_test_user: user, report, preview_steps: plan.steps.length,
      direct_knowledge_check: { dataset_id: knowledgeId, matched: 'HK28', node_execution_id: hits.id },
      limitation: 'Does not resolve the previously recorded ambiguous cross-round semantic issue.' };
  } catch (error) {
    error.regression_report = { ok: false, fictional_test_user: user, error: error.message, report };
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
  }
}
