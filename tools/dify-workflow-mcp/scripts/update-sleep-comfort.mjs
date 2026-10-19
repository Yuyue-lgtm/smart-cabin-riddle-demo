import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { requestConsoleJson as request } from '../src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'tools/dify-workflow-mcp/workflows/host/src');
const folder = path.join(root, 'tmp/dify-import/sleep-comfort');
const appId = '74bef8bd-22bd-4e19-91da-5e8d645dd8ed';
const base = `/apps/${appId}/workflows`;
const mode = process.argv[2] || 'status';
assert.ok(['status', 'prepare', 'save', 'verify', 'publish'].includes(mode));
fs.mkdirSync(folder, { recursive: true });
const read = name => fs.readFileSync(path.join(source, name), 'utf8').trim();
const save = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const load = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));

export function patchSleepComfort(graph) {
  graph = structuredClone(graph);
  const input = graph.nodes.find(node => node.id === '1000000000002');
  const guard = graph.nodes.find(node => node.id === '1000000000006');
  const replaceWrapper = (node, marker, filename) => {
    const index = node.data.code.indexOf(marker);
    assert.ok(index > 0, `Missing wrapper: ${marker}`);
    node.data.code = node.data.code.slice(0, index) + read(filename);
  };
  replaceWrapper(input, '_event_dialogue_input = main', 'dialogue_event_input.py');
  replaceWrapper(guard, '_event_dialogue_guard = main', 'dialogue_event_guard.py');
  const schema = read('dialogue-output.schema.json');
  for (const id of ['1000000000021', '1000000000024']) {
    const node = graph.nodes.find(row => row.id === id);
    const index = node.data.code.indexOf('_preflight_dialogue_guard = main');
    assert.ok(index > 0);
    node.data.code = guard.data.code + '\n\n' + node.data.code.slice(index)
      .replace(/^DIALOGUE_OUTPUT_SCHEMA = .*$/m, () => `DIALOGUE_OUTPUT_SCHEMA = ${JSON.stringify(schema)}`);
  }
  for (const id of ['1000000000005', '1000000000023']) {
    const node = graph.nodes.find(row => row.id === id);
    const prompt = node.data.prompt_template.find(row => row.role === 'system');
    assert.match(prompt.text, /情境事件回应：/);
    prompt.text = prompt.text.replace(/情境事件回应：[^\n]*/, () => read('event-dialogue-prompt.txt'))
      .replace(/^- 只有明确音乐开关请求[^\n]*/m, '- 普通乘客对话只有明确音乐开关请求可提出music.set_enabled；情境睡眠关怀由主持人按独立规则决定，前端负责校验执行。')
      .replace(/^execution_actions (?:仅在|在普通乘客对话中)[^\n]*/m, 'execution_actions 在普通乘客对话中仅在明确音乐开关请求时提出music.set_enabled，否则[]。只有当前睡眠/醒来情境的候选座位可分别请求cabin.apply_sleep_comfort或cabin.restore_sleep_comfort，必须有描述灯光、空调和分区音量的话术，前端等话术开始显示后执行。');
    const marker = '只输出一个完整JSON对象，严格满足如下JSON Schema，校验失败会重试一次：\n';
    const index = prompt.text.indexOf(marker);
    assert.ok(index > 0, 'Missing model schema');
    const suffix = prompt.text.indexOf('\n上次校验结果（', index);
    prompt.text = prompt.text.slice(0, index) + marker + schema + (suffix < 0 ? '' : prompt.text.slice(suffix));
  }
  return graph;
}

async function runDraft(name, snapshot, scene, query) {
  const response = await request(`/apps/${appId}/advanced-chat/workflows/draft/run`, { method: 'POST', raw: true, body: {
    inputs: { snapshot: JSON.stringify(snapshot), situation: JSON.stringify(scene) }, query, response_mode: 'streaming',
  } });
  const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith('data:')).flatMap(line => {
    try { return [JSON.parse(line.slice(5))]; } catch { return []; }
  });
  save(`${name}.json`, { events });
  const finish = events.find(row => row.event === 'workflow_finished')?.data;
  const nodes = events.filter(row => row.event === 'node_finished').map(row => row.data);
  assert.equal(finish?.status, 'succeeded', `${name}: ${finish?.error || 'not completed'}`);
  const result = JSON.parse(nodes.find(node => node.node_id === '1000000000020')?.outputs?.host_result || 'null');
  assert.ok(result);
  assert.ok(['passed', 'hint_blocked'].includes(result.decision_trace.guard_status), `${name}: guard failed`);
  assert.ok(!result.ai_reply_text.includes(snapshot.game.current_answer));
  const actions = result.execution.actions;
  if (actions.some(action => action.type.startsWith('cabin.'))) {
    assert.match(result.ai_reply_text, /灯/);
    assert.match(result.ai_reply_text, /空调|温度/);
    assert.match(result.ai_reply_text, /音量|声音|静音/);
  }
  if (name.startsWith('sleep-') || name.startsWith('wake-')) {
    const type = name.startsWith('wake-') ? 'cabin.restore_sleep_comfort' : 'cabin.apply_sleep_comfort';
    assert.ok(actions.every(action => action.type === type && action.seat === snapshot.event.seat));
    if (name.startsWith('wake-')) assert.equal(actions.length, 1);
  }
  else if (name === 'music') assert.deepEqual(actions.map(({ type, enabled }) => ({ type, enabled })), [{ type: 'music.set_enabled', enabled: false }]);
  else assert.deepEqual(actions, []);
  const report = { name, run_id: events.find(row => row.event === 'workflow_started')?.data?.id,
    speech: result.ai_reply_text, actions, guard_status: result.decision_trace.guard_status };
  console.log(JSON.stringify(report));
  return report;
}

async function main() {
  const current = await request(`${base}/draft`);
  if (mode === 'status') return console.log(JSON.stringify({ app_id: appId, hash: current.hash }));
  if (mode === 'prepare') {
    const candidate = { ...current, graph: patchSleepComfort(current.graph) };
    save(`before-${current.hash}.json`, { draft: current, published: await request(`${base}/publish`) });
    save('candidate.json', candidate);
    const release = { app_id: appId, expected_hash: current.hash,
      changed_nodes: candidate.graph.nodes.filter(node => JSON.stringify(node) !== JSON.stringify(current.graph.nodes.find(row => row.id === node.id)))
        .map(node => ({ id: node.id, title: node.data.title })) };
    save('release.json', release);
    console.log(JSON.stringify(release));
    return;
  }
  const release = load('release.json');
  assert.equal(current.hash, mode === 'save' ? release.expected_hash : release.saved_hash, 'Draft changed; review before continuing.');
  if (mode === 'save') {
    const graph = load('candidate.json').graph;
    await request(`${base}/draft`, { method: 'POST', body: {
      graph, features: current.features, conversation_variables: current.conversation_variables || [], hash: current.hash,
    } });
    const updated = await request(`${base}/draft`);
    assert.deepEqual(updated.graph, graph);
    for (const key of ['features', 'conversation_variables', 'environment_variables']) assert.deepEqual(updated[key], current[key]);
    release.saved_hash = updated.hash;
    save('release.json', release);
    console.log(JSON.stringify({ saved_hash: updated.hash, published: false }));
  } else if (mode === 'verify') {
    const local = spawnSync('python3', [path.join(root, 'tests/cabin-sleep-comfort-guard.py'), path.join(folder, 'candidate.json')], { encoding: 'utf8' });
    assert.equal(local.status, 0, local.stderr || local.stdout);
    console.log(local.stdout.trim());
    const reports = [];
    for (const name of ['sleep-rearRight', 'sleep-front', 'sleep-silent', 'wake-silent', 'wake-front', 'no-sleep', 'environment', 'hint', 'music']) {
      const seat = name.endsWith('front') ? 'front' : 'rearRight';
      const waking = name.startsWith('wake-');
      const comfort = waking || name.startsWith('sleep-');
      const kind = name === 'environment' ? 'environment_change' : waking ? 'passenger_wake' : 'passenger_sleep';
      const now = Date.now();
      const snapshot = { game_id: `comfort-${now}`, round_id: `comfort-${now}-r1`, scene_version: 'sv-comfort',
        car: { speed: 50, environment: '风景区晴天深夜', destination: '酒店', sleep_comfort_seats: waking ? [seat] : [] },
        game: { status: 'playing', current_answer: '海豚', round_index: 1, question_count: 2, max_questions: 15 },
        passengers: { selected_seat: 'front', states: { driver: 'normal', front: 'normal', rearLeft: 'normal', rearRight: 'normal' } },
        event: { id: `event-${name}-${now}`, type: kind, seat, priority: kind === 'environment_change' ? 'P1' : 'P2', value: '风景区晴天深夜', previous_value: '车库' },
      };
      if (name.startsWith('sleep-')) snapshot.passengers.states[seat] = 'sleeping';
      let scene = {};
      const chat = name === 'hint' || name === 'music';
      if (!chat) {
        snapshot.dialogue_request = { kind: 'situation_event', event_id: snapshot.event.id };
        scene = { game_id: snapshot.game_id, round_id: snapshot.round_id, scene_version: snapshot.scene_version,
          event_id: snapshot.event.id, analysis_status: 'ready', request_proactive_speech: !name.endsWith('silent'),
          request_host_decision: comfort, host_decision_seat: comfort ? seat : null,
          generated_at_ms: now, expires_at_ms: now + 60000,
          dialogue_context: { selected_snapshot: { passengers: snapshot.passengers.states },
            guidance: { strategy: 'soft_response', target_seat: null },
            knowhow: { status: 'not_relevant', retrieved: [], eligible_target_seats: ['front', 'rearLeft'] } },
        };
      }
      reports.push(await runDraft(name, snapshot, scene, name === 'hint' ? '给我一点提示' : name === 'music' ? '关闭背景音乐' : '当前座舱事件，请根据最新状态决定如何回应。'));
    }
    assert.ok(reports.some(row => row.name.startsWith('sleep-') && row.actions.length), 'No real model run chose sleep comfort; inspect decision before publishing.');
    save('verification.json', { passed: true, hash: current.hash, reports, checked_at: new Date().toISOString() });
  } else if (mode === 'publish') {
    const verification = load('verification.json');
    assert.equal(verification.passed, true);
    assert.equal(verification.hash, current.hash);
    await request(`${base}/publish`, { method: 'POST', body: { marked_name: '主持人自主睡眠关怀',
      marked_comment: '睡眠只提供候选；由主持人明确选择整套分区关灯、音量0和空调记忆值模拟。动作经过前后端作用域和睡眠条件校验。' } });
    const published = await request(`${base}/publish`);
    assert.equal(published.hash, current.hash);
    release.published_hash = published.hash;
    release.published_at = new Date().toISOString();
    save('release.json', release);
    const file = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel/host-dialogue-v4.yml');
    const dsl = YAML.parse(fs.readFileSync(file, 'utf8'));
    for (const key of ['graph', 'features', 'environment_variables', 'conversation_variables']) if (published[key] !== undefined) dsl.workflow[key] = published[key];
    fs.writeFileSync(file, YAML.stringify(dsl, { lineWidth: 120 }), { mode: 0o600 });
    const appsFile = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel/cloud-apps.json');
    const apps = JSON.parse(fs.readFileSync(appsFile, 'utf8'));
    apps.published_hashes.dialogue = published.hash;
    apps.checked_at = new Date().toISOString();
    fs.writeFileSync(appsFile, JSON.stringify(apps, null, 2) + '\n');
    console.log(JSON.stringify({ published_hash: published.hash, version: published.version }));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
