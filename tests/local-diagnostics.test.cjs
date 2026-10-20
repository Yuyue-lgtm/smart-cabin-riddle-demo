const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { appendWorkflowDiagnostic } = require("../api/local-diagnostics");

test("local workflow diagnostics retain correlation and guard codes without private conversation data", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cabin-diagnostics-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const logPath = path.join(folder, "workflow.ndjson");

  appendWorkflowDiagnostic({
    phase: "finish",
    diagnostic_id: "diag-1",
    route: "chat",
    workflow_run_id: "run-1",
    app_id: "app-1",
    fixed_soft_fallback: true,
    proxy_failure: {
      stage: "chatflow_fetch", api_origin: "http://127.0.0.1:8081",
      error_name: "TypeError", error_code: "", cause_code: "ECONNREFUSED",
      private_message: "must not persist",
    },
    diagnostic: {
      status: "reason_recorded",
      reason_codes: ["upstream_validation_failed"],
      validation_reason_codes: ["missing_model_reply"],
      model_retry_count: 1,
      model_output_status: "retry_exhausted",
      model_failure_reason_codes: ["think_only_output"],
      model_attempts: [{ attempt: 1, source: "none", status: "invalid", reason_codes: ["think_only_output"],
        text: "private model output" }],
      model_nodes: [{ node_id: "llm-1", status: "succeeded", format: "think_only", text_length: 80,
        text: "private model output", prompts: ["private prompt"] }],
      event_context: { valid: false, event_type: "passenger_inactive", situation_status: "invalid_event_handoff",
        snapshot: "private conversation" },
    },
    player_input: "private question",
    current_answer: "private answer",
    recent_messages: ["private conversation"],
    ai_reply_text: "private reply",
  }, logPath);

  const saved = fs.readFileSync(logPath, "utf8");
  const record = JSON.parse(saved);
  assert.equal(record.workflow_run_id, "run-1");
  assert.deepEqual(record.proxy_failure, {
    stage: "chatflow_fetch", api_origin: "http://127.0.0.1:8081",
    error_name: "TypeError", error_code: "", cause_code: "ECONNREFUSED",
  });
  assert.deepEqual(record.diagnostic.reason_codes, ["upstream_validation_failed"]);
  assert.equal(record.diagnostic.model_nodes[0].format, "think_only");
  assert.equal(record.diagnostic.model_retry_count, 1);
  assert.equal(record.diagnostic.model_output_status, "retry_exhausted");
  assert.deepEqual(record.diagnostic.model_attempts[0].reason_codes, ["think_only_output"]);
  assert.deepEqual(record.diagnostic.event_context, {
    valid: false, event_type: "passenger_inactive", situation_status: "invalid_event_handoff",
  });
  assert.doesNotMatch(saved, /private question|private answer|private conversation|private reply|private model|private prompt|must not persist/);
  assert.equal(fs.statSync(logPath).mode & 0o777, 0o600);
});

test("client round-advance diagnostics keep wait gates but never persist speech contents", (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cabin-client-diagnostics-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const logPath = path.join(folder, "workflow.ndjson");
  appendWorkflowDiagnostic({
    phase: "client_runtime",
    game_id: "game-1",
    round_id: "game-1-round-1",
    player_input: "private question",
    client_diagnostic: {
      type: "round_advance_wait",
      game_status: "victory",
      timeline_status: "running",
      simulation_paused: false,
      workflow_in_flight: true,
      deferred_reply_count: 1,
      deferred_reply_sources: ["environment"],
      pending_chat_count: 1,
      host_speech_source: "victory",
      host_speech_remaining_ms: 1200,
      result_feedback_state: "waiting",
      result_feedback_remaining_ms: 5000,
      pending_minimum_speech_source: "chat",
      next_round_timer_active: true,
      blockers: ["workflow_in_flight", "result_feedback_not_shown"],
      wait_duration_ms: 5200,
      speech_text: "private host speech",
    },
  }, logPath);

  const saved = fs.readFileSync(logPath, "utf8");
  const record = JSON.parse(saved);
  assert.deepEqual(record.client_diagnostic.blockers, ["workflow_in_flight", "result_feedback_not_shown"]);
  assert.equal(record.client_diagnostic.host_speech_remaining_ms, 1200);
  assert.equal(record.client_diagnostic.speech_text, undefined);
  assert.doesNotMatch(saved, /private question|private host speech/);
});
