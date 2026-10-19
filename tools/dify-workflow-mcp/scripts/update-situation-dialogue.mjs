import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { requestConsoleJson as request } from '../src/index.mjs';
import { patchSituationDialogue } from './lib/situation-dialogue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const folder = path.join(root, 'tmp/dify-import/situation-dialogue');
const apps = { situation: 'bc1ce5be-d5c5-4885-84c5-72c2c1f63d18', dialogue: '74bef8bd-22bd-4e19-91da-5e8d645dd8ed' };
const mode = process.argv[2] || 'status';
assert.ok(['status', 'prepare', 'save', 'verify', 'publish', 'sync-local'].includes(mode));
fs.mkdirSync(folder, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(folder, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const load = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const allowed = (process.env.DIFY_ALLOWED_APP_IDS || '').split(',').map(id => id.trim());

if (mode === 'verify') {
  const hashes = {};
  for (const [kind, id] of Object.entries(apps)) {
    const current = await request(`/apps/${id}/workflows/draft`);
    assert.equal(current.hash, load(`${kind}-release.json`).saved_hash);
    hashes[kind] = current.hash;
  }
  const reports = [];
  const snapshot = (type, extra = {}) => ({
    game_id: 'serial-event-independent-test', round_id: 'serial-event-independent-test-round-1', scene_version: 'serial-test-v1',
    game: { status: 'playing', round_index: 1, total_rounds: 10, current_answer: '海豚', question_count: 0, max_questions: 15 },
    car: { environment: '城区晴天白天', speed: 80, destination: '学校' },
    passengers: { selected_seat: 'front', states: { driver: '普通', front: '普通', rearLeft: '普通', rearRight: '普通' } },
    event: { id: `serial-test-${type}`, type, priority: ['hard_brake'].includes(type) ? 'P0' : 'P1', source: 'manual_control', ...extra },
  });
  async function run(name, kind, state, situation = {}, query = '') {
    const started = Date.now();
    const endpoint = kind === 'dialogue' ? 'advanced-chat/workflows/draft/run' : 'workflows/draft/run';
    const response = await request(`/apps/${apps[kind]}/${endpoint}`, { method: 'POST', raw: true, body: {
      inputs: { snapshot: JSON.stringify(state), ...(kind === 'dialogue' ? { situation: JSON.stringify(situation) } : {}) },
      query, response_mode: 'streaming',
    } });
    const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith('data:')).flatMap(line => {
      try { return [JSON.parse(line.slice(5))]; } catch { return []; }
    });
    save(`${name}.json`, events);
    const finish = events.find(row => row.event === 'workflow_finished')?.data;
    assert.equal(finish?.status, 'succeeded', `${name}: ${finish?.error || 'missing workflow finish'}`);
    const nodes = events.filter(row => row.event === 'node_finished').map(row => row.data);
    const scene = finish.outputs?.scene_output ? JSON.parse(finish.outputs.scene_output) : null;
    const hostText = nodes.find(row => row.node_id === '1000000000020')?.outputs?.host_result;
    const host = hostText ? JSON.parse(hostText) : null;
    const report = { name, elapsed_ms: Date.now() - started, llm_calls: nodes.filter(row => row.node_type === 'llm').length,
      retrieval_calls: nodes.filter(row => row.node_type === 'knowledge-retrieval').length,
      speech: host?.ai_reply_text || '', guard_status: host?.decision_trace?.guard_status,
      analysis_status: scene?.analysis_status, request_proactive_speech: scene?.request_proactive_speech };
    reports.push(report); console.log(JSON.stringify(report));
    return { scene, host, report };
  }
  for (const [type, extra] of [['environment_change', { value: '城区晴天白天', previous_value: '车库' }],
    ['speed_overspeed', { value: 130, previous_value: 80 }], ['driver_tired', { state: 'fatigued', duration_ms: 16000 }]]) {
    const state = snapshot(type, extra);
    if (type === 'speed_overspeed') state.car.speed = 130;
    if (type === 'driver_tired') state.passengers.states.driver = '疲惫';
    const analysis = await run(type, 'situation', state);
    assert.equal(analysis.report.llm_calls, 0);
    assert.equal(analysis.report.retrieval_calls, 0);
    assert.equal(analysis.scene.host_response, null);
    assert.equal(analysis.scene.request_proactive_speech, true);
    assert.equal(analysis.scene.decision_trace.priority, 'P1');
    state.dialogue_request = { kind: 'situation_event', event_id: state.event.id };
    const reply = await run(`${type}-reply`, 'dialogue', state, analysis.scene, `座舱事件：${type}。请回应本次事件。`);
    assert.ok(reply.host.ai_reply_text);
    assert.equal(reply.host.decision_trace.guard_status, 'passed');
    assert.equal(reply.host.intent, 'event');
    assert.equal(reply.host.is_correct, false);
    assert.deepEqual(reply.host.covered_fact_keys, []);
    assert.deepEqual(reply.host.execution.actions, []);
    assert.ok(!reply.host.ai_reply_text.includes('海豚'));
    if (type === 'environment_change') assert.match(reply.host.ai_reply_text, /市区|城区/);
  }
  const brake = snapshot('hard_brake'); brake.game.status = 'paused';
  const p0 = await run('hard-brake', 'situation', brake);
  assert.equal(p0.report.llm_calls, 0);
  assert.equal(p0.scene.request_proactive_speech, false);
  assert.equal(p0.scene.host_response, null);
  const invalid = await run('invalid-fatigue', 'situation', snapshot('driver_tired', { duration_ms: 0 }));
  assert.equal(invalid.scene.request_proactive_speech, false);
  const sleep = snapshot('passenger_sleep'); sleep.event.priority = 'P2'; sleep.event.seat = 'rearRight';
  sleep.passengers.states.rearRight = '睡着';
  const sleepAnalysis = await run('passenger-sleep', 'situation', sleep);
  assert.equal(sleepAnalysis.scene.host_response, null);
  assert.equal(sleepAnalysis.scene.analysis_status, 'ready');
  assert.equal(sleepAnalysis.report.llm_calls, 1);
  const feedback = snapshot('post_result_feedback');
  feedback.game.status = 'victory'; feedback.game.round_index = 6;
  feedback.event.priority = 'P4'; feedback.event.source = 'performance_monitor';
  feedback.performance = { completed_rounds: 6, team_correct: 6, per_seat_correct: { front: 6 },
    streak_seat: 'front', streak_count: 6, last_result: { round_index: 6, correct_seat: 'front', contributors: ['front'] } };
  feedback.host_feedback = { id: 'serial-feedback-test', subject_seat: 'front', selected_id: 'HK12', candidate_ids: ['HK12', 'HK10'],
    personal_correct: 6, team_correct: 6, streak_count: 6, contributors: ['front'] };
  const feedbackAnalysis = await run('achievement-analysis', 'situation', feedback);
  assert.equal(feedbackAnalysis.scene.host_response, null);
  assert.equal(feedbackAnalysis.scene.request_proactive_speech, true);
  assert.equal(feedbackAnalysis.report.llm_calls, 0);
  feedback.dialogue_request = { kind: 'situation_event', event_id: feedback.event.id };
  const praise = await run('achievement-reply', 'dialogue', feedback, feedbackAnalysis.scene, '座舱事件：本题已经答对，请认可真实成绩。');
  assert.equal(praise.host.decision_trace.guard_status, 'passed');
  assert.ok(praise.host.ai_reply_text && !praise.host.ai_reply_text.includes('海豚'));
  const normal = snapshot('passenger_question'); normal.trigger_type = 'chat'; delete normal.event;
  const answer = await run('ordinary-question', 'dialogue', normal, {}, '它是人造的吗？');
  assert.match(answer.host.ai_reply_text, /不是|^不/);
  const hint = await run('hint-refusal', 'dialogue', normal, {}, '给我一个提示吧');
  assert.equal(hint.host.decision_trace.hint_blocked, true);
  assert.deepEqual(hint.host.covered_fact_keys, []);
  save('verification.json', { passed: true, hashes, reports, checked_at: new Date().toISOString() });
} else {
  for (const [kind, id] of Object.entries(apps)) {
    const current = await request(`/apps/${id}/workflows/draft`);
    if (mode === 'status') {
      const published = await request(`/apps/${id}/workflows/publish`);
      console.log(JSON.stringify({ kind, draft_hash: current.hash, published_hash: published.hash }));
      continue;
    }
    assert.ok(allowed.includes(id), 'Target app not allowed by connector configuration.');
    if (mode === 'prepare') {
      const candidate = structuredClone(current);
      patchSituationDialogue(candidate.graph, kind);
      const changed = candidate.graph.nodes.filter(node => JSON.stringify(node) !== JSON.stringify(current.graph.nodes.find(row => row.id === node.id))).map(node => node.id);
      const removed = current.graph.nodes.filter(node => !candidate.graph.nodes.some(row => row.id === node.id)).map(node => node.id);
      save(`${kind}-before.json`, current); save(`${kind}-candidate.json`, candidate);
      save(`${kind}-release.json`, { app_id: id, expected_hash: current.hash, changed_nodes: changed, removed_nodes: removed });
      console.log(JSON.stringify({ kind, expected_hash: current.hash, changed_nodes: changed, removed_nodes: removed }));
      continue;
    }
    const release = load(`${kind}-release.json`);
    assert.equal(current.hash, mode === 'save' ? release.expected_hash : release.saved_hash, 'Cloud draft changed since review.');
    if (mode === 'save') {
      const candidate = load(`${kind}-candidate.json`);
      await request(`/apps/${id}/workflows/draft`, { method: 'POST', body: {
        graph: candidate.graph, features: current.features, conversation_variables: current.conversation_variables || [], hash: current.hash,
      } });
      const saved = await request(`/apps/${id}/workflows/draft`);
      assert.deepEqual(saved.graph.nodes.map(node => ({ id: node.id, data: node.data })), candidate.graph.nodes.map(node => ({ id: node.id, data: node.data })));
      assert.deepEqual(saved.graph.edges, candidate.graph.edges);
      assert.deepEqual(saved.features, current.features);
      assert.deepEqual(saved.conversation_variables, current.conversation_variables);
      release.saved_hash = saved.hash; save(`${kind}-release.json`, release);
      console.log(JSON.stringify({ kind, saved_hash: saved.hash }));
    } else if (mode === 'publish') {
      const verification = load('verification.json');
      assert.equal(verification.passed, true); assert.equal(verification.hashes[kind], current.hash);
      save(`${kind}-published-before.json`, await request(`/apps/${id}/workflows/publish`));
      await request(`/apps/${id}/workflows/publish`, { method: 'POST', body: {
        marked_name: '情境分析接续主持', marked_comment: '情境只分析；P1零模型快速分支；前端自动接续全局Chatflow生成串词。',
      } });
      const published = await request(`/apps/${id}/workflows/publish`);
      assert.equal(published.hash, current.hash);
      release.published_hash = published.hash; release.published_at = new Date().toISOString(); save(`${kind}-release.json`, release);
      console.log(JSON.stringify({ kind, published_hash: published.hash }));
    } else {
      const published = await request(`/apps/${id}/workflows/publish`);
      assert.equal(published.hash, release.published_hash);
      const target = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel', kind === 'dialogue' ? 'host-dialogue-v4.yml' : 'cabin-situation-v1.yml');
      const dsl = YAML.parse(fs.readFileSync(target, 'utf8'));
      for (const key of ['graph', 'features', 'environment_variables', 'conversation_variables']) if (published[key] !== undefined) dsl.workflow[key] = published[key];
      fs.writeFileSync(target, YAML.stringify(dsl, { lineWidth: 120 }));
      console.log(JSON.stringify({ kind, synced: true, hash: published.hash }));
    }
  }
}
