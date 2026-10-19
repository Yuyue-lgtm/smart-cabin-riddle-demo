import fs from 'node:fs';
import { patchStructuredReliability } from './structured-reliability.mjs';

const source = new URL('../../workflows/host/src/', import.meta.url);
const read = name => fs.readFileSync(new URL(name, source), 'utf8').trim();
export const RELIABILITY_IDS = {
  normalize: '1000000000021', branch: '1000000000022', retry: '1000000000023',
  retryResult: '1000000000024', merge: '1000000000025',
};
const wrapperMarker = '_dialogue_base_guard_main = main';
const schema = JSON.parse(read('dialogue-output.schema.json'));

export function patchDialogueReliability(inputGraph) {
  const graph = structuredClone(inputGraph);
  const primary = graph.nodes.find(node => node.id === '1000000000005');
  const guard = graph.nodes.find(node => node.id === '1000000000006');
  const eventDialogue = guard?.data.code.includes('_event_dialogue_guard = main');
  if (primary?.data.type !== 'llm' || guard?.data.type !== 'code') throw new Error('Expected dialogue model and guard nodes.');
  if (primary.data.model.provider !== 'langgenius/deepseek/deepseek' || primary.data.model.name !== 'deepseek-flash') {
    throw new Error('Model changed; check its supported parameters before applying this patch.');
  }
  const ids = RELIABILITY_IDS;
  const added = new Set(Object.values(ids));
  graph.nodes = graph.nodes.filter(node => !added.has(node.id));
  graph.edges = graph.edges.filter(edge => !added.has(edge.source) && !added.has(edge.target)
    && !(edge.source === primary.id && edge.target === guard.id));
  primary.data.model.completion_params = {
    ...primary.data.model.completion_params, thinking: true, max_tokens: 4096,
  };
  delete primary.data.model.completion_params.temperature;
  delete primary.data.model.completion_params.top_p;
  delete primary.data.model.completion_params.reasoning_effort;
  primary.data.model.completion_params.reasoning_effort = 'low';
  delete primary.data.model.completion_params.response_format;
  primary.data.reasoning_format = 'separated';
  primary.data.structured_output_enabled = false;
  delete primary.data.structured_output;
  primary.data.retry_config = { retry_enabled: false, max_retries: 1, retry_interval: 1000 };
  primary.data.error_strategy = 'default-value';
  primary.data.default_value = [
    { key: 'text', type: 'string', value: '' },
  ];
  const answerRule = '属性问答判定：只依据当前题的谜底和题目事实判断所问属性，先明确回答是或不是，不补充不确定的背景。判断角色是否虚构时以角色本身为准，有创作原型不等于该角色真实存在。收到“好的”等承接语或闲聊时，仅回应当前话题；不得主动描述或暗示谜题属性、用途或位置，也不要说它就在身边。';
  const system = primary.data.prompt_template.find(prompt => prompt.role === 'system');
  system.text = system.text.replace('ai_reply_text 建议15至40个汉字，最多60字。',
    'ai_reply_text 最多60字；简单属性问题可只回答“是”或“不是”，不要为了凑字数补充类别、用途或位置等未问信息。');
  system.text = system.text.split('\n\n属性问答判定：')[0] + '\n\n' + answerRule;
  primary.data.desc = '低强度推理与最终JSON分离；代码校验有效输出，无效回复最多重试一次。';
  const retry = structuredClone(primary);
  retry.id = ids.retry;
  retry.data.title = '主持回复格式重试（仅一次）';
  retry.data.desc = '仅首轮无有效结构化回复时执行；沿用同一会话与当前题，不把失败内容加入对话。';
  retry.data.prompt_template = retry.data.prompt_template.map(prompt => ({ ...prompt, id: `${ids.retry}-${prompt.role}` }));
  retry.data.prompt_template[0].text += '\n\n上一次调用未生成有效的最终回复。请重新回答本轮玩家原话，直接输出完整JSON对象，必须包含非空ai_reply_text和合法strategy；不要输出思考过程或解释。只回答玩家所问的属性，不补充所在位置、用途等未问信息。所有游戏与安全约束仍然有效。';
  const normalizer = `${read('dialogue_model_output.py')}\n\nDIALOGUE_OUTPUT_SCHEMA = ${JSON.stringify(JSON.stringify(schema))}`;
  const variable = (name, node, field) => ({ variable: name, value_selector: [node, field] });
  const outputs = fields => Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, { type, children: null }]));
  const node = (id, title, type, data, x, y, desc) => ({ id, type: 'custom', width: 242, height: 120,
    position: { x, y }, positionAbsolute: { x, y }, sourcePosition: 'right', targetPosition: 'left', zIndex: 0,
    data: { type, title, desc, selected: false, ...data } });
  const codeNode = (id, title, code, variables, fields, x, y, desc) => node(id, title, 'code', {
    code_language: 'python3', code, variables, outputs: outputs(fields),
  }, x, y, desc);
  const modelVars = id => [variable('director_text', id, 'text')];
  retry.position = retry.positionAbsolute = { x: 1970, y: 710 };
  graph.nodes.push(
    codeNode(ids.normalize, '优先读取结构化回复', normalizer, modelVars(primary.id),
      { model_result: 'string', needs_retry: 'boolean' }, 1330, 480, '优先校验structured_output；兼容去掉思考段后的最终JSON文本，空结果或无效格式申请一次重试。'),
    node(ids.branch, '回复是否需要重试', 'if-else', { cases: [{ id: 'retry', case_id: 'retry', logical_operator: 'and',
      conditions: [{ id: 'retry-condition', variable_selector: [ids.normalize, 'needs_retry'], comparison_operator: 'is', value: true, varType: 'boolean' }] }] },
      1650, 480, '正常回复直接通过；仅无效模型输出进入单次重试，没有回环。'),
    retry,
    codeNode(ids.retryResult, '记录重试结果', `${normalizer}\n\n${read('dialogue_retry_result.py')}`,
      [...modelVars(ids.retry), variable('previous_result', ids.normalize, 'model_result')], { model_result: 'string' },
      2290, 710, '保留两次尝试的来源与失败原因；第二次失败明确标记retry_exhausted，不再请求模型。'),
    node(ids.merge, '选取最终模型结果', 'variable-aggregator', { output_type: 'string',
      variables: [[ids.retryResult, 'model_result'], [ids.normalize, 'model_result']] },
      2610, 480, '重试分支优先；正常分支沿用首次输出。只有最后的自然回复进入Answer和Memory。'),
  );
  guard.data.code = guard.data.code.split(wrapperMarker)[0].trim() + '\n\n' + read('dialogue_guard.py');
  if (eventDialogue) guard.data.code += '\n\n' + read('dialogue_event_guard.py');
  guard.data.variables = guard.data.variables.filter(item => item.variable !== 'model_result');
  guard.data.variables.push(variable('model_result', ids.merge, 'output'));
  guard.data.desc = '统一执行现有谜底、提示、事实与动作守卫，附上模型尝试和重试耗尽诊断。';
  for (const [id, x, y] of [['1000000000006', 2930, 480], ['1000000000007', 3250, 350], ['1000000000020', 3570, 350], ['1000000000008', 3890, 350]]) {
    const current = graph.nodes.find(node => node.id === id);
    current.position = current.positionAbsolute = { x, y };
  }
  const connections = [[primary.id, ids.normalize], [ids.normalize, ids.branch], [ids.branch, ids.retry, 'retry'],
    [ids.retry, ids.retryResult], [ids.retryResult, ids.merge], [ids.branch, ids.merge, 'false'], [ids.merge, guard.id]];
  for (const [from, to, handle = 'source'] of connections) graph.edges.push({
    id: `${from}-${handle}-${to}-target`, source: from, target: to, sourceHandle: handle, targetHandle: 'target', type: 'custom', zIndex: 0,
    data: { sourceType: graph.nodes.find(node => node.id === from).data.type,
      targetType: graph.nodes.find(node => node.id === to).data.type, isInIteration: false, isInLoop: false },
  });
  return patchStructuredReliability(graph, 'dialogue');
}
