import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = new URL('../../workflows/host/src/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, source), 'utf8').trim();
const code = (...names) => names.map(read).join('\n\n');

export function patchSituationDialogue(graph, kind) {
  const byId = id => graph.nodes.find(node => node.id === id);
  if (kind === 'dialogue') {
    const input = byId('1000000000002');
    const guard = byId('1000000000006');
    assert.equal(input?.data.type, 'code');
    assert.equal(guard?.data.type, 'code');
    input.data.code = input.data.code.split('_event_dialogue_input = main')[0].trim() + '\n\n' + read('dialogue_event_input.py');
    guard.data.code = guard.data.code.split('_event_dialogue_guard = main')[0].trim() + '\n\n' + read('dialogue_event_guard.py');
    guard.data.code = guard.data.code.replaceAll('range(1, 28)', 'range(1, 29)');
    input.data.desc = '普通乘客问答读取原话；情境串词验证当前事件、分析作用域与有效期，使用同一持久会话。';
    for (const node of graph.nodes.filter(node => node.data.type === 'llm')) {
      const prompt = node.data.prompt_template.find(row => row.role === 'system');
      prompt.text = prompt.text.split('\n\n情境事件回应：')[0] + '\n\n' + read('event-dialogue-prompt.txt');
    }
    return graph;
  }
  const input = byId('3000000000002');
  const start = input.data.code.indexOf('_normalize_original = main');
  const end = input.data.code.indexOf('_experience_scene_input = main', start);
  assert.ok(start >= 0 && end > start, 'Expected current scene input and feedback wrappers.');
  input.data.code = input.data.code.slice(0, start) + read('scene_input.py') + '\n\n' + input.data.code.slice(end);
  input.data.outputs.priority_fast_path = { type: 'boolean', children: null };
  delete input.data.outputs.environment_fast_path;
  let branch = byId('3000000000020');
  if (!branch) {
    branch = structuredClone(byId('3000000000005'));
    branch.id = '3000000000020';
    branch.position = branch.positionAbsolute = { x: 1100, y: 1100 };
    branch.data.cases = [{ id: 'priority', case_id: 'priority', logical_operator: 'and', conditions: [{
      id: 'priority-condition', variable_selector: [input.id, 'priority_fast_path'], comparison_operator: 'is', value: true, varType: 'boolean',
    }] }];
    const context = structuredClone(byId('3000000000008'));
    context.id = '3000000000021';
    context.position = context.positionAbsolute = { x: 1500, y: 1100 };
    context.data.variables = [{ variable: 'context_json', value_selector: [input.id, 'context_json'] }];
    context.data.outputs = { director_context: { type: 'string', children: null } };
    const incoming = graph.edges.find(edge => edge.target === '3000000000007');
    assert.ok(incoming, 'Expected an entry to situation analysis.');
    incoming.target = branch.id;
    incoming.id = `${incoming.source}-${incoming.sourceHandle}-${branch.id}-target`;
    incoming.data.targetType = 'if-else';
    graph.nodes.push(branch, context);
    for (const [from, to, handle = 'source', sourceType, targetType] of [
      [branch.id, context.id, 'priority', 'if-else', 'code'],
      [branch.id, '3000000000007', 'false', 'if-else', 'llm'],
      [context.id, '3000000000012', 'source', 'code', 'variable-aggregator'],
    ]) graph.edges.push({ id: `${from}-${handle}-${to}-target`, source: from, target: to,
      sourceHandle: handle, targetHandle: 'target', type: 'custom', zIndex: 0,
      data: { sourceType, targetType, isInIteration: false, isInLoop: false } });
    byId('3000000000012').data.variables.push([context.id, 'director_context']);
  }
  branch.data.title = 'P1 规则分析快速分支';
  branch.data.cases[0].conditions[0].variable_selector = [input.id, 'priority_fast_path'];
  branch.data.desc = '环境变化、首次超速、主驾持续疲惫零模型零检索，立即返回分析供Chatflow表达。';
  const context = byId('3000000000021');
  context.data.title = 'P1 当前事件与回应策略';
  context.data.code = code('common.py', 'parallel_common.py', 'experience_common.py', 'scene_priority_context.py');
  context.data.desc = '输出可信当前观察和主动回应建议；不生成主持人话术。';
  const guard = byId('3000000000014');
  guard.data.title = '分析结果与发言建议';
  guard.data.code = code('common.py', 'parallel_common.py', 'experience_common.py', 'scene_analysis_result.py');
  guard.data.variables = [
    { variable: 'payload', value_selector: [input.id, 'payload'] },
    { variable: 'director_context', value_selector: ['3000000000012', 'output'] },
  ];
  guard.data.desc = '只输出分析、经验、发言建议和有效期；host_response为空，由前端路由到Chatflow。';
  const rule = byId('3000000000015');
  rule.data.code = code('common.py', 'parallel_common.py', 'scene_rule_result.py');
  const directorId = '3000000000013';
  graph.nodes = graph.nodes.filter(node => node.id !== directorId);
  graph.edges = graph.edges.filter(edge => edge.source !== directorId && edge.target !== directorId);
  if (!graph.edges.some(edge => edge.source === '3000000000012' && edge.target === guard.id)) {
    graph.edges.push({ id: `3000000000012-source-${guard.id}-target`, source: '3000000000012', target: guard.id,
      sourceHandle: 'source', targetHandle: 'target', type: 'custom', zIndex: 0,
      data: { sourceType: 'variable-aggregator', targetType: 'code', isInIteration: false, isInLoop: false } });
  }
  const note = byId('scene-note-2');
  if (note) note.data.text = 'P0由前端立即响应，后台仅记录。\nP1环境/超速/疲惫走零模型零检索规则分析。\n情境Workflow只输出分析；前端随后调用Chatflow生成一句串词。';
  return graph;
}
