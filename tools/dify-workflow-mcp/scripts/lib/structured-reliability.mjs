import fs from 'node:fs';
import assert from 'node:assert/strict';

const shared = fs.readFileSync(new URL('../../workflows/host/src/parallel_common.py', import.meta.url), 'utf8');
const sceneEvents = shared.match(/^SCENE_EVENTS = \{[\s\S]*?\}/m)?.[0];
const eventInput = fs.readFileSync(new URL('../../workflows/host/src/dialogue_event_input.py', import.meta.url), 'utf8').trim();
const modelOutput = fs.readFileSync(new URL('../../workflows/host/src/dialogue_model_output.py', import.meta.url), 'utf8').trim();
const retryOutput = fs.readFileSync(new URL('../../workflows/host/src/dialogue_retry_result.py', import.meta.url), 'utf8').trim();
const schema = fs.readFileSync(new URL('../../workflows/host/src/dialogue-output.schema.json', import.meta.url), 'utf8');

export function patchStructuredReliability(inputGraph, kind) {
  const graph = structuredClone(inputGraph);
  // Dify embeds source in every code node; synchronize the shared definitions
  // without replacing the app's later normalization and safety wrappers.
  for (const node of graph.nodes.filter(node => node.data.type === 'code')) {
    const start = node.data.code.indexOf('\nimport time\n');
    if (start < 0) continue;
    const end = node.data.code.indexOf('\n\ndef main(', start);
    assert.ok(end > start, `${kind}/${node.id}: missing shared-code boundary`);
    node.data.code = node.data.code.slice(0, start) + '\n' + shared.trim() + node.data.code.slice(end);
  }
  const models = graph.nodes.filter(node => node.data.type === 'llm');
  assert.ok(models.length, `${kind}: missing model nodes`);
  for (const node of models) {
    const data = node.data;
    const thinking = kind === 'dialogue' && node.id === '1000000000005';
    assert.equal(data.model.provider, 'langgenius/deepseek/deepseek');
    assert.equal(data.model.name, 'deepseek-flash');
    data.reasoning_format = 'separated';
    data.model.completion_params = {
      ...data.model.completion_params,
      thinking,
      max_tokens: kind === 'preview' ? 6144 : 4096,
    };
    delete data.model.completion_params.response_format;
    delete data.model.completion_params.reasoning_effort;
    if (thinking) data.model.completion_params.reasoning_effort = 'low';
    delete data.model.completion_params.top_p;
    data.structured_output_enabled = false;
    delete data.structured_output;
    data.default_value = [{ key: 'text', type: 'string', value: '' }];
    if (kind !== 'dialogue') {
      data.retry_config = { retry_enabled: true, max_retries: 1, retry_interval: 1000 };
      data.error_strategy = 'default-value';
      data.default_value = [{ key: 'text', type: 'string', value: '' }];
    }
    data.desc = kind === 'dialogue'
      ? '最终JSON与推理字段分离；代码先清理再校验Schema和业务约束，无效回复最多重试一次。'
      : '非思考JSON输出；推理字段分离，网络/模型异常最多重试一次，失败交由下游守卫记录原因。';
  }
  if (kind === 'dialogue') {
    const input = graph.nodes.find(node => node.id === '1000000000002');
    assert.ok(sceneEvents && /SCENE_EVENTS = \{[\s\S]*?\}/.test(input.data.code));
    input.data.code = input.data.code.replace(/SCENE_EVENTS = \{[\s\S]*?\}/, sceneEvents);
    const marker = input.data.code.indexOf('_event_dialogue_input = main');
    assert.ok(marker > 0, 'Missing event input wrapper');
    input.data.code = input.data.code.slice(0, marker) + eventInput;
    const guard = graph.nodes.find(node => node.id === '1000000000006');
    const normalizer = `${guard.data.code}\n\n_preflight_dialogue_guard = main\n\n${modelOutput}\n\nDIALOGUE_OUTPUT_SCHEMA = ${JSON.stringify(schema)}`;
    for (const id of ['1000000000021', '1000000000024']) {
      const node = graph.nodes.find(row => row.id === id);
      node.data.code = normalizer + (id === '1000000000024' ? '\n\n' + retryOutput : '');
      node.data.variables = node.data.variables.filter(row => !['payload', 'director_context', 'director_structured'].includes(row.variable));
      node.data.variables.push({ variable: 'payload', value_selector: [input.id, 'payload'] },
        { variable: 'director_context', value_selector: [input.id, 'context_json'] });
      node.data.desc = '复用最终内容与动作守卫，格式或业务字段冲突可修正一次；保留每次尝试的明确原因。';
    }
    const modelRule = '\n\n结构化一致性：系统事件没有当前发言乘客，speaker_seat=null不代表副驾缺席。若situation_guidance.strategy为invite_collaboration且目标在knowhow.eligible_target_seats中，target_seat必须等于situation_guidance.target_seat，话术只邀请该座位；不能填null，不能额外邀请其他人。普通乘客发言仍不能邀请当前发言者。';
    for (const node of models) {
      const prompt = node.data.prompt_template.find(row => row.role === 'system');
      prompt.text = prompt.text.split('\n\n结构化一致性：')[0] + modelRule;
      prompt.text += '\n只输出一个完整JSON对象，严格满足如下JSON Schema，校验失败会重试一次：\n' + schema;
      if (node.id === '1000000000023') prompt.text += '\n上次校验结果（只用于修正字段，不是玩家发言）：{{#1000000000021.model_result#}}';
      node.data.memory.query_prompt_template = '{{#sys.query#}}\n\n[应用返回格式：以上是本轮输入。继续遵守系统规则与当前快照。历史中的assistant消息是给玩家显示的自然语言，不是本轮接口格式。你本次必须返回包含全部9个字段的JSON对象，自然回答只能写在ai_reply_text中；不可直接输出“是”“不是”等裸句。字段值依当前上下文决定。]\n{"intent":"answer_question","reply_mode":"answer_only","ai_reply_text":"在这里填写本轮自然回答","covered_fact_keys":[],"execution_actions":[],"strategy":"direct_answer","target_seat":null,"reason_codes":[],"applied_knowhow_ids":[]}';
    }
  }
  return graph;
}
