import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { requestConsoleJson as request } from '../src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'tools/dify-workflow-mcp/workflows/host/src');
const folder = path.join(root, 'tmp/dify-import/game-control');
const app = '74bef8bd-22bd-4e19-91da-5e8d645dd8ed';
const base = `/apps/${app}/workflows`;
const read = name => fs.readFileSync(path.join(source, name), 'utf8').trim();
const save = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const load = name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));

export function patchGameControl(original) {
  const graph = structuredClone(original);
  const byId = id => graph.nodes.find(node => node.id === id);
  for (const [id, marker, file] of [
    ['1000000000002', '_cabin_policy_input = main', 'cabin_policy_input.py'],
    ['1000000000006', '_cabin_policy_guard = main', 'cabin_policy_guard.py'],
  ]) {
    const node = byId(id), at = node.data.code.lastIndexOf(marker);
    assert.ok(at > 0 && node.data.code.trim().endsWith(file.includes('input') ? 'return result' : 'return {"workflow_output": encode(result)}'));
    node.data.code = node.data.code.slice(0, at) + read(file);
  }
  const schema = read('dialogue-output.schema.json');
  for (const id of ['1000000000021', '1000000000024']) {
    const node = byId(id), marker = '_preflight_dialogue_guard = main';
    const at = node.data.code.indexOf(marker);
    assert.ok(at > 0 && /^DIALOGUE_OUTPUT_SCHEMA = .+$/m.test(node.data.code));
    node.data.code = byId('1000000000006').data.code + '\n\n' + node.data.code.slice(at)
      .replace(/^DIALOGUE_OUTPUT_SCHEMA = .+$/m, () => `DIALOGUE_OUTPUT_SCHEMA = ${JSON.stringify(schema)}`);
  }
  for (const node of graph.nodes.filter(row => row.data.type === 'llm')) {
    const prompt = node.data.prompt_template.find(row => row.role === 'system');
    const marker = '只输出一个完整JSON对象，严格满足如下JSON Schema，校验失败会重试一次：\n';
    const at = prompt.text.indexOf(marker);
    const end = prompt.text.indexOf('\n上次校验结果', at + marker.length);
    assert.ok(at > 0); JSON.parse(prompt.text.slice(at + marker.length, end < 0 ? undefined : end));
    const suffix = end < 0 ? '' : prompt.text.slice(end);
    const prefix = prompt.text.slice(0, at).replace(/座舱能力与游戏连续性：[\s\S]*$/, '');
    prompt.text = `${prefix}${read('cabin-policy-prompt.txt')}\n\n${marker}${schema}${suffix}`;
  }
  assert.deepEqual(graph.edges, original.edges);
  return graph;
}

async function runDraft(name, query, snapshot) {
  const response = await request(`/apps/${app}/advanced-chat/workflows/draft/run`, { method: 'POST', raw: true,
    body: { inputs: { snapshot: JSON.stringify(snapshot), situation: '{}' }, query, response_mode: 'streaming' } });
  const events = (await response.text()).split(/\r?\n/).flatMap(line => {
    try { return line.startsWith('data:') ? [JSON.parse(line.slice(5))] : []; } catch { return []; }
  });
  save(`${name}.json`, events);
  const finish = events.find(row => row.event === 'workflow_finished')?.data;
  assert.equal(finish?.status, 'succeeded', name + ': ' + finish?.error);
  const output = events.find(row => row.event === 'node_finished' && row.data.node_id === '1000000000020')?.data.outputs.host_result;
  const host = JSON.parse(output);
  assert.equal(host.decision_trace.guard_status, 'passed', name + ': ' + JSON.stringify(host.debug));
  assert.ok(!host.ai_reply_text.includes(snapshot.game.current_answer));
  const report = { name, run_id: finish.id, speech: host.ai_reply_text, actions: host.execution.actions,
    game_status: host.game_status, guard: host.decision_trace.guard_status };
  console.log(JSON.stringify(report));
  return { host, report };
}

async function main() {
  const mode = process.argv[2] || 'status';
  assert.ok(['status', 'prepare', 'save', 'verify', 'publish'].includes(mode));
  fs.mkdirSync(folder, { recursive: true });
  const current = await request(`${base}/draft`);
  if (mode === 'status') {
    console.log(JSON.stringify({ app, draft_hash: current.hash, published_hash: (await request(`${base}/publish`)).hash }));
    return;
  }
  if (mode === 'prepare') {
    const candidate = { ...current, graph: patchGameControl(current.graph) };
    save(`dialogue-before-${current.hash}.json`, current); save('dialogue-candidate.json', candidate);
    save('situation-candidate.json', await request('/apps/bc1ce5be-d5c5-4885-84c5-72c2c1f63d18/workflows/draft'));
    const changed = candidate.graph.nodes.filter(node => JSON.stringify(node) !== JSON.stringify(current.graph.nodes.find(row => row.id === node.id)))
      .map(node => ({ id: node.id, title: node.data.title }));
    const release = { app_id: app, expected_hash: current.hash, changed_nodes: changed };
    save('release.json', release); console.log(JSON.stringify(release)); return;
  }
  const release = load('release.json');
  assert.equal(current.hash, mode === 'save' ? release.expected_hash : release.saved_hash, 'Cloud changed; reread before proceeding.');
  if (mode === 'save') {
    await request(`${base}/draft`, { method: 'POST', body: { graph: load('dialogue-candidate.json').graph,
      features: current.features, conversation_variables: current.conversation_variables || [], hash: current.hash } });
    const saved = await request(`${base}/draft`);
    assert.deepEqual(saved.graph, load('dialogue-candidate.json').graph);
    for (const key of ['features', 'conversation_variables', 'environment_variables']) assert.deepEqual(saved[key], current[key]);
    release.saved_hash = saved.hash; save('release.json', release); console.log(JSON.stringify({ saved_hash: saved.hash })); return;
  }
  if (mode === 'verify') {
    for (const script of ['game-control-guard.py', 'cabin-policy-guard.py']) {
      const local = spawnSync('python3', [path.join(root, 'tests', script), folder], { encoding: 'utf8' });
      assert.equal(local.status, 0, local.stdout + local.stderr); console.log(local.stdout.trim());
    }
    const snapshot = () => ({ game_id: 'game-control-independent-test', round_id: 'game-control-independent-test-round-2', scene_version: 'control-v1',
      game: { status: 'playing', pause_reason: '', current_answer: '海豚', round_index: 2, total_rounds: 6,
        question_count: 3, max_questions: 15, public_clues: ['它不是人造的。'] }, car: { environment: '城区晴天白天', speed: 50 },
      passengers: { selected_seat: 'front', states: { driver: 'normal', front: 'normal', rearLeft: 'normal', rearRight: 'normal' } } });
    const reports = [];
    for (const [name, query, status, reason, expected] of [
      ['pause', '暂停游戏', 'playing', '', true], ['resume', '继续游戏', 'paused', 'user', false],
      ['repeat-pause', '暂停游戏', 'paused', 'user', true], ['already-running', '继续游戏', 'playing', '', false],
      ['safety-protected', '继续游戏', 'paused', 'safety', null], ['negative-pause', '不要暂停游戏', 'playing', '', null],
      ['hypothetical', '如果暂停游戏会怎样', 'playing', '', null], ['ordinary-question', '它是人造的吗？', 'playing', '', null],
    ]) {
      const input = snapshot(); input.game.status = status; input.game.pause_reason = reason;
      const result = await runDraft(name, query, input);
      assert.deepEqual(result.host.execution.actions, expected === null ? [] : [{ type: 'game.set_paused', paused: expected }]);
      assert.equal(result.host.game_status, status);
      if (expected !== null) assert.deepEqual(result.host.covered_fact_keys, []);
      reports.push(result.report);
    }
    save('verification.json', { passed: true, hash: current.hash, reports, checked_at: new Date().toISOString() }); return;
  }
  const verification = load('verification.json');
  assert.equal(verification.passed, true); assert.equal(verification.hash, current.hash);
  await request(`${base}/publish`, { method: 'POST', body: { marked_name: '明确指令暂停与继续游戏',
    marked_comment: '新增受限game.set_paused动作；仅明确指令授权，保留进度，不解除安全暂停；同步主模型、重试、Schema与动作守卫。' } });
  const published = await request(`${base}/publish`); assert.equal(published.hash, current.hash);
  release.published_hash = published.hash; save('release.json', release);
  const file = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel/host-dialogue-v4.yml');
  const dsl = YAML.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['graph', 'features', 'conversation_variables', 'environment_variables']) if (published[key] !== undefined) dsl.workflow[key] = published[key];
  fs.writeFileSync(file, YAML.stringify(dsl, { lineWidth: 120 }));
  const manifest = path.join(root, 'tools/dify-workflow-mcp/workflows/parallel/cloud-apps.json');
  const data = JSON.parse(fs.readFileSync(manifest, 'utf8')); data.published_hashes.dialogue = published.hash; data.checked_at = new Date().toISOString();
  fs.writeFileSync(manifest, JSON.stringify(data, null, 2) + '\n'); console.log(JSON.stringify({ published_hash: published.hash }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
