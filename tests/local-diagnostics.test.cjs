const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { appendWorkflowDiagnostic } = require("../api/local-diagnostics");
const { sanitizeRecord } = require("../api/local-diagnostics");

test("opening diagnostics retain categorical failures without clues or dialogue", () => {
  for (const reason of ["prefetch_timeout", "prefetch_failed"]) {
    const safe = sanitizeRecord({client_diagnostic:{type:"workflow_failure",stage:"game_opening",reason,
      player_input:"private answer",text:"private opening",api_key:"private secret"}});
    assert.deepEqual(safe.client_diagnostic,{type:"workflow_failure",stage:"game_opening",reason});
    assert.doesNotMatch(JSON.stringify(safe),/private/);
  }
});

test("submission timing diagnostics omit the answer and question text", () => {
  const safe = sanitizeRecord({ client_diagnostic: { type: "player_submission", stage: "dispatched",
    elapsed_ms: 12000, player_input: "private answer", text: "private question" } });
  assert.deepEqual(safe.client_diagnostic, { type: "player_submission", stage: "dispatched", elapsed_ms: 12000 });
});

test("voice buffering diagnostics keep bounded metrics but never audio or speech", () => {
  const safe = sanitizeRecord({ client_diagnostic: { type: "host_voice", stage: "waiting",
    audio_chunk_count: 4, audio_bytes: 24000, max_chunk_gap_ms: 1850, waiting_count: 2, stalled_count: 0,
    audio_current_time_ms: 1200, buffered_ahead_ms: -50, speech_text: "private speech", audio: "private audio" } });
  assert.equal(safe.client_diagnostic.stage, "waiting");
  assert.equal(safe.client_diagnostic.max_chunk_gap_ms, 1850);
  assert.equal(safe.client_diagnostic.audio_bytes, 24000);
  assert.equal(safe.client_diagnostic.buffered_ahead_ms, 0);
  assert.doesNotMatch(JSON.stringify(safe), /private/);
});

test("server TTS timings distinguish connection, task startup and audio delivery without payloads", () => {
  const safe = sanitizeRecord({ phase: 'tts_finish', tts_timing: { connect_ms: 123.4,
    task_started_ms: 400, first_audio_ms: 1250, audio_chunks: 4, audio_bytes: 2048, max_chunk_gap_ms: 220,
    text: 'private speech', api_key: 'private key' } });
  assert.deepEqual(safe.tts_timing, { connect_ms: 123, task_started_ms: 400, first_audio_ms: 1250,
    audio_chunks: 4, audio_bytes: 2048, max_chunk_gap_ms: 220 });
  assert.doesNotMatch(JSON.stringify(safe), /private/);
});

test("production voice and workflow client logs accept only categorical metadata and UUIDs", () => {
  for (const type of ["host_voice", "workflow_failure"]) {
    const safe = sanitizeRecord({ phase: "client_runtime", client_diagnostic: {
      type, stage: "failed", reason: "browser_blocked", screen_mode: "playing", browser_engine: "webkit",
      transport: "blob", session_id: "26b4a21e-4e19-4a63-958a-f1345dd127df", request_id: "private credential",
      speech_id: 7, http_status: 200, sound_enabled: true, speech_text: "private speech",
      error_message: "private upstream text", voice_configured: true, audio_error_code: 4,
    } });
    assert.equal(safe.client_diagnostic.reason, "browser_blocked");
    assert.equal(safe.client_diagnostic.browser_engine, "webkit");
    assert.equal(safe.client_diagnostic.speech_id, 7);
    assert.equal(safe.client_diagnostic.request_id, undefined);
    assert.doesNotMatch(JSON.stringify(safe), /private/);
    const malicious = sanitizeRecord({ client_diagnostic: { type, stage:"private speech", reason:"private key", browser_engine:"private user agent" } });
    assert.deepEqual(malicious.client_diagnostic, {type});
  }
});

test("client runtime errors retain safe source locations but discard messages and URLs", () => {
  const safe = sanitizeRecord({ phase: "client_runtime", client_diagnostic: {
    type: "client_error", stage: "script_error", error_name: "TypeError", source: "client-app.js",
    line: 128, column: 4, message: "private data", url: "https://example.test/private?token=secret",
  } });
  assert.deepEqual(safe.client_diagnostic, {
    type: "client_error", stage: "script_error", error_name: "TypeError", source: "client-app.js", line: 128, column: 4,
  });
  assert.doesNotMatch(JSON.stringify(safe), /private data|example\.test|secret/);
});

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
    conversation_recovered: true,
    upstream_failure: { status: 404, code: "not_found", category: "conversation_not_found",
      workflow_status: "", message: "private upstream prompt" },
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
  assert.equal(record.conversation_recovered, true);
  assert.deepEqual(record.upstream_failure, {
    status: 404, code: "not_found", category: "conversation_not_found", workflow_status: "",
  });
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
  assert.doesNotMatch(saved, /private question|private answer|private conversation|private reply|private model|private prompt|private upstream prompt|must not persist/);
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
