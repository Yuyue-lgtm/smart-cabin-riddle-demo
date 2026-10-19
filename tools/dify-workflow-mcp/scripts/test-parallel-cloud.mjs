import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { requestConsoleJson } from '../src/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const env = dotenv.parse(fs.readFileSync(path.resolve(here, '../.env'), 'utf8'));
if (env.DIFY_PROXY_URL !== '') setGlobalDispatcher(new ProxyAgent(env.DIFY_PROXY_URL || 'http://127.0.0.1:7897'));
const apps = JSON.parse(fs.readFileSync(path.resolve(here, '../workflows/parallel/cloud-apps.json'), 'utf8'));
const reportDir = path.join(root, 'tmp/dify-import/parallel-tests');
fs.mkdirSync(reportDir, { recursive: true });
const base = {
  game_id: 'cloud-test-game', round_id: 'cloud-test-round', scene_version: '1',
  game: { status: 'playing', current_answer: '雨伞', round_index: 1, question_count: 3, max_questions: 15,
    round_question_plan: { steps: [{ fact_key: 'rain', variants: { default: '下雨时会用到它吗？' }, expected_answer: 'yes' }] } },
  car: { environment: '城市夜景', speed: 50, destination: '火锅店' },
  passengers: { states: { driver: 'awake', front: 'awake', rearLeft: 'sleeping', rearRight: 'awake' }, selected_seat: 'front' },
  event: { id: 'cloud-sleep-1', type: 'passenger_sleep', value: 'rearLeft' },
};
async function run(name, kind, snapshot, query = '', conversationId = '', situation = {}, parentMessageId = '') {
  const appId = kind === 'chat' ? apps.dialogue_app_id : apps.situation_app_id;
  const endpoint = `/apps/${appId}/${kind === 'chat' ? 'advanced-chat/' : ''}workflows/draft/run`;
  const inputs = { snapshot: JSON.stringify(snapshot), ...(kind === 'chat' ? { situation: JSON.stringify(situation) } : {}) };
  const response = await fetch(`https://cloud.dify.ai/console/api${endpoint}`, {
    method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${env.DIFY_CONSOLE_TOKEN}`, 'X-CSRF-Token': env.DIFY_CSRF_TOKEN,
      Cookie: `${env.DIFY_CSRF_COOKIE_NAME || 'csrf_token'}=${env.DIFY_CSRF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs, query, response_mode: 'streaming', ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(parentMessageId ? { parent_message_id: parentMessageId } : {}) }),
  });
  if (!response.ok) throw new Error(`Cloud draft test ${name}: HTTP ${response.status}; refresh connector session if 401.`);
  const events = [];
  let pending = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index).replace(/\r$/, ''); pending = pending.slice(index + 1);
      if (line.startsWith('data:')) {
        try { events.push(JSON.parse(line.slice(5))); } catch {}
      }
    }
  }
  fs.writeFileSync(path.join(reportDir, `${name}.json`), JSON.stringify(events, null, 2));
  const finished = events.find(e => e.event === 'workflow_finished');
  const nodes = events.filter(e => e.event === 'node_finished').map(e => e.data);
  const finalNode = nodes.find(n => n.node_id === '1000000000020');
  const host = finalNode?.outputs?.host_result ? JSON.parse(finalNode.outputs.host_result) : null;
  const guardNode = nodes.find(n => n.node_id === '1000000000006');
  const guarded = guardNode?.outputs?.workflow_output ? JSON.parse(guardNode.outputs.workflow_output) : null;
  const observed = host || guarded;
  const fallbackReasons = observed?.debug?.fallback_reason_codes || observed?.decision_trace?.guard_reason_codes || [];
  const validationErrors = observed?.debug?.validation_errors || [];
  const fixedFallback = observed?.ai_reply_text === '我陪你慢慢想，按你的节奏来。';
  const guardFallback = ['fallback', 'knowhow_fallback', 'constraint_fallback']
    .includes(observed?.decision_trace?.guard_status);
  const diagnosticStatus = fallbackReasons.length || validationErrors.length ? 'reason_recorded'
    : fixedFallback || guardFallback ? 'reason_unavailable'
    : observed ? 'no_guard_fallback_observed' : 'trace_missing_guard_output';
  const scene = finished?.data?.outputs?.scene_output ? JSON.parse(finished.data.outputs.scene_output) : null;
  const summary = { name, status: finished?.data?.status, error: finished?.data?.error || events.find(e => e.event === 'error')?.message,
    nodes: nodes.map(n => ({ id: n.node_id, type: n.node_type, status: n.status, error: n.error, elapsed_time: n.elapsed_time })),
    answer: events.filter(e => e.event === 'message' || e.event === 'text_chunk').map(e => e.answer || e.data?.text || '').join(''),
    host, scene, diagnostic: kind === 'chat' ? {
      status: diagnosticStatus, guard_status: observed?.decision_trace?.guard_status || null,
      fallback_origin: observed?.debug?.fallback_origin || null,
      fallback_reason_codes: fallbackReasons,
      validation_errors: validationErrors,
      validation_reason_codes: observed?.debug?.validation_reason_codes || [],
    } : null,
    workflow_run_id: events.find(e => e.event === 'workflow_started')?.data?.id || null,
    conversation_id: events.find(e => e.conversation_id)?.conversation_id,
    message_id: events.find(e => e.event === 'message_end')?.message_id,
  };
  fs.writeFileSync(path.join(reportDir, `${name}-summary.json`), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ name, status: summary.status, error: summary.error, answer: kind === 'chat' ? summary.answer : scene?.host_response?.ai_reply_text,
    llm_calls: nodes.filter(n => n.node_type === 'llm').length,
    retrieval_calls: nodes.filter(n => n.node_type === 'knowledge-retrieval').length,
    analysis_status: scene?.analysis_status, proactive: scene?.request_proactive_speech, adopted: scene?.applied_knowhow_ids,
    diagnostic: summary.diagnostic }));
  assert.equal(summary.status, 'succeeded', name);
  if (kind === 'chat') assert.notEqual(summary.diagnostic.status, 'reason_unavailable', `${name}: fixed fallback lacks a guard reason`);
  return { ...summary, nodes };
}

const selected = process.argv[2] || 'smoke';
if (selected === 'smoke') {
  const chat = await run('chat-normal', 'chat', base, '下雨时会用到它吗？');
  assert.equal(chat.nodes.filter(n => n.node_type === 'llm').length, 1);
  assert.ok(chat.host);
  assert.equal(chat.answer, chat.host.ai_reply_text);
  assert.ok(!chat.answer.startsWith('{'));
  const next = structuredClone(base);
  next.game_id = 'cloud-test-game-2'; next.round_id = 'cloud-test-round-2'; next.scene_version = '2';
  next.game.current_answer = '西瓜';
  const round = await run('chat-next-game', 'chat', next, '西瓜', chat.conversation_id, {}, chat.message_id);
  assert.equal(round.conversation_id, chat.conversation_id);
  assert.equal(round.host.is_correct, true);
  assert.equal(round.nodes.filter(n => n.node_type === 'llm').length, 0);
  const p0 = await run('scene-p0', 'scene', { ...base, event: { id: 'cloud-brake', type: 'hard_brake' } });
  assert.equal(p0.scene.host_response.game_status, 'paused');
  assert.equal(p0.nodes.filter(n => n.node_type === 'llm' || n.node_type === 'knowledge-retrieval').length, 0);
  const sleep = await run('scene-sleep', 'scene', base);
  assert.equal(sleep.scene.request_proactive_speech, false);
  assert.ok(!sleep.scene.target_seat || sleep.scene.target_seat !== 'rearLeft');
  const env = await run('scene-environment', 'scene', { ...base, event: { id: 'cloud-env', type: 'environment_change', value: '城市夜景' } });
  assert.equal(env.scene.analysis_status, 'ready');
  const normal = await run('chat-with-situation', 'chat', base, '太难了，但让我再想想。', '', sleep.scene);
  assert.equal(normal.nodes.filter(n => n.node_type === 'llm').length, 1);
  assert.equal(normal.host.target_seat, null);
  console.log('PASS cloud draft smoke tests');
} else if (selected === 'scene') {
  const sleep = await run('scene-sleep-final', 'scene', base);
  assert.equal(sleep.scene.request_proactive_speech, false);
  assert.equal(sleep.scene.analysis_status, 'ready');
  const awake = structuredClone(base);
  awake.passengers.states.rearLeft = 'awake';
  awake.event = { id: 'cloud-env-awake', type: 'environment_change', value: '城市夜景' };
  const environment = await run('scene-environment-final', 'scene', awake);
  assert.equal(environment.scene.analysis_status, 'ready');
  const chat = await run('chat-with-situation-final', 'chat', base, '太难了，但让我再想想。', '', sleep.scene);
  assert.equal(chat.host.target_seat, null);
  assert.equal(chat.nodes.filter(n => n.node_type === 'knowledge-retrieval').length, 0);
  const skipped = await run('scene-skip-final', 'scene', { ...base, event: { id: 'routine', type: 'speed_change', value: 51 } });
  assert.equal(skipped.scene.analysis_status, 'skipped');
  assert.equal(skipped.nodes.filter(n => n.node_type === 'llm').length, 0);
  console.log('PASS final scene retrieval and parallel chat');
} else if (selected === 'memory') {
  const first = await run('memory-first', 'chat', base, '我叫小橙，你记住就好。');
  const next = { ...base, game_id: 'memory-game-2', round_id: 'memory-round-2', scene_version: '2' };
  const second = await run('memory-next-game', 'chat', next, '你还记得我叫什么吗？', first.conversation_id, {}, first.message_id);
  assert.ok(second.answer.includes('小橙'));
  const prompts = second.nodes.find(n => n.node_type === 'llm').process_data.prompts;
  assert.ok(prompts.some(p => p.role === 'user' && p.text === '我叫小橙，你记住就好。'));
  assert.ok(prompts.some(p => p.role === 'assistant' && p.text === first.answer));
  assert.ok(prompts.filter(p => p.role !== 'system').every(p => !p.text.includes('scene_version')));
  console.log('PASS cross-game natural dialogue memory');
} else if (selected === 'environment') {
  for (const [index, environment] of ['高速路晴天白天', '城区夜晚', '隧道'].entries()) {
    const snapshot = structuredClone(base);
    snapshot.game_id = 'environment-fast-test-game';
    snapshot.round_id = 'environment-fast-test-round';
    snapshot.scene_version = `environment-fast-${index}`;
    snapshot.car.environment = environment;
    snapshot.event = { id: `environment-fast-${index}`, type: 'environment_change', priority: 'P1', previous_value: '车库', value: environment };
    const result = await run(`environment-fast-${index}`, 'scene', snapshot);
    assert.equal(result.nodes.filter(node => node.node_type === 'llm').length, 1);
    assert.equal(result.nodes.filter(node => node.node_type === 'knowledge-retrieval').length, 0);
    assert.equal(result.scene.request_proactive_speech, true);
    assert.equal(result.scene.analysis_status, 'ready');
    assert.equal(result.scene.decision_trace.priority, 'P1');
    assert.ok(result.scene.host_response.ai_reply_text.length <= 30);
    assert.deepEqual(result.scene.execution.actions, []);
  }
  for (const status of ['paused', 'playing']) {
    const snapshot = structuredClone(base);
    snapshot.game.status = status;
    snapshot.event = { id: `environment-noop-${status}`, type: 'environment_change', previous_value: snapshot.car.environment, value: snapshot.car.environment };
    const result = await run(`environment-noop-${status}`, 'scene', snapshot);
    assert.equal(result.scene.request_proactive_speech, false);
    assert.equal(result.nodes.filter(node => node.node_type === 'llm').length, 0);
  }
  console.log('PASS cloud environment fast path and safety/no-op gates');
} else if (selected === 'participation') {
  const snapshot = structuredClone(base);
  snapshot.game_id = 'participation-test-game';
  snapshot.round_id = 'participation-test-round';
  snapshot.passengers.states.front = '普通';
  snapshot.event = { id: 'participation-opportunity', type: 'passenger_inactive', seat: 'front',
    source: 'participation_monitor', priority: 'P4', duration_ms: 35000 };
  snapshot.participation = { seat: 'front', version: 8, inactive_duration_ms: 35000,
    dialogue_silence_ms: 8000, remaining_ms: 45000, real_user_turn_count: 0, invitation_declined: false };
  const invitation = await run('scene-participation', 'scene', snapshot);
  assert.equal(invitation.scene.analysis_status, 'ready');
  assert.equal(invitation.scene.participation_version, 8);
  assert.equal(invitation.scene.usable_for_dialogue, false);
  assert.equal(invitation.scene.expires_at_ms - invitation.scene.generated_at_ms, 10000);
  assert.equal(invitation.scene.request_proactive_speech, true);
  if (invitation.scene.request_proactive_speech) {
    assert.equal(invitation.scene.target_seat, 'front');
    assert.equal(invitation.scene.strategy, 'invite_collaboration');
    assert.equal(invitation.scene.host_response, null);
    assert.ok(invitation.scene.retrieved_knowhow.some(row => row.knowhow_id === 'HK28'));
    const response = await run('chat-participation-handoff', 'chat', {
      ...snapshot, dialogue_request: { kind: 'situation_event', event_id: snapshot.event.id },
    }, 'system event: passenger_inactive', '', invitation.scene);
    assert.equal(response.host.decision_trace.guard_status, 'passed');
    assert.ok(response.host.ai_reply_text);
    assert.equal(response.host.strategy, 'invite_collaboration');
    assert.ok(!/\d+\s*(秒|毫秒)|沉默了|一直没说话/.test(response.host.ai_reply_text));
    const handoffNode = response.nodes.find(node => node.node_id === '1000000000002');
    const handoffContext = JSON.parse(handoffNode?.outputs?.context_json || '{}');
    assert.equal(handoffContext.event_dialogue.valid, true);
    assert.deepEqual(handoffContext.event_dialogue.failed_handoff_checks, []);
  } else assert.equal(invitation.scene.host_response, null);
  for (const [name, change] of [
    ['sleeping', current => { current.passengers.states.front = '睡着'; }],
    ['declined', current => { current.participation.invitation_declined = true; }],
    ['recent-input', current => { current.participation.inactive_duration_ms = 1000; }],
  ]) {
    const current = structuredClone(snapshot);
    change(current);
    const skipped = await run(`scene-participation-${name}`, 'scene', current);
    assert.equal(skipped.scene.analysis_status, 'skipped');
    assert.equal(skipped.scene.request_proactive_speech, false);
    assert.equal(skipped.nodes.filter(node => node.node_type === 'llm').length, 0);
  }
  const [situationDraft, dialogueDraft] = await Promise.all([
    requestConsoleJson(`/apps/${apps.situation_app_id}/workflows/draft`),
    requestConsoleJson(`/apps/${apps.dialogue_app_id}/workflows/draft`),
  ]);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, 'tmp/dify-import/host-experiences/knowledge-release.json'), 'utf8'));
  assert.equal(knowledge.ready, true);
  fs.writeFileSync(path.join(root, 'tmp/dify-import/host-experiences/verification.json'), JSON.stringify({
    passed: true, hashes: { situation: situationDraft.hash, dialogue: dialogueDraft.hash },
    knowledge_count: knowledge.total, checked_at: new Date().toISOString(),
    scenario: 'passenger_inactive HK28 retrieval and guarded Chatflow handoff',
  }, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS participation invitation and silent exclusion gates');
} else if (selected === 'round') {
  const first = { ...base, game_id: 'round-memory-game', round_id: 'round-memory-1', event: null,
    game: { status: 'playing', current_answer: '安全带', round_index: 1, question_count: 1, max_questions: 15,
      asked_questions: [], covered_fact_keys: [], round_question_plan: { steps: [] } } };
  const named = await run('round-name', 'chat', first, '我叫小橙，请记住这个称呼。');
  const ended = await run('round-ended', 'chat', first, '安全带', named.conversation_id, {}, named.message_id);
  assert.equal(ended.host.is_correct, true);
  const next = { ...first, round_id: 'round-memory-2', scene_version: '2',
    game: { ...first.game, current_answer: '海豚', round_index: 2 },
    round_context: { previous_game_id: first.game_id, previous_round_id: first.round_id } };
  const current = await run('round-current', 'chat', next, '它是人造的吗？', ended.conversation_id, {}, ended.message_id);
  assert.equal(current.conversation_id, ended.conversation_id);
  assert.equal(current.host.context_scope.round_id, next.round_id);
  assert.equal(current.host.is_correct, false);
  assert.match(current.answer, /^(不|否)/);
  assert.doesNotMatch(current.answer, /安全带|已经揭晓|按你的节奏来/);
  const normalized = JSON.parse(current.nodes.find(n => n.node_id === '1000000000002').outputs.context_json);
  assert.equal(normalized.game.current_answer, '海豚');
  assert.equal(normalized.round_context.transition, 'new_round');
  next.round_context.previous_round_id = next.round_id;
  const memory = await run('round-retained-name', 'chat', next, '你还记得我叫什么吗？', current.conversation_id, {}, current.message_id);
  assert.ok(memory.answer.includes('小橙'));
  assert.equal(memory.host.context_scope.round_id, next.round_id);
  assert.equal(memory.conversation_id, named.conversation_id);
  console.log('PASS same-conversation round boundary, current puzzle grounding, retained name');
} else {
  throw new Error('Expected smoke, scene, memory, participation or round');
}
