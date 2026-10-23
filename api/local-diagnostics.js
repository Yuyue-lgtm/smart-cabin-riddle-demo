const fs = require("fs");
const path = require("path");

const DEFAULT_LOG_PATH = path.join(__dirname, "..", "tmp", "workflow-diagnostics.ndjson");
const MAX_LOG_BYTES = 2 * 1024 * 1024;

function appendWorkflowDiagnostic(record, logPath = DEFAULT_LOG_PATH) {
  const safeRecord = sanitizeRecord(record);
  const line = `${JSON.stringify(safeRecord)}\n`;
  fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });

  try {
    if (fs.statSync(logPath).size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const fd = fs.openSync(logPath, "a", 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizeRecord(record) {
  const fields = [
    "phase", "diagnostic_id", "timestamp", "route", "operation", "trigger_type", "event_type", "event_id",
    "game_id", "round_id", "round_transition", "conversation_fingerprint", "status", "elapsed_ms",
    "context_verified", "context_scope", "message_id", "workflow_run_id", "app_id", "preview_status",
    "guard_status", "matched_rule", "strategy", "fixed_soft_fallback", "reply_fingerprint", "error",
    "server_instance_id", "diagnostics_version", "conversation_recovered",
  ];
  const safe = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      safe[field] = field === "error" ? String(record[field]).slice(0, 300) : record[field];
    }
  }

  if (record.tts_timing && typeof record.tts_timing === "object") {
    safe.tts_timing = {};
    for (const field of ["connect_ms", "task_started_ms", "first_audio_ms", "audio_chunks", "audio_bytes", "max_chunk_gap_ms"]) {
      if (Number.isFinite(record.tts_timing[field])) safe.tts_timing[field] = Math.max(0, Math.min(86400000, Math.round(record.tts_timing[field])));
    }
  }

  if (record.proxy_failure && typeof record.proxy_failure === "object") {
    const failureFields = ["stage", "api_origin", "error_name", "error_code", "cause_code"];
    safe.proxy_failure = Object.fromEntries(failureFields
      .filter((field) => typeof record.proxy_failure[field] === "string")
      .map((field) => [field, record.proxy_failure[field].slice(0, 120)]));
  }

  if (record.upstream_failure && typeof record.upstream_failure === "object") {
    const failure = record.upstream_failure;
    safe.upstream_failure = {
      status: Number.isInteger(failure.status) ? Math.max(0, Math.min(599, failure.status)) : 0,
      category: ["conversation_not_found", "authentication_failed", "rate_or_quota_limit", "structured_output_failed",
        "model_authentication_failed", "upstream_timeout", "workflow_failed", "resource_not_found", "empty_response", "upstream_error"]
        .includes(failure.category) ? failure.category : "upstream_error",
      code: /^[a-z_]{1,80}$/i.test(failure.code || "") ? failure.code : "",
      workflow_status: ["failed", "stopped"].includes(failure.workflow_status) ? failure.workflow_status : "",
    };
  }

  if (record.diagnostic && typeof record.diagnostic === "object") {
    const diagnosticFields = [
      "status", "source", "observed_fixed_fallback", "guard_status", "fallback_origin",
      "reason_codes", "validation_errors", "validation_reason_codes",
      "model_output_status", "model_retry_count", "model_failure_reason_codes",
    ];
    safe.diagnostic = Object.fromEntries(diagnosticFields
      .filter((field) => record.diagnostic[field] !== undefined)
      .map((field) => [field, record.diagnostic[field]]));
    if (Array.isArray(record.diagnostic.model_attempts)) {
      const attemptFields = ["attempt", "source", "status", "reason_codes"];
      safe.diagnostic.model_attempts = record.diagnostic.model_attempts.slice(0, 2)
        .filter(attempt => attempt && typeof attempt === "object")
        .map(attempt => Object.fromEntries(attemptFields.filter(field => attempt[field] !== undefined)
          .map(field => [field, attempt[field]])));
    }
    if (Array.isArray(record.diagnostic.model_nodes)) {
      const nodeFields = [
        "node_id", "status", "elapsed_time", "error_code", "text_length", "output_available", "format",
        "ai_reply_text_present", "structured_output_present", "reasoning_length",
      ];
      safe.diagnostic.model_nodes = record.diagnostic.model_nodes.slice(0, 8)
        .filter((node) => node && typeof node === "object")
        .map((node) => Object.fromEntries(nodeFields.filter((field) => node[field] !== undefined)
          .map((field) => [field, node[field]])));
    }
    if (record.diagnostic.event_context && typeof record.diagnostic.event_context.valid === "boolean") {
      const context = record.diagnostic.event_context;
      safe.diagnostic.event_context = { valid: context.valid,
        event_type: String(context.event_type || "").slice(0, 80),
        situation_status: String(context.situation_status || "").slice(0, 80) };
    }
  }

  if (record.preview_diagnostic && typeof record.preview_diagnostic === "object") {
    safe.preview_diagnostic = {
      status: record.preview_diagnostic.status || "",
      validation_errors: Array.isArray(record.preview_diagnostic.validation_errors)
        ? record.preview_diagnostic.validation_errors : [],
    };
  }

  if (record.client_diagnostic && typeof record.client_diagnostic === "object") {
    const diagnostic = record.client_diagnostic;
    if (diagnostic.type === "client_error") {
      const sanitized = { type: diagnostic.type };
      if (["script_error", "unhandled_rejection", "resource_error"].includes(diagnostic.stage)) sanitized.stage = diagnostic.stage;
      if (["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError", "SecurityError", "AbortError", "other"]
        .includes(diagnostic.error_name)) sanitized.error_name = diagnostic.error_name;
      if (["audio", "img", "link", "script", "source", "video"].includes(diagnostic.element_type)) sanitized.element_type = diagnostic.element_type;
      if (typeof diagnostic.source === "string" && /^[\w.-]{1,100}$/.test(diagnostic.source)) sanitized.source = diagnostic.source;
      for (const field of ["line", "column"]) {
        if (Number.isFinite(diagnostic[field])) sanitized[field] = Math.max(0, Math.min(10_000_000, Math.round(diagnostic[field])));
      }
      safe.client_diagnostic = sanitized;
      return safe;
    }
    if (["host_voice", "workflow_failure", "page_state", "player_submission"].includes(diagnostic.type)) {
      const sanitized = { type: diagnostic.type };
      const enums = {
        stage: ["toggle", "skipped", "requested", "response", "playing", "waiting", "waiting_resume", "stalled", "ended", "failed", "cancelled", "fetch", "parse", "validate", "normalize", "local_fallback", "boot", "ready", "pageshow", "focus", "layout_invalid", "layout_recovered", "submitted", "queued", "dispatched", "resolved", "game_opening"],
        reason: ["none", "muted", "not_configured", "empty_text", "text_too_long", "http_error", "network_error", "invalid_json", "route_mismatch", "operation_mismatch", "event_mismatch", "round_mismatch", "normalize_error", "browser_blocked", "media_error", "media_timeout", "timeout_or_cancel", "first_audio_timeout", "stream_idle_timeout", "audio_missing", "playback_error", "workflow_error", "reply_missing", "prefetch_timeout", "prefetch_failed"],
        screen_mode: ["loading", "ready", "playing", "reveal", "summary"],
        browser_engine: ["chromium", "webkit", "firefox", "unknown"],
        transport: ["mse", "blob", "none"],
        route: ["chat", "situation", "preview"],
      };
      for (const [field, values] of Object.entries(enums)) {
        if (values.includes(diagnostic[field])) sanitized[field] = diagnostic[field];
      }
      for (const field of ["speech_id", "http_status", "elapsed_ms", "audio_ready_state", "audio_error_code",
        "audio_chunk_count", "audio_bytes", "max_chunk_gap_ms", "waiting_count", "stalled_count", "audio_current_time_ms", "buffered_ahead_ms",
        "viewport_width", "viewport_height", "root_width", "root_height"]) {
        if (Number.isFinite(diagnostic[field])) sanitized[field] = Math.max(0, Math.min(86400000, Math.round(diagnostic[field])));
      }
      for (const field of ["sound_enabled", "voice_configured", "simulation_paused", "page_visible", "page_focused"]) {
        if (typeof diagnostic[field] === "boolean") sanitized[field] = diagnostic[field];
      }
      for (const field of ["session_id", "request_id"]) {
        if (typeof diagnostic[field] === "string" && /^[a-f0-9-]{36}$/.test(diagnostic[field])) sanitized[field] = diagnostic[field];
      }
      safe.client_diagnostic = sanitized;
      return safe;
    }
    const textFields = ["type", "game_status", "timeline_status", "host_speech_source", "result_feedback_state",
      "pending_minimum_speech_source"];
    const numericFields = ["deferred_reply_count", "pending_chat_count", "host_speech_remaining_ms",
      "result_feedback_remaining_ms", "wait_duration_ms"];
    const booleanFields = ["simulation_paused", "workflow_in_flight", "next_round_timer_active",
      "host_voice_pending", "host_voice_playing"];
    const sanitized = {};
    for (const field of textFields) {
      if (typeof diagnostic[field] === "string") sanitized[field] = diagnostic[field].slice(0, 80);
    }
    for (const field of numericFields) {
      if (Number.isFinite(diagnostic[field])) sanitized[field] = Math.max(0, Math.min(86400000, Math.round(diagnostic[field])));
    }
    for (const field of booleanFields) {
      if (typeof diagnostic[field] === "boolean") sanitized[field] = diagnostic[field];
    }
    for (const field of ["deferred_reply_sources", "blockers"]) {
      if (Array.isArray(diagnostic[field])) {
        sanitized[field] = diagnostic[field].slice(0, 8)
          .filter(value => typeof value === "string")
          .map(value => value.slice(0, 80));
      }
    }
    safe.client_diagnostic = sanitized;
  }

  return safe;
}

module.exports = { appendWorkflowDiagnostic, DEFAULT_LOG_PATH, sanitizeRecord };
