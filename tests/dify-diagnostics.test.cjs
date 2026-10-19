const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const script = path.resolve(__dirname, "../tools/dify-workflow-mcp/scripts/diagnose-chatflow-run.mjs");

function inspect(nodes, run = { status: "succeeded" }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dify-diagnostic-test-"));
  const fixture = path.join(directory, "trace.json");
  try {
    fs.writeFileSync(fixture, JSON.stringify({ run, node_executions: { data: nodes } }));
    return spawnSync(process.execPath, [script, "--fixture", fixture], { encoding: "utf8" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("trace report identifies the guard and upstream validation without printing private inputs", () => {
  const result = inspect([
    { node_id: "1000000000005", title: "LLM", status: "succeeded", elapsed_time: 2.5 },
    { node_id: "1000000000006", title: "话术与动作守卫", status: "succeeded", outputs: {
      workflow_output: JSON.stringify({ ai_reply_text: "我陪你慢慢想，按你的节奏来。",
        debug: { fallback_origin: "parallel_guard", fallback_reason_codes: ["upstream_validation_failed"],
          validation_errors: ["missing_long_or_answer_leaking_reply"], validation_reason_codes: ["answer_leak_in_model_reply"] },
        decision_trace: { guard_status: "constraint_fallback" }, answer: "private-answer" }),
    } },
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.diagnostic_status, "reason_recorded");
  assert.deepEqual(report.validation_reason_codes, ["answer_leak_in_model_reply"]);
  assert.doesNotMatch(result.stdout, /private-answer/);
});

test("trace report fails visibly when the guard output is unavailable", () => {
  const result = inspect([{ node_id: "1000000000006", status: "succeeded", outputs: {} }]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).diagnostic_status, "trace_missing_guard_output");
});

test("historical run graph pinpoints an unsupported situation event without exposing the snapshot", () => {
  const event = { id: "inactive-1", type: "passenger_inactive" };
  const scope = { game_id: "g", round_id: "r", scene_version: "v" };
  const result = inspect([
    { node_id: "1000000000002", created_at: 100, inputs: {
      snapshot: JSON.stringify({ ...scope, event, dialogue_request: { event_id: event.id }, game: { status: "playing", current_answer: "private-answer" } }),
      situation: JSON.stringify({ ...scope, event_id: event.id, analysis_status: "ready", request_proactive_speech: true,
        generated_at_ms: 100000, expires_at_ms: 110000 }),
    }, outputs: { context_json: JSON.stringify({ event_dialogue: { valid: false, event_type: event.type }, situation_status: "invalid_event_handoff" }) } },
    { node_id: "1000000000006", outputs: { workflow_output: JSON.stringify({ ai_reply_text: "",
      decision_trace: { guard_status: "event_reply_skipped" } }) } },
  ], { status: "succeeded", graph: { nodes: [{ id: "1000000000002", data: { code: 'SCENE_EVENTS = {"environment_change"}' } }] } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.diagnostic_status, "event_reply_skipped");
  assert.deepEqual(report.event_context.failed_handoff_checks, ["event_type_supported", "participation_snapshot_present",
    "participation_candidate_valid", "participation_version_match"]);
  assert.doesNotMatch(result.stdout, /private-answer/);
});

test("latest diagnostics work offline across rotated logs, including failures without a Dify run ID", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dify-latest-diagnostic-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, "workflow.ndjson");
  const fallback = { phase: "finish", route: "chat", status: 200, fixed_soft_fallback: true,
    workflow_run_id: "4b50a330-5ba5-40d5-89cc-386125392087", round_id: "round-2",
    diagnostic: { status: "reason_recorded", validation_reason_codes: ["missing_model_reply"],
      model_nodes: [{ format: "think_only" }] } };
  fs.writeFileSync(`${log}.1`, JSON.stringify(fallback) + "\n");
  fs.writeFileSync(log, JSON.stringify({ phase: "finish", route: "chat", status: 200 }) + "\n");
  const run = () => spawnSync(process.execPath, [script, "--latest"], {
    encoding: "utf8", env: { ...process.env, DIFY_DIAGNOSTICS_LOG_PATH: log },
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inspection_source, "local_sse");
  assert.equal(report.round_id, "round-2");
  assert.equal(report.model_nodes[0].format, "think_only");

  fs.appendFileSync(log, JSON.stringify({ phase: "finish", route: "chat", status: 504,
    error: "DIFY_CHATFLOW_TIMEOUT" }) + "\n");
  const failed = run();
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).diagnostic_status, "request_failed");
  assert.equal(JSON.parse(failed.stdout).workflow_run_id, null);
  const noRun = spawnSync(process.execPath, [script, "--latest", "--cloud"], {
    encoding: "utf8", env: { ...process.env, DIFY_DIAGNOSTICS_LOG_PATH: log },
  });
  assert.equal(noRun.status, 0, noRun.stderr);
  assert.equal(JSON.parse(noRun.stdout).cloud_unavailable_reason, "request_has_no_workflow_run_id");

  fs.appendFileSync(log, JSON.stringify({ phase: "finish", route: "chat", status: 200,
    workflow_run_id: "4b50a330-5ba5-40d5-89cc-386125392088",
    diagnostic: { status: "reason_recorded", model_output_status: "retry_exhausted", model_retry_count: 1,
      model_attempts: [{ attempt: 1, reason_codes: ["empty_model_output"] }],
      model_failure_reason_codes: ["empty_model_output"] } }) + "\n");
  const exhausted = run();
  assert.equal(exhausted.status, 0, exhausted.stderr);
  assert.equal(JSON.parse(exhausted.stdout).model_output_status, "retry_exhausted");
  assert.equal(JSON.parse(exhausted.stdout).model_retry_count, 1);
  assert.deepEqual(JSON.parse(exhausted.stdout).model_failure_reason_codes, ["empty_model_output"]);

  fs.appendFileSync(log, JSON.stringify({ phase: "finish", route: "chat", operation: "situation_reply", status: 200,
    event_id: "inactive-event", event_type: "passenger_inactive",
    workflow_run_id: "4b50a330-5ba5-40d5-89cc-386125392089",
    diagnostic: { status: "no_guard_fallback_observed", guard_status: "event_reply_skipped" } }) + "\n");
  const skipped = run();
  assert.equal(skipped.status, 0, skipped.stderr);
  const skippedReport = JSON.parse(skipped.stdout);
  assert.equal(skippedReport.diagnostic_status, "event_reply_skipped");
  assert.equal(skippedReport.event_type, "passenger_inactive");
  assert.equal(skippedReport.related_requests[0].event_id, "inactive-event");
});
