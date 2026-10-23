import test from 'node:test';
import assert from 'node:assert/strict';
import { patchHostStyle } from '../tools/dify-workflow-mcp/scripts/update-ecs-host-style.mjs';

function fixture() {
  return { features: {}, environment_variables: [], conversation_variables: [], graph: { edges: [], nodes: [
    ...['1000000000005', '1000000000023'].map(id => ({ id, data: { type: 'llm',
      model: { name: 'existing-model', completion_params: { temperature: 1.8 } },
      prompt_template: [{ role: 'system', text: '普通是/否问答直接、简短回答，不调用经验库内容扩写答案。\n只输出一个完整JSON对象，严格满足如下JSON Schema，校验失败会重试一次：\n{}' }] } })),
    ...['1000000000006', '1000000000021', '1000000000024'].map(id => ({ id, data: { type: 'code',
      code: 'base_safety = True\n_cabin_policy_guard = main\nold_policy = True\n'
        + (id === '1000000000006' ? '' : '\n_preflight_dialogue_guard = main\nstructured_schema = "unchanged"\n') } })),
  ] } };
}

test('style updates both LLM paths without changing models, state contracts or base safety code', () => {
  const original = fixture();
  const before = structuredClone(original);
  const result = patchHostStyle(original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.features, original.features);
  assert.deepEqual(result.graph.edges, original.graph.edges);
  for (const node of result.graph.nodes) {
    if (node.data.type === 'llm') {
      assert.deepEqual(node.data.model, original.graph.nodes.find(item => item.id === node.id).data.model);
      assert.match(node.data.prompt_template[0].text, /游戏搭子/);
      assert.doesNotMatch(node.data.prompt_template[0].text, /普通是\/否问答直接、简短回答/);
    } else {
      assert.ok(node.data.code.startsWith('base_safety = True\n'));
      assert.match(node.data.code, /def public_clue_recap/);
      if (node.id !== '1000000000006') assert.ok(node.data.code.endsWith('_preflight_dialogue_guard = main\nstructured_schema = "unchanged"\n'));
    }
  }
});

test('reapplying the style patch is idempotent', () => {
  const once = patchHostStyle(fixture());
  assert.deepEqual(patchHostStyle(once), once);
});

test('unexpected graph shape stops before editing a draft', () => {
  const value = fixture();
  value.graph.nodes.pop();
  assert.throws(() => patchHostStyle(value), /Expected host node/);
});
