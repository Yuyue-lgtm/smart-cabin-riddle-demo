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
    "server_instance_id", "diagnostics_version",
  ];
  const safe = {};
  for (const field of fields) {
    if (record[field] !== undefined) {
      safe[field] = field === "error" ? String(record[field]).slice(0, 300) : record[field];
    }
  }

  if (record.proxy_failure && typeof record.proxy_failure === "object") {
    const failureFields = ["stage", "api_origin", "error_name", "error_code", "cause_code"];
    safe.proxy_failure = Object.fromEntries(failureFields
      .filter((field) => typeof record.proxy_failure[field] === "string")
      .map((field) => [field, record.proxy_failure[field].slice(0, 120)]));
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
    const textFields = ["type", "game_status", "timeline_status", "host_speech_source", "result_feedback_state",
      "pending_minimum_speech_source"];
    const numericFields = ["deferred_reply_count", "pending_chat_count", "host_speech_remaining_ms",
      "result_feedback_remaining_ms", "wait_duration_ms"];
    const booleanFields = ["simulation_paused", "workflow_in_flight", "next_round_timer_active"];
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
