const assert = require("node:assert/strict");
const test = require("node:test");
const { handleWorkflowBody, probeBffReadiness } = require("../api/dify-bff");

function fixture(t, fetchImpl, extraEnv = {}) {
  const values = { DIFY_CHATFLOW_API_KEY: "fictional-chat-key", DIFY_SITUATION_API_KEY: "fictional-situation-key",
    DIFY_PREVIEW_API_KEY: "fictional-preview-key", DIFY_API_BASE_URL: "http://dify-fixture.invalid", ...extraEnv };
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.mock.method(global, "fetch", fetchImpl);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

function response(status, payload, contentType = "application/json") {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => contentType },
    text: async () => typeof payload === "string" ? payload : JSON.stringify(payload) };
}

const chat = { route: "chat", user_id: "fictional-user", conversation_id: "stale-conversation",
  input_payload: { trigger_type: "chat", game_id: "g", round_id: "r", scene_version: "s",
    player_input: "当前题，它是人造的吗？", game: { status: "playing", current_answer: "安全带" } } };
const host = { context_scope: { game_id: "g", round_id: "r", scene_version: "s" }, ai_reply_text: "是的。", intent: "answer_question" };
const sse = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
const success = () => response(200, sse([
  { event: "node_finished", data: { outputs: { host_result: JSON.stringify(host) } } },
  { event: "message_end", conversation_id: "fresh-conversation" },
]), "text/event-stream");

test("a rejected stale conversation recovers once with the same authoritative snapshot and saves the new ID", async t => {
  const sent = [];
  fixture(t, async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return sent.length === 1 ? response(404, { code: "not_found", message: "Conversation Not Exists.", status: 404 }) : success();
  });
  const result = await handleWorkflowBody(chat);
  assert.equal(result.status, 200);
  assert.equal(result.payload.conversation_recovered, true);
  assert.equal(result.payload.conversation_id, "fresh-conversation");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].conversation_id, "stale-conversation");
  assert.equal(sent[1].conversation_id, undefined);
  assert.equal(sent[1].user, sent[0].user);
  const snapshot = JSON.parse(sent[1].inputs.snapshot);
  assert.equal(snapshot.game.current_answer, "安全带");
  assert.equal(snapshot.round_context.transition, "conversation_start");
  assert.equal(result.payload.context_verified, true);
});

test("stale-session errors delivered inside HTTP 200 SSE also recover", async t => {
  let calls = 0;
  fixture(t, async () => ++calls === 1 ? response(200, sse([
    { event: "error", status: 404, code: "not_found", message: "Conversation Not Exists." },
  ]), "text/event-stream") : success());
  const result = await handleWorkflowBody(chat);
  assert.equal(result.status, 200);
  assert.equal(result.payload.conversation_recovered, true);
  assert.equal(calls, 2);
});

test("authentication and unrelated resource errors do not reset a valid conversation or replay generation", async t => {
  let status = 401, calls = 0;
  fixture(t, async () => { calls++; return response(status, { code: "not_found", message: "App does not exist" }); });
  for (status of [401, 403, 404, 429, 503]) {
    const result = await handleWorkflowBody(chat);
    assert.equal(result.status, status);
    assert.equal(result.payload.conversation_recovered, false);
  }
  assert.equal(calls, 5);
});

test("session recovery is bounded to one attempt even if Dify rejects the fresh request", async t => {
  let calls = 0;
  fixture(t, async () => { calls++; return response(404, { code: "not_found", message: "Conversation Not Exists." }); });
  const result = await handleWorkflowBody(chat);
  assert.equal(result.status, 404);
  assert.equal(result.payload.conversation_recovered, true);
  assert.equal(calls, 2);
});

test("all three routes enforce the deadline after response headers, without retrying a possibly running model", async t => {
  let calls = 0, signal;
  fixture(t, async (_url, options) => {
    calls++; signal = options.signal;
    return { ok: true, status: 200, headers: { get: () => "text/event-stream" }, text: () => new Promise(() => {}) };
  }, { DIFY_BFF_TIMEOUT_MS: "25" });
  for (const route of ["chat", "situation", "preview"]) {
    const input = route === "chat" ? chat.input_payload : { ...chat.input_payload, trigger_type: "event",
      event: { id: route, type: route === "preview" ? "start_game" : "passenger_sleep", seat: "rearRight" } };
    const result = await handleWorkflowBody({ route, input_payload: input });
    assert.equal(result.status, 504, route);
    assert.match(result.payload.error, /TIMEOUT$/);
    assert.equal(result.payload.proxy_failure.error_name, "AbortError");
    assert.equal(signal.aborted, true);
  }
  assert.equal(calls, 3);
});

test("HTTP 200 stream failures are reported as failures rather than empty successful replies", async t => {
  fixture(t, async () => response(200, sse([
    { event: "workflow_started", data: { id: "run-failed" } },
    { event: "workflow_finished", data: { status: "failed", error: "private model prompt: rate limit exceeded" } },
  ]), "text/event-stream"));
  const result = await handleWorkflowBody(chat);
  assert.equal(result.status, 502);
  assert.equal(result.payload.error, "DIFY_CHATFLOW_RUN_FAILED");
  assert.equal(result.payload.workflow_run_id, "run-failed");
  assert.equal(result.payload.upstream_failure.category, "rate_or_quota_limit");
  assert.doesNotMatch(JSON.stringify(result.payload), /private model prompt/);
});

test("a ping-only closed stream is not treated as a successful model reply", async t => {
  fixture(t, async () => response(200, sse([{ event: "ping" }]), "text/event-stream"));
  const result = await handleWorkflowBody(chat);
  assert.equal(result.status, 502);
  assert.equal(result.payload.error, "DIFY_CHATFLOW_EMPTY_RESPONSE");
  assert.equal(result.payload.upstream_failure.category, "empty_response");
});

test("an error after partial generation is never retried as a fresh conversation", async t => {
  let calls = 0;
  fixture(t, async () => {
    calls++;
    return response(200, sse([
      { event: "message", answer: "已经生成的部分回复" },
      { event: "error", status: 404, code: "not_found", message: "Conversation Not Exists." },
    ]), "text/event-stream");
  });
  const result = await handleWorkflowBody(chat);
  assert.equal(result.status, 502);
  assert.equal(result.payload.conversation_recovered, false);
  assert.equal(calls, 1);
});

test("failed blocking workflows preserve run IDs and preview partial-repair behavior", async t => {
  fixture(t, async () => response(200, { workflow_run_id: "failed-blocking-run",
    data: { status: "failed", error: "Failed to parse structured output: private content" } }));
  for (const route of ["situation", "preview"]) {
    const result = await handleWorkflowBody({ route, input_payload: { trigger_type: "event",
      event: { id: route, type: route === "preview" ? "start_game" : "passenger_sleep", seat: "rearRight" } } });
    assert.equal(result.status, route === "preview" ? 200 : 502);
    assert.equal(result.payload.workflow_run_id, "failed-blocking-run");
    assert.equal(result.payload.upstream_failure.category, "structured_output_failed");
    if (route === "situation") assert.doesNotMatch(JSON.stringify(result.payload), /private content/);
    else assert.equal(result.payload.preview_status, "failed");
  }
});

test("readiness checks all three API credentials, coalesces probes and never calls a model", async t => {
  const urls = [];
  fixture(t, async (url, options) => {
    urls.push(url);
    return options.headers.Authorization.includes("situation") ? response(401, { code: "unauthorized" }) : response(200, {});
  });
  const [first, second] = await Promise.all([probeBffReadiness(), probeBffReadiness()]);
  assert.deepEqual(first, second);
  assert.equal(first.ok, false);
  assert.equal(first.routes.chat.ok, true);
  assert.equal(first.routes.situation.status, "authentication_failed");
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url => url.endsWith("/v1/parameters")));
  assert.doesNotMatch(JSON.stringify(first), /fictional-.*-key/);
});
