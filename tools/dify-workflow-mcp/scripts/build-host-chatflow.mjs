import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const workflowDir = path.resolve(here, '../workflows/host');
const source = path.join(workflowDir, 'base-workflow.yml');
const target = path.join(projectRoot, 'tmp/dify-import/realtime-host-director-chatflow-v3.yml');
const sourceDir = path.join(workflowDir, 'src');
const dsl = YAML.parse(fs.readFileSync(source, 'utf8'));
const read = (name) => fs.readFileSync(path.join(sourceDir, name), 'utf8').trim();
const graph = dsl.workflow.graph;
const nodes = graph.nodes;
const byTitle = (title) => nodes.find((node) => node.data.title === title);
const byId = (id) => nodes.find((node) => node.id === id);
const conversationVariable = {
  id: '0f6d72e0-5c38-4b44-a504-869f57e47b32',
  name: 'cabin_snapshot',
  selector: ['conversation', 'cabin_snapshot'],
  value: '{}',
  value_type: 'string',
  description: '最近一次静默同步的车速、环境、驾驶员与乘客状态 JSON。',
};

dsl.app.mode = 'advanced-chat';
dsl.app.name = 'Smart Cabin Realtime Host Director v3 Chatflow';
dsl.app.description = '智能座舱猜谜 Demo 实时主持 Chatflow：持久会话、静默座舱状态同步、事件驱动主动话术与结构化执行计划。';
dsl.workflow.conversation_variables = [conversationVariable];
dsl.workflow.features.opening_statement = '';
dsl.workflow.features.suggested_questions = [];
graph.nodes = nodes.filter((node) => node.type !== 'custom-note');

const start = byTitle('用户输入');
start.data.title = '开始';
start.data.desc = '从 sys.query 读取本轮精简上下文，Chatflow conversation_id 保持跨局连续。';
start.data.variables = [];

const normalize = byTitle('输入标准化与 P0 预判');
normalize.data.variables = [
  { variable: 'input_payload', value_selector: ['sys', 'query'] },
  { variable: 'cabin_snapshot', value_selector: ['conversation', 'cabin_snapshot'] },
];
normalize.data.code = `${read('common.py')}\n\n${read('realtime_input.py')}`;
normalize.data.outputs = {
  payload: { type: 'object', children: null },
  context_json: { type: 'string', children: null },
  exact_correct: { type: 'boolean', children: null },
  is_p0: { type: 'boolean', children: null },
  event_type: { type: 'string', children: null },
  priority: { type: 'string', children: null },
  perception: { type: 'object', children: null },
};

const p0 = byTitle('P0 确定性响应');
p0.data.code = `${read('common.py')}\n\n${read('realtime_p0.py')}`;

const director = byTitle('实时主持导演');
director.data.memory = {
  query_prompt_template: '{{#sys.query#}}',
  role_prefix: { assistant: '', user: '' },
  window: { enabled: true, size: 10 },
};
director.data.prompt_template[0].text = read('realtime-prompt.txt');
director.data.prompt_template[1].text = '{{#1000000000002.context_json#}}';

const guard = byTitle('输出守卫');
guard.data.variables = [
  { variable: 'director_text', value_selector: ['1000000000005', 'text'] },
  { variable: 'payload', value_selector: ['1000000000002', 'payload'] },
];
guard.data.code = `${read('common.py')}\n\n${read('realtime_guard.py')}`;

const terminal = byId('1000000000008');
terminal.data = {
  desc: '',
  selected: false,
  title: '回复',
  type: 'answer',
  answer: '{{#1000000000007.output#}}',
  variables: [],
};
for (const edge of graph.edges) {
  if (edge.target === terminal.id) edge.data.targetType = 'answer';
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, YAML.stringify(dsl, { lineWidth: 120 }));
console.log(`Wrote ${path.relative(projectRoot, target)} (${graph.nodes.length} nodes).`);
