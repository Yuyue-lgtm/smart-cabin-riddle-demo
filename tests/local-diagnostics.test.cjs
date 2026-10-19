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
  assert.deepEqual(record.diagnostic.reason_codes, ["upstream_validation_failed"]);
  assert.equal(record.diagnostic.model_nodes[0].format, "think_only");
  assert.equal(record.diagnostic.model_retry_count, 1);
  assert.equal(record.diagnostic.model_output_status, "retry_exhausted");
  assert.deepEqual(record.diagnostic.model_attempts[0].reason_codes, ["think_only_output"]);
  assert.deepEqual(record.diagnostic.event_context, {
    valid: false, event_type: "passenger_inactive", situation_status: "invalid_event_handoff",
  });
  assert.doesNotMatch(saved, /private question|private answer|private conversation|private reply|private model|private prompt/);
  assert.equal(fs.statSync(logPath).mode & 0o777, 0o600);
});
