import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const workflowDir = path.resolve(here, '../workflows/host');
const sourceDir = path.join(workflowDir, 'src');
const target = path.join(projectRoot, 'tmp/dify-import/realtime-host-director-v3-knowhow.yml');
const dsl = YAML.parse(fs.readFileSync(path.join(workflowDir, 'base-workflow.yml'), 'utf8'));
const read = (name) => fs.readFileSync(path.join(sourceDir, name), 'utf8').trim();
const graph = dsl.workflow.graph;
const nodes = graph.nodes;
const byTitle = (title) => nodes.find((node) => node.data.title === title);
const byId = (id) => nodes.find((node) => node.id === id);

const IDS = {
  start: '1000000000001', normalize: '1000000000002', p0: '1000000000003',
  p0Response: '1000000000004', llm: '1000000000005', guard: '1000000000006',
  outputMerge: '1000000000007', answer: '1000000000008', router: '1000000000010',
  route: '1000000000011', retrieval: '1000000000012', retrievalContext: '1000000000013',
  skipContext: '1000000000014', contextMerge: '1000000000015',
};

function node(id, title, type, data, x, y, height = 170) {
  return {
    data: { title, type, desc: '', selected: false, ...data },
    height, id, position: { x, y }, positionAbsolute: { x, y }, selected: false,
    sourcePosition: 'right', targetPosition: 'left', type: 'custom', width: 242, zIndex: 0,
  };
}

function edge(source, sourceType, target, targetType, handle = 'source') {
  return {
    data: { isInIteration: false, isInLoop: false, sourceType, targetType },
    id: `${source}-${handle}-${target}-target`, source, sourceHandle: handle,
    target, targetHandle: 'target', type: 'custom', zIndex: 0,
  };
}

const normalize = byId(IDS.normalize);
normalize.data.title = '输入标准化与 P0 预判';
normalize.data.variables = [
  { variable: 'input_payload', value_selector: ['sys', 'query'] },
  { variable: 'cabin_snapshot', value_selector: ['conversation', 'cabin_snapshot'] },
];
normalize.data.code = `${read('common.py')}\n\n${read('realtime_input.py')}`;
normalize.data.outputs = Object.fromEntries([
  ['payload', 'string'], ['context_json', 'string'], ['exact_correct', 'boolean'],
  ['is_p0', 'boolean'], ['event_type', 'string'], ['priority', 'string'],
  ['perception', 'object'],
].map(([key, type]) => [key, { type, children: null }]));

const routerData = {
  code_language: 'python3',
  code: `${read('common.py')}\n\n${read('knowhow_router.py')}`,
  variables: [
    { variable: 'payload', value_selector: [IDS.normalize, 'payload'] },
    { variable: 'context_json', value_selector: [IDS.normalize, 'context_json'] },
  ],
  outputs: {
    needs_knowhow: { type: 'boolean', children: null },
    knowhow_query: { type: 'string', children: null },
    eligible_collaborators: { type: 'string', children: null },
  },
};

const routeData = {
  cases: [{
    id: 'needs_knowhow', case_id: 'needs_knowhow', logical_operator: 'and',
    conditions: [{
      id: `${IDS.route}-condition`, variable_selector: [IDS.router, 'needs_knowhow'],
      comparison_operator: 'is', value: true, varType: 'boolean',
    }],
  }],
  isInIteration: false, isInLoop: false,
};

const retrievalData = {
  query_variable_selector: [IDS.router, 'knowhow_query'],
  query_attachment_selector: [],
  dataset_ids: [],
  retrieval_mode: 'multiple',
  multiple_retrieval_config: {
    top_k: 3,
    score_threshold: null,
    reranking_enable: false,
  },
  metadata_filtering_mode: 'disabled',
  vision: { enabled: false },
};

const retrievalContextData = {
  code_language: 'python3',
  code: read('knowhow_context.py'),
  variables: [
    { variable: 'context_json', value_selector: [IDS.normalize, 'context_json'] },
    { variable: 'retrieval_results', value_selector: [IDS.retrieval, 'result'] },
    { variable: 'eligible_target_seats', value_selector: [IDS.router, 'eligible_collaborators'] },
  ],
  outputs: {
    director_context: { type: 'string', children: null },
    knowhow_status: { type: 'string', children: null },
    retrieved_knowhow: { type: 'string', children: null },
  },
};

const skipContextData = {
  code_language: 'python3',
  code: read('knowhow_skip_context.py'),
  variables: [
    { variable: 'context_json', value_selector: [IDS.normalize, 'context_json'] },
    { variable: 'eligible_target_seats', value_selector: [IDS.router, 'eligible_collaborators'] },
  ],
  outputs: { director_context: { type: 'string', children: null } },
};

nodes.push(
  node(IDS.router, '主持经验相关性筛选', 'code', routerData, 1010, 590, 180),
  node(IDS.route, '经验检索条件分支', 'if-else', routeData, 1310, 590, 150),
  node(IDS.retrieval, '主持经验知识检索', 'knowledge-retrieval', retrievalData, 1610, 470, 190),
  node(IDS.retrievalContext, '整理检索经验', 'code', retrievalContextData, 1910, 470, 180),
  node(IDS.skipContext, '整理免检索上下文', 'code', skipContextData, 1610, 740, 170),
  node(IDS.contextMerge, '合并主持上下文', 'variable-aggregator', {
    output_type: 'string',
    variables: [[IDS.retrievalContext, 'director_context'], [IDS.skipContext, 'director_context']],
  }, 2210, 590, 130),
);

const start = byId(IDS.start);
start.data.title = '开始';
start.data.desc = '从 sys.query 读取本轮精简上下文；同一 conversation_id 跨局延续。';
start.data.variables = [];

const p0 = byId(IDS.p0);
p0.data.title = 'P0 规则分支';

const llm = byId(IDS.llm);
llm.data.model = {
  provider: 'langgenius/deepseek/deepseek',
  name: 'deepseek-flash',
  mode: 'chat',
  completion_params: {},
};
llm.data.title = '实时主持导演';
llm.data.memory = {
  query_prompt_template: '{{#sys.query#}}',
  role_prefix: { assistant: '', user: '' },
  window: { enabled: true, size: 10 },
};
llm.data.prompt_template[0].text = read('realtime-prompt-knowhow.txt');
llm.data.prompt_template[1].text = `{{#${IDS.contextMerge}.output#}}`;

const guard = byId(IDS.guard);
guard.data.variables = [
  { variable: 'director_text', value_selector: [IDS.llm, 'text'] },
  { variable: 'payload', value_selector: [IDS.normalize, 'payload'] },
  { variable: 'director_context', value_selector: [IDS.contextMerge, 'output'] },
];
guard.data.code = `${read('common.py')}\n\n${read('realtime_guard.py')}\n\n${read('knowhow_guard.py')}`;

const outputMerge = byId(IDS.outputMerge);
outputMerge.data.title = '汇总 P0 与普通路径';
outputMerge.data.variables = [
  [IDS.p0Response, 'workflow_output'],
  [IDS.guard, 'workflow_output'],
];

const answer = byId(IDS.answer);
answer.data = {
  desc: '', selected: false, title: '回复', type: 'answer',
  answer: `{{#${IDS.outputMerge}.output#}}`, variables: [],
};

graph.edges = [
  edge(IDS.start, 'start', IDS.normalize, 'code'),
  edge(IDS.normalize, 'code', IDS.p0, 'if-else'),
  edge(IDS.p0, 'if-else', IDS.p0Response, 'code', 'p0'),
  edge(IDS.p0, 'if-else', IDS.router, 'code', 'false'),
  edge(IDS.router, 'code', IDS.route, 'if-else'),
  edge(IDS.route, 'if-else', IDS.retrieval, 'knowledge-retrieval', 'needs_knowhow'),
  edge(IDS.route, 'if-else', IDS.skipContext, 'code', 'false'),
  edge(IDS.retrieval, 'knowledge-retrieval', IDS.retrievalContext, 'code'),
  edge(IDS.retrievalContext, 'code', IDS.contextMerge, 'variable-aggregator'),
  edge(IDS.skipContext, 'code', IDS.contextMerge, 'variable-aggregator'),
  edge(IDS.contextMerge, 'variable-aggregator', IDS.llm, 'llm'),
  edge(IDS.llm, 'llm', IDS.guard, 'code'),
  edge(IDS.p0Response, 'code', IDS.outputMerge, 'variable-aggregator'),
  edge(IDS.guard, 'code', IDS.outputMerge, 'variable-aggregator'),
  edge(IDS.outputMerge, 'variable-aggregator', IDS.answer, 'answer'),
];

for (const nodeItem of nodes) {
  nodeItem.selected = false;
  nodeItem.data.selected = false;
}

dsl.app.mode = 'advanced-chat';
dsl.app.name = 'Smart Cabin Realtime Host Director v3 Knowledge';
dsl.app.description = '实时主持 Chatflow：P0 确定性旁路、条件主持经验检索、单次 LLM 与输出守卫。';
dsl.workflow.conversation_variables = [{
  id: '0f6d72e0-5c38-4b44-a504-869f57e47b32',
  name: 'cabin_snapshot',
  selector: ['conversation', 'cabin_snapshot'],
  value: '{}',
  value_type: 'string',
  description: '最近一次静默同步的车速、环境、驾驶员与乘客状态 JSON。',
}];
dsl.workflow.features.opening_statement = '';
dsl.workflow.features.suggested_questions = [];

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, YAML.stringify(dsl, { lineWidth: 120 }));
const knowhowRows = fs.readFileSync(path.join(projectRoot, 'docs/主持经验库-v1.jsonl'), 'utf8')
  .split(/\r?\n/).filter(Boolean);
fs.writeFileSync(
  path.join(projectRoot, 'docs/主持经验库-v1.md'),
  `${knowhowRows.join('\n\n')}\n`,
);
console.log(`Wrote ${path.relative(projectRoot, target)} (${nodes.length} nodes, ${graph.edges.length} edges).`);
