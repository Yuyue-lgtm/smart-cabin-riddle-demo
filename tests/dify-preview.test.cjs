const assert = require("node:assert/strict");
const test = require("node:test");
const { handleWorkflowBody, DEFAULT_PREVIEW_APP_ID } = require("../api/dify-bff");

test("start_game uses the preview Workflow and strips prepared host replies", async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.DIFY_PREVIEW_API_KEY;
  const originalMap = process.env.DIFY_WORKFLOW_API_KEYS;
  let calls = 0;
  try {
    process.env.DIFY_PREVIEW_API_KEY = "preview-test-key";
    delete process.env.DIFY_WORKFLOW_API_KEYS;
    global.fetch = async (url, options) => {
      calls += 1;
      assert.equal(url, "https://api.dify.ai/v1/workflows/run");
      assert.equal(options.headers.Authorization, "Bearer preview-test-key");
      const request = JSON.parse(options.body);
      assert.equal(request.user, "stable-user");
      const input = JSON.parse(request.inputs.input_payload);
      assert.equal(input.game_id, "game-1");
      assert.equal(input.round_question_plan_request.generate_host_replies, false);
      return {
        ok: true,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({
          data: { outputs: { workflow_output: JSON.stringify({
            ai_reply_text: "should not be shown",
            round_question_plan: {
              plan_id: "plan-1",
              steps: [
                { id: "q1", fact_key: "category", variants: { default: "它常见吗？" }, host_reply_text: "是。" },
                { id: "q2", fact_key: "location", variants: { default: "会在室外用吗？" }, host_reply_text: "会。" },
              ],
            },
          }) } },
        }),
      };
    };

    const response = await handleWorkflowBody({
      route: "preview",
      user_id: "stable-user",
      input_payload: JSON.stringify({
        trigger_type: "event",
        game_id: "game-1",
        round_id: "round-1",
        scene_version: "scene-1",
        game: { round_index: 1 },
        event: { id: "event-1", type: "start_game" },
        round_question_plan_request: { generate_host_replies: false },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.route, "preview");
    assert.equal(response.payload.app_id, DEFAULT_PREVIEW_APP_ID);
    assert.equal(response.payload.event_id, "event-1");
    const output = JSON.parse(response.payload.workflow_output);
    assert.equal(output.ai_reply_text, undefined);
    assert.equal(output.round_question_plan.steps.length, 2);
    assert.equal(output.round_question_plan.steps[0].host_reply_text, undefined);
    assert.equal(calls, 1);

    const unsupported = await handleWorkflowBody({
      route: "situation",
      input_payload: { trigger_type: "event", event: { id: "event-2", type: "start_game" } },
    });
    assert.equal(unsupported.payload.route, "skipped");
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DIFY_PREVIEW_API_KEY;
    else process.env.DIFY_PREVIEW_API_KEY = originalKey;
    if (originalMap === undefined) delete process.env.DIFY_WORKFLOW_API_KEYS;
    else process.env.DIFY_WORKFLOW_API_KEYS = originalMap;
  }
});

test("preview diagnostics preserve partial plans and permit only one immutable-prefix repair", async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.DIFY_PREVIEW_API_KEY;
  const oldMap = process.env.DIFY_WORKFLOW_API_KEYS;
  const prefix = { id: "q1", order: 1, fact_key: "category", depends_on: [], stage: "category", expected_answer: "yes", variants: { default: "它常见吗？" }, host_reply_text: "是的。" };
  const suffix = { id: "q2", order: 2, fact_key: "location", depends_on: ["category"], stage: "location", expected_answer: "yes", variants: { default: "它常见于室内吗？" }, host_reply_text: "是的。" };
  const input = { trigger_type: "event", game_id: "g1", round_id: "r1", scene_version: "s1", event: { id: "e1", type: "start_game" }, round_question_plan_request: { step_count: 2 } };
  let calls = 0;
  let upstream = {};
  const call = async (repair) => handleWorkflowBody({ route: "preview", user_id: "preview-user", input_payload: { ...input, round_question_plan_request: { step_count: 2, ...(repair ? { repair } : {}) } } });
  const output = (response) => JSON.parse(response.payload.workflow_output);
  try {
    process.env.DIFY_PREVIEW_API_KEY = "test-only";
    delete process.env.DIFY_WORKFLOW_API_KEYS;
    global.fetch = async () => {
      calls += 1;
      return { ok: true, text: async () => JSON.stringify(upstream) };
    };
    const setPlan = (steps, errors = []) => { upstream = { workflow_run_id: "run-test", data: { status: "succeeded", outputs: { workflow_output: JSON.stringify({ round_question_plan: { plan_id: "p1", steps }, debug: { validation_errors: errors } }) } } }; };
    setPlan([prefix], ["early_question_clue_leak_2"]);
    const partial = await call();
    assert.equal(partial.payload.preview_status, "partial");
    assert.equal(output(partial).round_question_plan.steps.length, 1);
    assert.equal(output(partial).round_question_plan.steps[0].host_reply_text, undefined);
    const repair = output(partial).preview_repair;
    assert.equal(repair.accepted_steps[0].host_reply_text, "是的。");
    assert.equal(partial.payload.workflow_run_id, "run-test");
    setPlan([prefix, suffix]);
    const repaired = await call(repair);
    assert.equal(repaired.payload.preview_status, "ready");
    assert.equal(output(repaired).preview_repair, undefined);
    assert.equal(output(repaired).round_question_plan.plan_id, "p1");

    setPlan([{ ...prefix, variants: { default: "这是改写过的问题吗？" } }, suffix]);
    const mutated = await call(repair);
    assert.equal(mutated.payload.preview_status, "partial");
    assert.ok(mutated.payload.preview_diagnostic.validation_errors.includes("accepted_prefix_changed"));
    assert.equal(mutated.payload.preview_diagnostic.repairable, false);
    assert.equal(output(mutated).round_question_plan.steps.length, 1);
    assert.equal(output(mutated).round_question_plan.steps[0].fact_key, "category");

    const count = calls;
    assert.equal((await call({ ...repair, attempt: 2 })).status, 400);
    assert.equal((await call({ ...repair, plan_id: "" })).status, 400);
    assert.equal(calls, count);
    setPlan([], ["early_question_clue_leak_1"]);
    const rejected = await call();
    assert.equal(rejected.status, 200);
    assert.equal(rejected.payload.preview_status, "failed");
    assert.equal(output(rejected).preview_repair.accepted_steps.length, 0);
    assert.ok(rejected.payload.preview_diagnostic.validation_errors.includes("early_question_clue_leak_1"));

    upstream.data.status = "failed";
    upstream.data.error = "model timeout";
    const failedRepair = await call(repair);
    assert.equal(failedRepair.payload.preview_status, "partial");
    assert.equal(output(failedRepair).round_question_plan.steps.length, 1);
    assert.equal(failedRepair.payload.preview_diagnostic.repairable, false);
    const failed = await call();
    assert.equal(failed.payload.preview_diagnostic.upstream_error, "model timeout");
    assert.equal(failed.payload.preview_diagnostic.repairable, false);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.DIFY_PREVIEW_API_KEY;
    else process.env.DIFY_PREVIEW_API_KEY = oldKey;
    if (oldMap === undefined) delete process.env.DIFY_WORKFLOW_API_KEYS;
    else process.env.DIFY_WORKFLOW_API_KEYS = oldMap;
  }
});
