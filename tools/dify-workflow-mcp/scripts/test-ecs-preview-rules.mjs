import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { createEcsConsole, profilesPath, projectRoot, readPrivateEnv } from '../src/ecs-console.mjs';
import { parseWorkflowStream } from '../src/ecs-regression.mjs';
import { fingerprint, workflowContent } from '../src/ecs-release.mjs';

const [mode, reportPath] = process.argv.slice(2);
if (!['draft', 'published'].includes(mode) || !reportPath) {
  throw new Error('Usage: test-ecs-preview-rules.mjs draft|published <report.json>');
}
const profiles = JSON.parse(fs.readFileSync(profilesPath));
const appId = profiles.environments['alibaba-test'].apps.preview;
const productionId = profiles.environments.alibaba.apps.preview;
const env = readPrivateEnv(`${projectRoot}/.env.local`);
if (!appId || appId === productionId || env.DIFY_PREVIEW_APP_ID !== appId) {
  throw new Error('Independent ECS test preview binding is required');
}
const require = createRequire(import.meta.url);
const { handleWorkflowBody } = require('../../../api/dify-bff.js');
const request = createEcsConsole();
const nativeFetch = globalThis.fetch;
process.env.DIFY_PREVIEW_APP_ID = appId;
process.env.DIFY_PREVIEW_API_KEY = mode === 'draft' ? 'fictional-draft-key' : env.DIFY_PREVIEW_API_KEY;
process.env.DIFY_API_BASE_URL = mode === 'draft' ? 'http://preview-draft.invalid' : env.DIFY_API_BASE_URL;
if (mode === 'draft') {
  globalThis.fetch = async (url, options) => {
    if (String(url) !== 'http://preview-draft.invalid/v1/workflows/run') throw new Error('Unexpected draft request origin');
    const body = JSON.parse(options.body);
    const response = await request(`/apps/${appId}/workflows/draft/run`, {
      method: 'POST', body: { inputs: body.inputs }, raw: true,
    });
    return Response.json(parseWorkflowStream(await response.text()));
  };
}

const family = ['child', 'adult', 'elder'];
// Fictional first-round fixtures from the Demo, including clue-sensitive hints.
const riddles = {
  '安全带': { theme: '高速', hint: '它平时很安静，但关键时刻比主持人还可靠。' },
  '雨伞': { theme: '雨天', hint: '这题和外面的雨有关，答案是车里很多人都会带的东西。' },
  '红绿灯': { theme: '城区', hint: '城市里最会指挥交通的三色选手。' },
  '草原': { theme: '风景', hint: '它很开阔，适合风景区，也适合把心情放大一点。' },
  '雪人': { theme: '雪景', hint: '它怕热，但在风景区雪景里特别应景。' },
  '方向盘': { theme: '驾驶', hint: '主驾最熟悉它，但现在先让副驾和后排来猜。' },
};
const cases = mode === 'draft' ? [
  ...[4, 5, 5, 6, 6].map((count, i) => ({ label: `safety-${count}-${i}`, answer: '安全带', count, groups: family })),
  ...[5, 6].map(count => ({ label: `safety-repair-${count}`, answer: '安全带', count, groups: family, repair: true })),
  { label: 'umbrella', answer: '雨伞', count: 4, groups: ['child'] },
  { label: 'traffic-light', answer: '红绿灯', count: 5, groups: ['adult'] },
  { label: 'grassland', answer: '草原', count: 5, groups: ['elder'] },
  { label: 'snowman', answer: '雪人', count: 6, groups: family },
  { label: 'steering-wheel', answer: '方向盘', count: 6, groups: ['elder'] },
] : [
  { label: 'published-safety-5', answer: '安全带', count: 5, groups: family },
  { label: 'published-safety-6', answer: '安全带', count: 6, groups: family },
  { label: 'published-repair-6', answer: '安全带', count: 6, groups: family, repair: true },
];
const prefix = [
  { id: 'q1', order: 1, fact_key: 'man_made', stage: 'category', depends_on: [], expected_answer: 'yes',
    variants: { default: '它是人造物品吗？', child: '它是人做出来的吗？', elder: '它是人工制成的吗？' }, host_reply_text: '是的。', host_emotion: 'normal' },
  { id: 'q2', order: 2, fact_key: 'in_vehicle', stage: 'location', depends_on: ['man_made'], expected_answer: 'yes',
    variants: { default: '它常在车内使用吗？', child: '在车里能用到它吗？', elder: '它通常用在车内吗？' }, host_reply_text: '是的。', host_emotion: 'normal' },
];
const testedWorkflow = await request(`/apps/${appId}/workflows/${mode === 'draft' ? 'draft' : 'publish'}`);
const report = { mode, app_id: appId, workflow_hash: fingerprint(workflowContent(testedWorkflow)),
  started_at: new Date().toISOString(), fictional_data_only: true, ok: false, cases: [] };
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
save();
try {
  for (const test of cases) {
    const id = `preview-rules-${Date.now()}-${test.label}`;
    const input = { trigger_type: 'event', game_id: id, round_id: `${id}-round-1`, scene_version: `${id}-scene`,
      event: { type: 'start_game', id: `${id}-event`, source: 'fictional-regression', priority: 'P3' },
      car: { speed: 80, environment: '车库', destination: '虚构测试目的地' },
      passengers: { relationship: '父母+小孩', states: { driver: '普通', front: '普通', rear_left: '普通', rear_right: '普通' } },
      game: { status: 'playing', round_index: 1, total_rounds: 6, question_count: 0,
        current_answer: test.answer, current_theme: riddles[test.answer].theme, hint: riddles[test.answer].hint,
        asked_questions: [], covered_fact_keys: [] },
      interaction: { recent_messages: [], suppress_passenger_action: true },
      round_question_plan_request: { step_count: test.count, persona_age_groups: test.groups,
        ...(test.repair ? { repair: { attempt: 1, plan_id: `${id}-plan`, accepted_steps: structuredClone(prefix),
          validation_errors: ['early_question_clue_leak_3', 'early_reply_clue_leak_3'] } } : {}) },
    };
    const row = { label: test.label, count: test.count, answer: test.answer, attempts: [] };
    const started = Date.now();
    let plan = null;
    for (let attempt = 0; attempt < (test.repair ? 1 : 2); attempt++) {
      const { status, payload } = await handleWorkflowBody({ route: 'preview', user_id: `${id}-fictional`, input_payload: input });
      row.attempts.push({ http: status, status: payload.preview_status, diagnostic: payload.preview_diagnostic,
        workflow_run_id: payload.workflow_run_id, elapsed_ms: Date.now() - started,
        ...(payload.error ? { error: payload.error } : {}) });
      const output = typeof payload.workflow_output === 'string' ? JSON.parse(payload.workflow_output) : {};
      plan = output.round_question_plan;
      if (status === 200 && payload.preview_status === 'ready') break;
      if (status !== 200 || !output.preview_repair || !payload.preview_diagnostic?.repairable || attempt === 1) break;
      input.round_question_plan_request.repair = output.preview_repair;
      input.event.id += '-repair';
    }
    row.elapsed_ms = Date.now() - started;
    row.ready = row.attempts.at(-1)?.http === 200 && row.attempts.at(-1)?.status === 'ready' && plan?.steps?.length === test.count;
    row.first_steps = plan?.steps?.slice(0, 3).map(step => ({ stage: step.stage, expected_answer: step.expected_answer,
      variants: step.variants, host_reply_text: step.host_reply_text }));
    if (test.repair) row.accepted_prefix_preserved = isDeepStrictEqual(plan?.steps?.slice(0, 2), prefix.map(step => {
      const { host_reply_text, host_emotion, ...publicStep } = step; return publicStep;
    }));
    report.cases.push(row); save();
    console.log(JSON.stringify({ label: row.label, ready: row.ready, attempts: row.attempts.map(attempt => ({
      status: attempt.status, errors: attempt.diagnostic?.validation_errors })), elapsed_ms: row.elapsed_ms }));
    if (!row.ready) throw new Error(`Preview regression failed: ${test.label}`);
    if (row.accepted_prefix_preserved === false) throw new Error('Accepted-prefix preservation failed');
  }
  const currentWorkflow = await request(`/apps/${appId}/workflows/${mode === 'draft' ? 'draft' : 'publish'}`);
  if (fingerprint(workflowContent(currentWorkflow)) !== report.workflow_hash) throw new Error('Workflow changed during regression');
  report.ok = true;
  report.completed_at = new Date().toISOString();
  save();
} finally {
  globalThis.fetch = nativeFetch;
}
