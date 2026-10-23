import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createEcsConsole, ecsOrigin, profilesPath, projectRoot } from '../src/ecs-console.mjs';

const request = createEcsConsole();
const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
const codexServer = JSON.parse(execFileSync('codex', ['mcp', 'get', 'dify-test', '--json'], { encoding: 'utf8' }));
const configuredUrl = codexServer.transport.url;
assert.equal(new URL(configuredUrl).origin, ecsOrigin());
const folder = path.join(projectRoot, 'tmp/dify-ecs');
fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
const file = path.join(folder, `mcp-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const report = { started_at: new Date().toISOString(), fictional_data_only: true, apps: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });

for (const environment of ['alibaba-test', 'alibaba']) {
  for (const [kind, appId] of Object.entries(profiles.environments[environment].apps)) {
    const row = { environment, kind, app_id: appId };
    report.apps.push(row);
    try {
      const server = await request(`/apps/${appId}/server`);
      row.active = server.status === 'active';
      row.name = server.name;
      row.matches_codex_endpoint = `${ecsOrigin()}/mcp/server/${server.server_code}/mcp` === configuredUrl;
      assert.ok(server.description.includes(appId), 'MCP description must name the verified application ID');
      assert.ok(server.description.includes(environment === 'alibaba-test' ? '测试应用' : '正式应用'));
      if (row.matches_codex_endpoint) assert.equal(environment, 'alibaba-test');
      if (!row.active) throw new Error('MCP server is not active');
      const endpoint = `${ecsOrigin()}/mcp/server/${server.server_code}/mcp`;
      let counter = 0;
      const rpc = async (method, params) => {
        const response = await fetch(endpoint, { method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++counter, method, params }), signal: AbortSignal.timeout(45000) });
        row.instance_deploy_env = response.headers.get('x-env');
        if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.result;
      };
      const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'cabinplay-mcp-audit', version: '1.0.0' } });
      row.protocol_version = initialized.protocolVersion;
      row.initialized = true;
      const listed = await rpc('tools/list', {});
      row.tools = listed.tools.map(tool => ({ name: tool.name, required: tool.inputSchema.required || [] }));
      const tool = listed.tools[0];
      if (!tool || listed.tools.length !== 1) throw new Error('Expected one application execution tool');
      const id = `mcp-check-${randomUUID()}`;
      const snapshot = { game_id: id, round_id: `${id}-round-1`, scene_version: `${id}-scene`, trigger_type: kind === 'host' ? 'chat' : 'event',
        player_input: kind === 'host' ? '多给点提示' : '',
        game: { status: 'playing', current_answer: kind === 'preview' ? '安全带' : '海豚', round_index: 1, total_rounds: 6,
          question_count: 3, max_questions: 15, public_clues: ['它生活在水里。'], covered_fact_keys: [], asked_questions: [] },
        car: { speed: 50, environment: '城区晴天白天', sleep_comfort_seats: [] },
        passengers: { selected_seat: 'front', states: { driver: 'normal', front: 'normal', rearLeft: 'normal', rearRight: 'normal' } },
        interaction: { current_speaker: 'front', user_seat: 'front', speaker_source: 'real_user', recent_messages: [], suppress_passenger_action: true },
        ...(kind === 'situation' ? { event: { id: `${id}-event`, type: 'environment_change', priority: 'P1', previous_value: '车库', value: '城区晴天白天', source: 'fictional-mcp-audit' } } : {}),
        ...(kind === 'preview' ? { round_question_plan_request: { plan_id: `${id}-plan`, step_count: 4, persona_age_groups: ['adult'] } } : {}) };
      const supplied = { query: '多给点提示', snapshot: JSON.stringify(snapshot), input_payload: JSON.stringify(snapshot), situation: '{}' };
      const args = Object.fromEntries(Object.keys(tool.inputSchema.properties).filter(key => key in supplied).map(key => [key, supplied[key]]));
      let result = await rpc('tools/call', { name: tool.name, arguments: args });
      if (result.isError) throw new Error(JSON.stringify(result.content).slice(0, 400));
      row.result = result;
      const decode = response => {
        const text = response.content.find(block => block.type === 'text')?.text || '';
        if (kind === 'host' && !text.trimStart().startsWith('{')) return { ai_reply_text: text };
        const envelope = JSON.parse(text);
        const value = envelope.workflow_output || envelope.scene_output || envelope.answer || envelope;
        if (kind === 'host' && typeof value === 'string' && !value.trimStart().startsWith('{')) return { ai_reply_text: value };
        return typeof value === 'string' ? JSON.parse(value) : value;
      };
      let output = decode(result);
      row.rpc_succeeded = true;
      if (kind === 'preview' && output.preview_status !== 'ready' && output.preview_diagnostic?.repairable) {
        row.initial_preview_status = output.preview_status;
        row.initial_result = result;
        // Native MCP returns raw workflow output; mirror the BFF's single repair request.
        const acceptedSteps = output.round_question_plan?.steps || [];
        const repair = output.preview_repair || {
          attempt: 1,
          plan_id: output.round_question_plan?.plan_id || snapshot.round_question_plan_request.plan_id,
          accepted_steps: acceptedSteps.map(step => ({
            id: step.id, order: step.order, fact_key: step.fact_key, depends_on: step.depends_on,
            stage: step.stage, expected_answer: step.expected_answer, variants: step.variants,
            host_reply_text: step.host_reply_text,
          })),
          validation_errors: output.preview_diagnostic.validation_errors || [],
        };
        snapshot.round_question_plan_request.repair = repair;
        args.input_payload = JSON.stringify(snapshot);
        result = await rpc('tools/call', { name: tool.name, arguments: args });
        if (result.isError) throw new Error(JSON.stringify(result.content).slice(0, 400));
        row.repair_attempted = true;
        row.result = result;
        output = decode(result);
        for (const [index, step] of repair.accepted_steps.entries()) {
          for (const key of ['id', 'order', 'fact_key', 'depends_on', 'stage', 'expected_answer', 'variants']) {
            assert.deepEqual(output.round_question_plan?.steps?.[index]?.[key], step[key], 'Repair must preserve accepted steps');
          }
        }
        row.accepted_prefix_preserved = true;
      }
      if (kind === 'host') {
        if (output.decision_trace) assert.equal(output.decision_trace.guard_status, 'passed');
        assert.ok(output.ai_reply_text?.trim());
        assert.ok(!output.ai_reply_text.includes(snapshot.game.current_answer));
        row.output_summary = { guard: output.decision_trace?.guard_status || 'not_exposed_by_native_mcp', speech: output.ai_reply_text };
      } else if (kind === 'situation') {
        assert.equal(output.analysis_status, 'ready');
        assert.equal(output.event_id, snapshot.event.id);
        row.output_summary = { analysis_status: output.analysis_status, event_id_matches: true };
      } else {
        assert.equal(output.preview_status, 'ready');
        assert.equal(output.round_question_plan?.steps?.length, 4);
        row.output_summary = { preview_status: output.preview_status, step_count: output.round_question_plan.steps.length };
      }
      row.executed = true;
      row.result = result;
    } catch (error) {
      row.executed = false;
      row.error = error.message;
    }
    save();
    const { result, initial_result, ...summary } = row;
    console.log(JSON.stringify(summary));
  }
}
report.completed_at = new Date().toISOString();
report.codex_binding_verified = report.apps.filter(row => row.matches_codex_endpoint).length === 1
  && report.apps.some(row => row.matches_codex_endpoint && row.environment === 'alibaba-test' && row.kind === 'host');
report.summary = {
  rpc_succeeded: report.apps.filter(row => row.rpc_succeeded).length,
  output_checks_passed: report.apps.filter(row => row.executed).length,
  expected_apps: 6,
};
report.ok = report.apps.length === 6 && report.apps.every(row => row.executed) && report.codex_binding_verified;
save();
console.log(JSON.stringify({ ok: report.ok, report: path.relative(projectRoot, file) }));
if (!report.ok) process.exitCode = 1;
