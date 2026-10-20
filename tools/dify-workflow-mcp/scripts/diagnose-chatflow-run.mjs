import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, '../.env');
const env = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath, 'utf8')) : {};
const fixturePath = process.argv[2] === '--fixture' ? process.argv[3] : null;
const latest = !fixturePath && process.argv[2] === '--latest' ? findLatestFallback() : null;
const runId = fixturePath ? '00000000-0000-4000-8000-000000000000' : latest?.workflow_run_id || process.argv[2];
const appId = (fixturePath ? null : process.argv[2] === '--latest' ? latest?.app_id : process.argv.slice(3).find(arg => !arg.startsWith('--')))
  || env.DIFY_CHATFLOW_APP_ID || '74bef8bd-22bd-4e19-91da-5e8d645dd8ed';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if ((!latest && !uuid.test(runId || '')) || !uuid.test(appId)) {
  throw new Error('Usage: node diagnose-chatflow-run.mjs <workflow_run_id> [app_id] | --latest [--cloud]');
}
if (latest && (!process.argv.includes('--cloud') || !uuid.test(latest.workflow_run_id || ''))) {
  const diagnostic = latest.diagnostic || {};
  const models = diagnostic.model_nodes || [];
  const guardStatus = diagnostic.guard_status || latest.guard_status || null;
  const diagnosticStatus = guardStatus === 'event_reply_skipped' ? 'event_reply_skipped'
    : diagnostic.status || (latest.status >= 400 ? 'request_failed' : 'reason_unavailable');
  process.stdout.write(JSON.stringify({
    inspection_source: 'local_sse',
    workflow_run_id: latest.workflow_run_id || null,
    local_diagnostic_id: latest.diagnostic_id,
    local_timestamp: latest.timestamp,
    event_type: latest.event_type || null,
    game_id: latest.game_id || null,
    round_id: latest.round_id || null,
    diagnostic_status: diagnosticStatus,
    http_status: latest.status,
    error: latest.error || null,
    proxy_failure: latest.proxy_failure || null,
    fallback_origin: diagnostic.fallback_origin || null,
    guard_status: guardStatus,
    fallback_reason_codes: diagnostic.reason_codes || [],
    validation_errors: diagnostic.validation_errors || [],
    validation_reason_codes: diagnostic.validation_reason_codes || [],
    model_output_status: diagnostic.model_output_status || null,
    model_retry_count: diagnostic.model_retry_count || 0,
    model_attempts: diagnostic.model_attempts || [],
    model_failure_reason_codes: diagnostic.model_failure_reason_codes || [],
    model_nodes: models,
    event_context: diagnostic.event_context || null,
    raw_node_details_available: false,
    cloud_unavailable_reason: !latest.workflow_run_id ? 'request_has_no_workflow_run_id' : null,
    related_requests: relatedRequests(latest),
    cloud_trace_command: latest.workflow_run_id ? 'node tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs --latest --cloud' : null,
  }, null, 2) + '\n');
  process.exit(diagnosticStatus === 'reason_unavailable' ? 2 : 0);
}
const read = fixturePath ? null : (await import('../src/index.mjs')).requestConsoleJson;
const endpoint = `/apps/${appId}/workflow-runs/${runId}`;

function parse(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try { return JSON.parse(value); } catch { return {}; }
}

const fixture = fixturePath ? JSON.parse(fs.readFileSync(path.resolve(fixturePath), 'utf8')) : null;
const run = fixture ? fixture.run : await read(endpoint);
const listed = fixture ? fixture.node_executions : await read(`${endpoint}/node-executions`);
const nodes = Array.isArray(listed.data) ? listed.data : [];
const guard = nodes.find((node) => node.node_id === '1000000000006');
const guarded = parse(parse(guard?.outputs).workflow_output);
const debug = parse(guarded.debug);
const trace = parse(guarded.decision_trace);
const llm = nodes.find((node) => node.node_id === '1000000000005');
const reasonCodes = Array.isArray(debug.fallback_reason_codes) ? debug.fallback_reason_codes
  : Array.isArray(trace.guard_reason_codes) ? trace.guard_reason_codes : [];
const validationErrors = Array.isArray(debug.validation_errors) ? debug.validation_errors : [];
const validationReasons = Array.isArray(debug.validation_reason_codes) ? debug.validation_reason_codes : [];
const llmOutputSummary = summarizeLlmOutput(llm?.outputs);
const status = reasonCodes.length || validationErrors.length ? 'reason_recorded'
  : trace.guard_status === 'event_reply_skipped' ? 'event_reply_skipped'
  : typeof guarded.ai_reply_text !== 'string' ? 'trace_missing_guard_output'
  : guarded.ai_reply_text === '我陪你慢慢想，按你的节奏来。' ? 'reason_unavailable'
  : 'no_guard_fallback_observed';

const report = {
  workflow_run_id: runId,
  inspection_source: fixturePath ? 'fixture' : 'cloud_console',
  ...(latest ? { local_diagnostic_id: latest.diagnostic_id, local_timestamp: latest.timestamp } : {}),
  run_status: run.status || run.data?.status || null,
  diagnostic_status: status,
  fallback_origin: debug.fallback_origin || null,
  guard_status: trace.guard_status || null,
  fallback_reason_codes: reasonCodes,
  validation_errors: validationErrors,
  validation_reason_codes: validationReasons,
  model_output_status: debug.model_output_status || null,
  model_retry_count: debug.model_retry_count || 0,
  model_attempts: debug.model_attempts || [],
  model_failure_reason_codes: debug.model_failure_reason_codes || [],
  llm_status: llm?.status || null,
  llm_error: typeof llm?.outputs?.error_message === 'string' ? llm.outputs.error_message.slice(0, 300)
    : typeof llm?.error === 'string' ? llm.error.slice(0, 300) : null,
  llm_output_summary: llmOutputSummary,
  event_context: eventContext(nodes, run),
  related_requests: latest ? relatedRequests(latest) : [],
  model_nodes: nodes.filter(node => node.node_type === 'llm' || ['1000000000005', '1000000000023'].includes(node.node_id))
    .map(node => ({ node_id: node.node_id, status: node.status || null,
      error_code: /parse structured output/i.test([node.error, node.outputs?.error_message].join(' ')) ? 'structured_output_parse_failed'
        : node.error ? 'model_node_error' : null, ...summarizeLlmOutput(node.outputs) })),
  nodes: nodes.map((node) => ({
    node_id: node.node_id,
    title: node.title || node.node_title || '',
    status: node.status || null,
    elapsed_time: node.elapsed_time ?? null,
    error: typeof node.error === 'string' ? node.error.slice(0, 160) : null,
  })),
};
if (!fixturePath) {
  const folder = path.resolve(here, '../../../tmp/dify-diagnostics');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, `${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (status === 'trace_missing_guard_output' || status === 'reason_unavailable') process.exitCode = 2;

function findLatestFallback() {
  const records = localRecords().filter(record => record?.phase === 'finish' && record.route === 'chat');
  const match = records.reverse().find((record) => record.fixed_soft_fallback
    || record.diagnostic?.observed_fixed_fallback
    || record.diagnostic?.model_output_status === 'retry_exhausted'
    || ['model_output_fallback', 'event_reply_skipped', 'constraint_fallback', 'knowhow_fallback', 'fallback'].includes(record.diagnostic?.guard_status || record.guard_status)
    || record.status >= 400);
  if (!match) throw new Error('No recent failed or fallback Chatflow run was found in local diagnostics.');
  return match;
}

function localRecords() {
  const root = path.resolve(here, '../../..');
  const logPath = process.env.DIFY_DIAGNOSTICS_LOG_PATH || path.join(root, 'tmp/workflow-diagnostics.ndjson');
  if (!fs.existsSync(logPath)) {
    throw new Error('No local diagnostics yet. Restart the local demo server with the updated diagnostics enabled.');
  }
  return [`${logPath}.1`, logPath].filter((file) => fs.existsSync(file))
    .flatMap((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/)).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function relatedRequests(record) {
  if (!record.event_id) return [];
  return localRecords().filter(row => row.phase === 'finish' && row.event_id === record.event_id)
    .map(row => Object.fromEntries(['timestamp', 'route', 'operation', 'event_id', 'workflow_run_id', 'app_id', 'status', 'elapsed_ms', 'guard_status']
      .map(key => [key, row[key] ?? null])));
}

function eventContext(nodes, run) {
  const input = nodes.find(node => node.node_id === '1000000000002');
  const context = parse(parse(input?.outputs).context_json);
  const event = parse(context.event_dialogue);
  const model = nodes.find(node => node.node_id === '1000000000025');
  const result = parse(parse(model?.outputs).model_result);
  const candidate = parse(result.canonical_text);
  const inputs = parse(input?.inputs), snapshot = parse(inputs.snapshot), scene = parse(inputs.situation);
  const graph = parse(run.graph);
  const code = graph.nodes?.find(node => node.id === '1000000000002')?.data?.code || '';
  const declared = code.match(/SCENE_EVENTS\s*=\s*\{([\s\S]*?)\}/)?.[1];
  const types = declared ? [...declared.matchAll(/["']([^"']+)["']/g)].map(match => match[1]) : null;
  const kind = snapshot.event?.type;
  const participation = parse(snapshot.participation);
  const checks = event.event_type ? {
    event_type_supported: types ? types.includes(kind) || kind === 'post_result_feedback' : null,
    event_ids_match: snapshot.dialogue_request?.event_id === snapshot.event?.id && snapshot.event?.id === scene.event_id,
    scope_matches: ['game_id', 'round_id', 'scene_version'].every(key => snapshot[key] === scene[key]),
    analysis_ready: scene.analysis_status === 'ready',
    proactive_speech_requested: scene.request_proactive_speech === true,
    expiry_window_valid: Number.isFinite(scene.generated_at_ms) && Number.isFinite(scene.expires_at_ms)
      && scene.expires_at_ms > scene.generated_at_ms && scene.expires_at_ms <= scene.generated_at_ms + 60000,
    expired_before_node_started: typeof input?.created_at === 'number' ? scene.expires_at_ms <= input.created_at * 1000 : null,
    game_status_allowed: ['playing', 'opening'].includes(snapshot.game?.status)
      || kind === 'post_result_feedback' && snapshot.game?.status === 'victory',
  } : {};
  if (kind === 'passenger_inactive') {
    const frontState = snapshot.passengers?.states?.front ?? snapshot.passengers?.front;
    checks.participation_snapshot_present = Object.keys(participation).length > 0;
    checks.participation_candidate_valid = snapshot.event?.source === 'participation_monitor'
      && snapshot.event?.seat === 'front' && participation.seat === 'front'
      && Number.isFinite(participation.version)
      && participation.inactive_duration_ms >= 20000 && participation.dialogue_silence_ms >= 2500
      && participation.remaining_ms > 15000 && participation.invitation_declined !== true
      && ['awake', 'normal', 'active', 'happy', 'excited', 'calm', '清醒', '正常', '普通', '开心', '兴奋', '平静', '大笑', '沉默'].includes(frontState)
      && snapshot.game?.status === 'playing';
    checks.participation_version_match = Number.isFinite(participation.version)
      && scene.participation_version === participation.version;
  }
  return {
    valid: event.valid ?? null,
    event_type: event.event_type || null,
    situation_status: context.situation_status || null,
    suggested_strategy: context.situation_guidance?.strategy || null,
    suggested_target: context.situation_guidance?.target_seat || null,
    model_intent: candidate.intent || null,
    model_strategy: candidate.strategy || null,
    model_target: candidate.target_seat || null,
    handoff_checks: checks,
    failed_handoff_checks: Object.entries(checks).filter(([key, value]) => key === 'expired_before_node_started' ? value === true : value === false).map(([key]) => key),
  };
}

function summarizeLlmOutput(value) {
  const outputs = parse(value);
  const structured = parse(outputs.structured_output);
  const candidate = typeof outputs.text === 'string' ? outputs.text
    : typeof outputs.structured_output === 'string' ? outputs.structured_output
      : outputs.structured_output && typeof outputs.structured_output === 'object'
        ? JSON.stringify(outputs.structured_output) : '';
  const final = candidate.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '').trim();
  const parsed = Object.keys(structured).length ? structured : parse(final);
  const json = parsed && typeof parsed === 'object' && Object.keys(parsed).length ? parsed : null;
  const text = candidate.trim();
  return {
    output_keys: Object.keys(outputs),
    text_length: candidate.length,
    format: !text ? 'empty' : json ? 'json' : /^<think>[\s\S]*<\/think>\s*$/i.test(text) ? 'think_only' : 'non_json',
    ai_reply_text_present: typeof json?.ai_reply_text === 'string' && Boolean(json.ai_reply_text.trim()),
    strategy: typeof json?.strategy === 'string' ? json.strategy : null,
  };
}
