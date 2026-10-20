const test = require("node:test");
const assert = require("node:assert/strict");
const { handleWorkflowBody } = require("../api/dify-bff");

test('Chatflow transport failures preserve the underlying network code without breaking the error handler', async () => {
  const originalFetch = global.fetch;
  const saved = { DIFY_CHATFLOW_API_KEY: process.env.DIFY_CHATFLOW_API_KEY, DIFY_API_BASE_URL: process.env.DIFY_API_BASE_URL };
  try {
    process.env.DIFY_CHATFLOW_API_KEY = 'private-test-key';
    process.env.DIFY_API_BASE_URL = 'http://127.0.0.1:8081';
    global.fetch = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }); };
    const result = await handleWorkflowBody({ route: 'chat', user_id: 'transport-test', input_payload: {
      trigger_type: 'chat', player_input: 'fictional question', game: { status: 'playing', current_answer: 'fictional answer' },
    } });
    assert.equal(result.status, 502);
    assert.equal(result.payload.error, 'DIFY_CHATFLOW_PROXY_ERROR');
    assert.equal(result.payload.proxy_failure.cause_code, 'ECONNREFUSED');
    assert.equal(result.payload.proxy_failure.api_origin, 'http://127.0.0.1:8081');
    assert.doesNotMatch(JSON.stringify(result.payload.proxy_failure), /private-test-key|fictional/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("self-hosted Dify accepts origin or /v1 URL for all three routes and preserves chat streaming/session", async () => {
  const names = ["DIFY_API_BASE_URL", "DIFY_CHATFLOW_API_KEY", "DIFY_SITUATION_API_KEY", "DIFY_PREVIEW_API_KEY"];
  const saved = Object.fromEntries(names.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  try {
    process.env.DIFY_CHATFLOW_API_KEY = "test-chat";
    process.env.DIFY_SITUATION_API_KEY = "test-situation";
    process.env.DIFY_PREVIEW_API_KEY = "test-preview";
    for (const base of ["http://127.0.0.1:8080", "http://127.0.0.1:8080/v1", "http://127.0.0.1:8080/v1/"]) {
      process.env.DIFY_API_BASE_URL = base;
      const requests = [];
      global.fetch = async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
        return { ok: false, status: 418, headers: { get: () => "application/json" },
          text: async () => "{}", json: async () => ({}) };
      };
      const common = { game_id: "game-test", round_id: "round-test", scene_version: "scene-test",
        game: { status: "playing", current_answer: "海豚" } };
      await handleWorkflowBody({ route: "chat", user_id: "stable-user", conversation_id: "stable-conversation",
        input_payload: { ...common, trigger_type: "chat", player_input: "它是动物吗？" } });
      await handleWorkflowBody({ route: "situation", user_id: "stable-user",
        input_payload: { ...common, trigger_type: "event", event: { id: "env-test", type: "environment_change" } } });
      await handleWorkflowBody({ route: "preview", user_id: "stable-user",
        input_payload: { ...common, trigger_type: "event", event: { id: "preview-test", type: "start_game" } } });
      assert.deepEqual(requests.map(x => x.url), ["http://127.0.0.1:8080/v1/chat-messages",
        "http://127.0.0.1:8080/v1/workflows/run", "http://127.0.0.1:8080/v1/workflows/run"]);
      assert.equal(requests[0].body.response_mode, "streaming");
      assert.equal(requests[0].body.conversation_id, "stable-conversation");
      assert.equal(requests[0].body.user, "stable-user");
      assert.equal(requests[0].body.query, "它是动物吗？");
      assert.deepEqual(requests.map(x => x.headers.Authorization), ["Bearer test-chat", "Bearer test-situation", "Bearer test-preview"]);
    }
  } finally {
    global.fetch = originalFetch;
    for (const key of names) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("migrated host SSE preserves structured node output while Answer remains natural text", async () => {
  const originalFetch = global.fetch;
  const oldKey = process.env.DIFY_CHATFLOW_API_KEY;
  process.env.DIFY_CHATFLOW_API_KEY = "fixture-only-key";
  const scope = { game_id: "migration-contract-game", round_id: "migration-contract-round", scene_version: "migration-contract-scene" };
  const hostResult = { context_scope: scope, intent: "question", ai_reply_text: "是的，它是人造的。",
    covered_fact_keys: ["human_made"], execution_actions: [],
    decision_trace: { guard_status: "passed", priority: "P2" } };
  try {
    global.fetch = async () => ({ ok: true, headers: { get: () => "text/event-stream" },
      text: async () => [
        { event: "workflow_started", data: { id: "migration-run" } },
        { event: "node_finished", data: { node_id: "1000000000020", outputs: {
          reply_text: hostResult.ai_reply_text, host_result: JSON.stringify(hostResult),
        } } },
        { event: "message", conversation_id: "migration-conversation", message_id: "migration-message", answer: "是的，" },
        { event: "message", conversation_id: "migration-conversation", message_id: "migration-message", answer: "它是人造的。" },
        { event: "message_end", conversation_id: "migration-conversation", message_id: "migration-message" },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("") });
    const response = await handleWorkflowBody({ route: "chat", user_id: "migration-contract-user", input_payload: {
      ...scope, trigger_type: "chat", player_input: "它是人造的吗？", game: { status: "playing", current_answer: "安全带" },
    } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload.host_result, hostResult);
    assert.deepEqual(JSON.parse(response.payload.workflow_output), hostResult);
    assert.equal(response.payload.answer, hostResult.ai_reply_text);
    assert.equal(response.payload.context_verified, true);
    assert.equal(response.payload.conversation_id, "migration-conversation");
    assert.equal(response.payload.workflow_run_id, "migration-run");
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.DIFY_CHATFLOW_API_KEY;
    else process.env.DIFY_CHATFLOW_API_KEY = oldKey;
  }
});
