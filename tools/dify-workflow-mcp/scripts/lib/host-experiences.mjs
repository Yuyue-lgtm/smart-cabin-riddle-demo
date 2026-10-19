import fs from "node:fs";
const source = new URL("../../workflows/host/src/", import.meta.url);
const read = name => fs.readFileSync(new URL(name, source), "utf8").trim();
const code = (...names) => names.map(read).join("\n\n");
import assert from "node:assert/strict";

function patchInput(node, kind) {
  assert.equal(node.data.type, 'code');
  const eventDialogue = kind === 'dialogue' && node.data.code.includes('_event_dialogue_input = main');
  const original = 'ended_game = game.get("status") in ("victory", "failed", "finished") and not music_request';
  node.data.code = node.data.code.replace(original, 'ended_game = trigger != "chat" and game.get("status") in ("victory", "failed", "finished") and not music_request');
  if (node.data.code.includes('_experience_clean_snapshot =')) {
    const start = node.data.code.indexOf('FEEDBACK_IDS =');
    const end = node.data.code.indexOf('_normalize_original = main', start);
    assert.ok(start >= 0 && end > start);
    node.data.code = node.data.code.slice(0, start) + read('experience_common.py') + '\n\n' + node.data.code.slice(end);
  } else {
    assert.ok(node.data.code.includes('_normalize_original = main'));
    node.data.code = node.data.code.replace('_normalize_original = main', read('experience_common.py') + '\n\n_normalize_original = main');
  }
  const wrapper = kind === 'dialogue' ? 'dialogue_experience_input.py' : 'scene_feedback_input.py';
  const marker = kind === 'dialogue' ? '_experience_dialogue_input = main' : '_experience_scene_input = main';
  node.data.code = node.data.code.split(marker)[0].trim() + '\n\n' + read(wrapper);
  if (eventDialogue) node.data.code += '\n\n' + read('dialogue_event_input.py');
  if (kind === 'situation') node.data.outputs.feedback_fast_path = { type: 'boolean', children: null };
}

function patchDialogueGuard(graph) {
  const node = graph.nodes.find(row => row.id === '1000000000006');
  assert.equal(node?.data?.type, 'code');
  node.data.code = node.data.code.split('_event_dialogue_guard = main')[0].trim()
    + '\n\n' + read('dialogue_event_guard.py');
  node.data.code = node.data.code.replaceAll('range(1, 28)', 'range(1, 29)');
}

function patchKnowhowCodeNodes(graph) {
  for (const node of graph.nodes.filter(row => row.data?.type === 'code')) {
    node.data.code = node.data.code.replaceAll('range(1, 28)', 'range(1, 29)')
      .replaceAll('"HK27": {"closing"}})', '"HK27": {"closing"}, "HK28": {"invite_collaboration"}})');
  }
}

function patchRetrieval(node) {
  node.data.code = node.data.code.replaceAll('range(1, 28)', 'range(1, 29)');
  const marker = '_retrieval_context_original = main';
  if (node.data.code.includes(marker)) {
    node.data.code = node.data.code.split(marker)[0].trim() + '\n\n' + read('scene_knowhow_context.py');
  }
  if (!node.data.code.includes('if kind == "post_result_feedback":')) {
    node.data.code = node.data.code.replace('    states = obj(obj(context.get("snapshot")).get("passengers"))',
      '    if kind == "post_result_feedback":\n        applicable = set(items(obj(obj(context.get("snapshot")).get("feedback")).get("candidate_ids")))\n    states = obj(obj(context.get("snapshot")).get("passengers"))');
  }
}

function addFeedbackRoute(graph) {
  const byId = id => graph.nodes.find(node => node.id === id);
  patchInput(byId('3000000000002'), 'situation');
  patchRetrieval(byId('3000000000011'));
  byId('3000000000014').data.code = byId('3000000000014').data.code
    .replaceAll('HK(?:0[1-9]|1[0-9]|2[0-7])', 'HK(?:0[1-9]|1[0-9]|2[0-8])');
  if (!byId('3000000000013')) {
    assert.ok(byId('3000000000014').data.code.includes('def main(payload: str, director_context: str)'), 'Expected analysis-only situation assembler.');
    byId('3000000000014').data.code = code('common.py', 'parallel_common.py', 'experience_common.py', 'scene_analysis_result.py');
    byId('3000000000023').data.code = code('common.py', 'parallel_common.py', 'experience_common.py', 'scene_feedback_context.py');
    byId('3000000000025').data.code = byId('3000000000011').data.code;
    return;
  }
  const guard = byId('3000000000014');
  guard.data.code = guard.data.code.replaceAll('range(1, 28)', 'range(1, 29)');
  guard.data.code = guard.data.code.replace('"paused_state", "no_relevant_knowhow",', '"paused_state", "no_relevant_knowhow", "achievement_feedback", "host_preference",');
  guard.data.code = guard.data.code.split('# Host experience v2 extensions')[0].trim() + '\n\n# Host experience v2 extensions\n'
    + 'STRATEGY_BY_ID.update({"HK{:02d}".format(index): {"encourage"} for index in range(10, 22)})\n'
    + 'STRATEGY_BY_ID.update({"HK22": {"soft_response"}, "HK23": {"direct_answer", "soft_response"}, "HK24": {"soft_response"}, "HK25": {"direct_answer"}, "HK26": {"soft_response"}, "HK27": {"closing"}, "HK28": {"invite_collaboration"}})\n\n'
    + read('experience_common.py') + '\n\n' + read('scene_feedback_result.py');
  const prompt = byId('3000000000013').data.prompt_template.find(row => row.role === 'system');
  prompt.text = prompt.text.split('\n\npost_result_feedback 是')[0] + '\n\n' + read('experience-director-prompt.txt');

  const ids = ['3000000000022', '3000000000023', '3000000000024', '3000000000025'];
  if (ids.every(id => byId(id))) {
    byId(ids[1]).data.code = code('common.py', 'parallel_common.py', 'experience_common.py', 'scene_feedback_context.py');
    byId(ids[3]).data.code = byId('3000000000011').data.code;
    return;
  }
  assert.ok(ids.every(id => !byId(id)), 'Incomplete feedback route; inspect it before rebuilding.');
  const branch = structuredClone(byId('3000000000005'));
  branch.id = ids[0]; branch.position = branch.positionAbsolute = { x: 1150, y: 1000 };
  branch.data.title = '揭晓后成就快速分支';
  branch.data.cases = [{ id: 'feedback', case_id: 'feedback', logical_operator: 'and', conditions: [{ id: 'feedback-condition',
    variable_selector: ['3000000000002', 'feedback_fast_path'], comparison_operator: 'is', value: true, varType: 'boolean' }] }];
  const plan = structuredClone(byId('3000000000008'));
  plan.id = ids[1]; plan.position = plan.positionAbsolute = { x: 1500, y: 1000 };
  plan.data.title = '可信成就与经验检索词';
  plan.data.code = code('common.py', 'parallel_common.py', 'experience_common.py', 'scene_feedback_context.py');
  plan.data.variables = [{ variable: 'context_json', value_selector: ['3000000000002', 'context_json'] }];
  delete plan.data.outputs.needs_knowhow;
  const retrieval = structuredClone(byId('3000000000010'));
  retrieval.id = ids[2]; retrieval.position = retrieval.positionAbsolute = { x: 1850, y: 1000 };
  retrieval.data.title = '揭晓后主持经验检索';
  retrieval.data.query_variable_selector = [ids[1], 'knowhow_query'];
  const context = structuredClone(byId('3000000000011'));
  context.id = ids[3]; context.position = context.positionAbsolute = { x: 2200, y: 1000 };
  context.data.title = '筛选本次真实成就经验';
  context.data.variables = [{ variable: 'context_json', value_selector: [ids[1], 'director_context'] },
    { variable: 'retrieval_results', value_selector: [ids[2], 'result'] },
    { variable: 'eligible_target_seats', value_selector: [ids[1], 'eligible_target_seats'] }];
  graph.nodes.push(branch, plan, retrieval, context);
  byId('3000000000012').data.variables.unshift([ids[3], 'director_context']);
  const old = graph.edges.find(edge => edge.source === '3000000000005' && edge.sourceHandle === 'analyze');
  assert.ok(old);
  const oldTarget = old.target;
  graph.edges = graph.edges.filter(edge => edge !== old);
  for (const [from, to, handle = 'source'] of [['3000000000005', ids[0], 'analyze'], [ids[0], oldTarget, 'false'],
    [ids[0], ids[1], 'feedback'], [ids[1], ids[2]], [ids[2], ids[3]], [ids[3], '3000000000012']]) {
    graph.edges.push({ id: `${from}-${handle}-${to}-target`, source: from, target: to, sourceHandle: handle,
      targetHandle: 'target', type: 'custom', zIndex: 0,
      data: { sourceType: byId(from).data.type, targetType: byId(to).data.type, isInIteration: false, isInLoop: false } });
  }
}


export { patchInput, patchDialogueGuard, patchKnowhowCodeNodes, addFeedbackRoute };
