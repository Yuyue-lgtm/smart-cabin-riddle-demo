const assert = require("node:assert/strict");
const test = require("node:test");
const { handleWorkflowBody } = require("../api/dify-bff");

test("SSE diagnostics distinguish missing replies from structured parse failures without exposing node contents", async (t) => {
  const oldKey = process.env.DIFY_CHATFLOW_API_KEY;
  process.env.DIFY_CHATFLOW_API_KEY = "diagnostic-test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.DIFY_CHATFLOW_API_KEY;
    else process.env.DIFY_CHATFLOW_API_KEY = oldKey;
  });
  const model = { node_id: "1000000000005", node_type: "llm", status: "succeeded",
    outputs: { text: "<think>private model reasoning</think>" } };
  t.mock.method(global, "fetch", async () => ({
    ok: true, headers: { get: () => "text/event-stream" }, text: async () => [
      { event: "workflow_started", data: { id: "trace-run" } },
      { event: "node_finished", data: model },
      { event: "node_finished", data: { outputs: { host_result: JSON.stringify({
        ai_reply_text: "我陪你慢慢想，按你的节奏来。",
        debug: { fallback_reason_codes: ["upstream_validation_failed"],
          validation_reason_codes: ["invalid_or_empty_model_json", "missing_model_reply"] },
        decision_trace: { guard_status: "constraint_fallback" },
      }) } } },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  }));
  const request = { route: "chat", query: "它是人造的吗？", input_payload: {
    trigger_type: "chat", game_id: "g", round_id: "r", scene_version: "v",
    game: { status: "playing", current_answer: "海豚" },
  } };
  const first = await handleWorkflowBody(request);
  const firstSummary = first.payload.diagnostic.model_nodes[0];
  assert.equal(firstSummary.format, "think_only");
  assert.equal(firstSummary.ai_reply_text_present, false);
  assert.doesNotMatch(JSON.stringify(first.payload.diagnostic), /private model reasoning/);

  model.outputs.structured_output = {};
  const emptyStructured = await handleWorkflowBody(request);
  assert.equal(emptyStructured.payload.diagnostic.model_nodes[0].format, "think_only");
  assert.equal(emptyStructured.payload.diagnostic.model_nodes[0].structured_output_present, false);

  model.status = "exception";
  model.error = "Failed to parse structured output: private model output";
  model.outputs = { text: "{}" };
  const failed = await handleWorkflowBody(request);
  assert.equal(failed.payload.diagnostic.model_nodes[0].error_code, "structured_output_parse_failed");
  assert.doesNotMatch(JSON.stringify(failed.payload.diagnostic), /private model output/);

  model.error = "Unknown error";
  model.outputs = { text: "", error_message: "Failed to parse structured output: private model output" };
  const nested = await handleWorkflowBody(request);
  assert.equal(nested.payload.diagnostic.model_nodes[0].error_code, "structured_output_parse_failed");
  assert.doesNotMatch(JSON.stringify(nested.payload.diagnostic), /private model output/);

  model.status = "succeeded";
  delete model.error;
  model.outputs = { structured_output: { ai_reply_text: "不是。" } };
  const structured = await handleWorkflowBody(request);
  assert.equal(structured.payload.diagnostic.model_nodes[0].format, "json");
  assert.equal(structured.payload.diagnostic.model_nodes[0].ai_reply_text_present, true);

  delete model.outputs;
  const hidden = await handleWorkflowBody(request);
  assert.equal(hidden.payload.diagnostic.model_nodes[0].format, "unavailable");
  assert.equal(hidden.payload.diagnostic.model_nodes[0].output_available, false);
});

test("recovered and exhausted model attempts remain visible in response diagnostics", async (t) => {
  const oldKey = process.env.DIFY_CHATFLOW_API_KEY;
  process.env.DIFY_CHATFLOW_API_KEY = "diagnostic-test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.DIFY_CHATFLOW_API_KEY;
    else process.env.DIFY_CHATFLOW_API_KEY = oldKey;
  });
  const debug = { model_output_status: "retry_exhausted", model_retry_count: 1,
    model_attempts: [{ attempt: 1, status: "invalid", reason_codes: ["think_only_output"] },
      { attempt: 2, status: "invalid", reason_codes: ["empty_model_output"] }],
    model_failure_reason_codes: ["think_only_output", "empty_model_output"],
    fallback_reason_codes: ["model_retry_exhausted"] };
  t.mock.method(global, "fetch", async () => ({ ok: true,
    headers: { get: () => "text/event-stream" }, text: async () => [
      { event: "node_finished", data: { node_id: "1000000000005", node_type: "llm", status: "exception", outputs: { text: "" } } },
      { event: "node_finished", data: { node_id: "1000000000023", node_type: "llm", status: "exception", outputs: { text: "" } } },
      { event: "node_finished", data: { outputs: { host_result: JSON.stringify({
        ai_reply_text: "刚才没接上你的问题，能再说一次吗？", debug,
        decision_trace: { guard_status: "model_output_fallback" },
      }) } } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") }));
  const request = { route: "chat", query: "它是人造的吗？", input_payload: {
    trigger_type: "chat", game_id: "g", round_id: "r", scene_version: "v",
    game: { status: "playing", current_answer: "海豚" },
  } };
  const result = await handleWorkflowBody(request);
  assert.equal(result.payload.diagnostic.status, "reason_recorded");
  assert.equal(result.payload.diagnostic.model_retry_count, 1);
  assert.equal(result.payload.diagnostic.model_nodes.length, 2);
  assert.deepEqual(result.payload.diagnostic.model_failure_reason_codes, debug.model_failure_reason_codes);
  assert.deepEqual(result.payload.diagnostic.model_attempts, debug.model_attempts);
});

test("skipped event replies are classified as skipped and retain the input validation status", async t => {
  const oldKey = process.env.DIFY_CHATFLOW_API_KEY;
  process.env.DIFY_CHATFLOW_API_KEY = "diagnostic-test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.DIFY_CHATFLOW_API_KEY; else process.env.DIFY_CHATFLOW_API_KEY = oldKey; });
  t.mock.method(global, "fetch", async () => ({ ok: true, headers: { get: () => "text/event-stream" }, text: async () => [
    { event: "node_finished", data: { node_id: "1000000000002", outputs: { context_json: JSON.stringify({
      event_dialogue: { valid: false, event_type: "passenger_inactive", private_input: "private question" },
      situation_status: "invalid_event_handoff" }) } } },
    { event: "node_finished", data: { outputs: { host_result: JSON.stringify({ ai_reply_text: "",
      decision_trace: { guard_status: "event_reply_skipped" } }) } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") }));
  const result = await handleWorkflowBody({ route: "chat", query: "test", input_payload: { trigger_type: "chat" } });
  assert.equal(result.payload.diagnostic.status, "event_reply_skipped");
  assert.deepEqual(result.payload.diagnostic.event_context, {
    valid: false, event_type: "passenger_inactive", situation_status: "invalid_event_handoff",
  });
  assert.doesNotMatch(JSON.stringify(result.payload.diagnostic), /private question/);
});
