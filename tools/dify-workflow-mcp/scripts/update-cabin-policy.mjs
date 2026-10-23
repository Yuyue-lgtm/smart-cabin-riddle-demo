import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { requestConsoleJson as request } from '../src/index.mjs';
import { patchSleepComfort } from './update-sleep-comfort.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'tools/dify-workflow-mcp/workflows/host/src');
const folder = path.join(root, 'tmp/dify-import/cabin-policy');
const apps = { dialogue: '74bef8bd-22bd-4e19-91da-5e8d645dd8ed', situation: 'bc1ce5be-d5c5-4885-84c5-72c2c1f63d18' };
const mode = process.argv[2] || 'status';
assert.ok(['status', 'prepare', 'save', 'verify', 'publish'].includes(mode));
fs.mkdirSync(folder, { recursive: true });
const read = name => fs.readFileSync(path.join(source, name), 'utf8').trim();
const save = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const load = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const code = (...names) => names.map(read).join('\n\n');

export function patchCabinPolicy(original, kind) {
  let graph = structuredClone(original);
  if (kind === 'dialogue') {
    graph = patchSleepComfort(graph);
    const byId = id => graph.nodes.find(row => row.id === id);
    const input = byId('1000000000002');
    input.data.code = input.data.code.split('_cabin_policy_input = main')[0].trim() + '\n\n' + read('cabin_policy_input.py');
    const guard = byId('1000000000006');
    guard.data.code = guard.data.code.split('_cabin_policy_guard = main')[0].trim() + '\n\n' + read('cabin_policy_guard.py');
    for (const node of [input, guard]) {
      node.data.code = node.data.code.replace('"passenger_wake", "near_destination",', '"driver_distracted", "passenger_wake", "near_destination",');
    }
    for (const id of ['1000000000021', '1000000000024']) {
      const node = byId(id), marker = '_preflight_dialogue_guard = main';
      const start = node.data.code.indexOf(marker);
      assert.ok(start > 0);
      node.data.code = guard.data.code + '\n\n' + node.data.code.slice(start);
    }
    for (const node of graph.nodes.filter(row => row.data.type === 'llm')) {
      const prompt = node.data.prompt_template.find(row => row.role === 'system');
      const marker = '只输出一个完整JSON对象，严格满足如下JSON Schema，校验失败会重试一次：\n';
      assert.ok(prompt.text.includes(marker));
      prompt.text = prompt.text.replace(/座舱能力与游戏连续性：[\s\S]*?(?=只输出一个完整JSON对象)/, '')
        .replace(marker, () => read('cabin-policy-prompt.txt') + '\n\n' + marker);
      prompt.text = prompt.text.replace('玩家要求提示/线索/暗示不构成授权。拒绝额外提示，不泄露谜底、隐藏提示或新增事实。',
        '玩家求助只重述public_clues中的公开内容，不授权额外提示，不泄露答案或新增事实。');
    }
  } else {
    const input = graph.nodes.find(row => row.id === '3000000000002');
    const start = input.data.code.indexOf('_normalize_original = main');
    const end = input.data.code.indexOf('_experience_scene_input = main', start);
    assert.ok(start > 0 && end > start);
    input.data.code = input.data.code.slice(0, start) + read('scene_input.py') + '\n\n' + input.data.code.slice(end);
    for (const node of graph.nodes.filter(row => row.data.type === 'code')) {
      node.data.code = node.data.code.replace('P0_EVENTS = {"hard_brake", "safety_pause",', 'P0_EVENTS = {"temporary_interruption", "hard_brake", "safety_pause",')
        .replace('"passenger_wake", "near_destination",', '"driver_distracted", "passenger_wake", "near_destination",');
    }
    const fast = graph.nodes.find(row => row.id === '3000000000021');
    fast.data.code = code('common.py', 'parallel_common.py', 'experience_common.py', 'scene_priority_context.py');
  }
  const perception = read('common.py').split('def perception_snapshot(payload):')[1].split('\n\ndef decision_trace(')[0];
  for (const node of graph.nodes.filter(row => row.data.type === 'code')) {
    if (node.data.code.includes('def perception_snapshot(payload):')) {
      node.data.code = node.data.code.replace(/def perception_snapshot\(payload\):[\s\S]*?(?=\n\ndef decision_trace\()/,
        () => 'def perception_snapshot(payload):' + perception);
    }
  }
  return graph;
}

async function draftRun(kind, name, snapshot, scene = {}, query = '') {
  const endpoint = kind === 'dialogue' ? 'advanced-chat/workflows/draft/run' : 'workflows/draft/run';
  const response = await request(`/apps/${apps[kind]}/${endpoint}`, { method: 'POST', raw: true, body: {
    inputs: { snapshot: JSON.stringify(snapshot), ...(kind === 'dialogue' ? { situation: JSON.stringify(scene) } : {}) },
    query, response_mode: 'streaming',
  } });
  const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith('data:')).flatMap(line => {
    try { return [JSON.parse(line.slice(5))]; } catch { return []; }
  });
  save(`${name}.json`, events);
  const finish = events.find(row => row.event === 'workflow_finished')?.data;
  assert.equal(finish?.status, 'succeeded', `${name}: ${finish?.error || 'no finish'}`);
  if (kind === 'situation') return JSON.parse(finish.outputs.scene_output);
  const value = events.find(row => row.event === 'node_finished' && row.data.node_id === '1000000000020')?.data.outputs.host_result;
  const host = JSON.parse(value);
  assert.equal(host.decision_trace.guard_status, 'passed', `${name}: ${JSON.stringify(host.debug)}`);
  assert.ok(!host.ai_reply_text.includes(snapshot.game.current_answer));
  const report = { name, run_id: finish.id, speech: host.ai_reply_text, actions: host.execution.actions, guard: host.decision_trace.guard_status };
  console.log(JSON.stringify(report));
  return { host, report };
}

async function verify() {
  const hashes = {};
  for (const [kind, id] of Object.entries(apps)) {
    hashes[kind] = (await request(`/apps/${id}/workflows/draft`)).hash;
    assert.equal(hashes[kind], load(`${kind}-release.json`).saved_hash);
  }
  const local = spawnSync('python3', [path.join(root, 'tests/cabin-policy-guard.py'), folder], { encoding: 'utf8' });
  assert.equal(local.status, 0, local.stdout + local.stderr); console.log(local.stdout.trim());
  const reports = [];
  const base = () => ({ game_id: 'cabin-policy-independent-test', round_id: 'cabin-policy-independent-test-r1', scene_version: 'policy-v1',
    game: { status: 'playing', current_answer: '海豚', round_index: 1, question_count: 3, max_questions: 15,
      public_clues: ['它不是人造的。', '它生活在水里。'] },
    car: { speed: 50, environment: '城区晴天白天', sleep_comfort_seats: [] },
    passengers: { selected_seat: 'front', states: { driver: 'normal', front: 'normal', rearLeft: 'normal', rearRight: 'normal' } } });
  for (const [name, query] of [['hint', '给我一点提示'], ['difficult', '太难了帮帮我'],
    ['light-off', '请关闭副驾的灯光'], ['light-on', '打开后排右的灯光'], ['light-ambiguous', '把灯关了'],
    ['cold', '我好冷'], ['eta', '还有多久到'], ['theme', '换个主题'], ['music', '关闭背景音乐'],
    ['ordinary', '它是人造的吗？']]) {
    const result = await draftRun('dialogue', name, base(), {}, query);
    if (name === 'hint' || name === 'difficult') {
      assert.match(result.host.ai_reply_text, /它生活在水里/);
      assert.doesNotMatch(result.host.ai_reply_text, /已公开回答|已公开：/);
    }
    if (name.startsWith('light-') && name !== 'light-ambiguous') assert.equal(result.host.execution.actions[0]?.type, 'cabin.set_zone_light');
    if (['light-ambiguous', 'cold', 'eta', 'theme', 'ordinary'].includes(name)) assert.deepEqual(result.host.execution.actions, []);
    if (name === 'ordinary') assert.match(result.host.ai_reply_text, /不/);
    reports.push(result.report);
  }
  for (const type of ['passenger_sleep', 'passenger_wake', 'driver_tired', 'driver_distracted']) {
    const snapshot = base(), now = Date.now();
    snapshot.event = { id: `${type}-${now}`, type, seat: 'rearRight', priority: type.startsWith('driver_') ? 'P1' : 'P2', duration_ms: 16000, state: 'fatigued' };
    if (type === 'passenger_sleep') snapshot.passengers.states.rearRight = 'sleeping';
    if (type === 'passenger_wake') snapshot.car.sleep_comfort_seats = ['rearRight'];
    if (type.startsWith('driver_')) snapshot.passengers.states.driver = type === 'driver_tired' ? 'fatigued' : 'distracted';
    snapshot.trigger_type = 'event';
    const scene = await draftRun('situation', `${type}-analysis`, snapshot);
    assert.equal(scene.analysis_status, 'ready');
    Object.assign(scene, { request_host_decision: type.startsWith('passenger_'), host_decision_seat: 'rearRight' });
    snapshot.dialogue_request = { kind: 'situation_event', event_id: snapshot.event.id };
    const result = await draftRun('dialogue', type, snapshot, scene, '请回应本次座舱事件。');
    if (type.startsWith('driver_')) { assert.deepEqual(result.host.execution.actions, []); assert.doesNotMatch(result.host.ai_reply_text, /猜谜提神|游戏提神|主驾.{0,8}(?:猜一|回答|加入)/); }
    else if (result.host.execution.actions.length) {
      assert.match(result.host.ai_reply_text, /灯/); assert.match(result.host.ai_reply_text, /空调/);
      if (type === 'passenger_sleep') assert.match(result.host.ai_reply_text, /记忆/);
    }
    if (type === 'passenger_sleep') assert.deepEqual(result.host.execution.actions, [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }]);
    if (type === 'driver_distracted') assert.ok(scene.perception.signals.some(signal => signal.field === 'driver_state' && signal.value === '分心'));
    reports.push(result.report);
  }
  const paused = base(); paused.game.status = 'paused'; paused.trigger_type = 'event'; paused.event = { id: 'interrupt-test', type: 'temporary_interruption', priority: 'P0' };
  const observation = await draftRun('situation', 'temporary-interruption', paused);
  assert.equal(observation.request_proactive_speech, false);
  save('verification.json', { passed: true, hashes, reports, checked_at: new Date().toISOString() });
}

async function main() {
  if (mode === 'verify') return verify();
  for (const [kind, id] of Object.entries(apps)) {
    const base = `/apps/${id}/workflows`, current = await request(`${base}/draft`);
    if (mode === 'status') { console.log(JSON.stringify({ kind, hash: current.hash, published: (await request(`${base}/publish`)).hash })); continue; }
    if (mode === 'prepare') {
      save(`${kind}-before-${current.hash}.json`, current);
      const candidate = { ...current, graph: patchCabinPolicy(current.graph, kind) };
      save(`${kind}-candidate.json`, candidate);
      const release = { expected_hash: current.hash, changed_nodes: candidate.graph.nodes.filter(node => JSON.stringify(node) !== JSON.stringify(current.graph.nodes.find(row => row.id === node.id))).map(node => node.id) };
      save(`${kind}-release.json`, release); console.log(JSON.stringify({ kind, ...release })); continue;
    }
    const release = load(`${kind}-release.json`);
    assert.equal(current.hash, mode === 'save' ? release.expected_hash : release.saved_hash, 'Cloud changed; reread before continuing.');
    if (mode === 'save') {
      const candidate = load(`${kind}-candidate.json`);
      await request(`${base}/draft`, { method: 'POST', body: { graph: candidate.graph, features: current.features,
        conversation_variables: current.conversation_variables || [], hash: current.hash } });
      const saved = await request(`${base}/draft`); assert.deepEqual(saved.graph, candidate.graph);
      for (const key of ['features', 'conversation_variables', 'environment_variables']) assert.deepEqual(saved[key], current[key]);
      release.saved_hash = saved.hash; save(`${kind}-release.json`, release); console.log(JSON.stringify({ kind, saved_hash: saved.hash }));
    } else {
      const verification = load('verification.json'); assert.equal(verification.passed, true); assert.equal(verification.hashes[kind], current.hash);
      await request(`${base}/publish`, { method: 'POST', body: { marked_name: '入睡必启关怀与主驾分心感知', marked_comment: '有效入睡必须关灯、分区音量0、空调调至用户记忆值；补齐漏动作与主驾分心感知，仍等气泡实际显示后由前端执行。' } });
      const published = await request(`${base}/publish`); assert.equal(published.hash, current.hash);
      release.published_hash = published.hash; save(`${kind}-release.json`, release);
      const file = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel', kind === 'dialogue' ? 'host-dialogue-v4.yml' : 'cabin-situation-v1.yml');
      const dsl = YAML.parse(fs.readFileSync(file, 'utf8'));
      for (const key of ['graph', 'features', 'conversation_variables', 'environment_variables']) if (published[key] !== undefined) dsl.workflow[key] = published[key];
      fs.writeFileSync(file, YAML.stringify(dsl, { lineWidth: 120 }));
      const manifest = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel/cloud-apps.json');
      const all = JSON.parse(fs.readFileSync(manifest, 'utf8')); all.published_hashes[kind] = published.hash; all.checked_at = new Date().toISOString();
      fs.writeFileSync(manifest, JSON.stringify(all, null, 2) + '\n');
      console.log(JSON.stringify({ kind, published_hash: published.hash }));
    }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
