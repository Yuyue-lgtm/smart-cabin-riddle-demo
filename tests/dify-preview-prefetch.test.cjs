const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");

const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8")
  .replace(/\nboot\(\);\s*$/, "\n");

function client() {
  let timerId = 0;
  const timers = new Map();
  const storage = new Map();
  const schedule = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  const context = vm.createContext({
    structuredClone, console: { ...console, info() {}, warn() {} }, crypto: webcrypto, AbortController,
    setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
    cancelAnimationFrame() {},
    window: { setTimeout: schedule, clearTimeout: (id) => timers.delete(id) },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  });
  vm.runInContext(source, context);
  vm.runInContext("render = () => {};", context);
  return {
    run: (code) => vm.runInContext(code, context),
    value: (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
    context, timers,
  };
}

function holdRequests(app) {
  const requests = [];
  app.context.fetch = (_url, options) => new Promise((resolve) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.input_payload);
    requests.push({ body, input, signal: options.signal, resolve });
  });
  return requests;
}

function replyPreview(request, { failed = false } = {}) {
  const { input } = request;
  request.resolve({
    ok: !failed,
    json: async () => failed ? { message: "Preview unavailable" } : {
      route: "preview", game_id: input.game_id, round_id: input.round_id,
      scene_version: input.scene_version, event_type: input.event.type, event_id: input.event.id,
      workflow_output: JSON.stringify({ round_question_plan: {
        plan_id: input.round_id,
        steps: [
          { id: "category", fact_key: "category", variants: { default: "它是人造的吗？" } },
          { id: "location", fact_key: "location", depends_on: ["category"], variants: { default: "它常见于室内吗？" } },
        ],
      } }),
    },
  });
}

test("future preview snapshots identify the target puzzle and exclude active-round dialogue", () => {
  const app = client();
  app.run(`
    state.game.status = "playing";
    state.game.questionCount = 6;
    state.game.coveredFactKeys = ["old-fact"];
    state.game.history = [{input:{round_id:getDifyRoundScopeKey(),player_input:"旧题问题"},output:{ai_reply_text:"旧题回答"}}];
    const target = {
      gameId: state.workflow.gameId, roundId: state.workflow.gameId + "-round-2",
      roundIndex: 2, riddleIndex: 2, timelineId: ROUND_GOLDEN_TIMELINES[1].id,
      scenarioId: getActiveGoldenLine().id, relationship: state.passengers.relationship,
    };
    const preview = buildRoundPreviewInput(target);
  `);
  assert.equal(app.value("preview.round_id"), app.value("target.roundId"));
  assert.equal(app.value("preview.game.current_answer"), app.value("RIDDLES[2].answer"));
  assert.equal(app.value("preview.game.round_index"), 2);
  assert.equal(app.value("preview.game.question_count"), 0);
  assert.deepEqual(app.value("preview.game.asked_questions"), []);
  assert.deepEqual(app.value("preview.game.covered_fact_keys"), []);
  assert.deepEqual(app.value("preview.interaction.recent_messages"), []);
  assert.equal(app.value("preview.round_question_plan_request.generate_host_replies"), false);
  assert.equal(app.value("state.game.questionCount"), 6);
});
test("P0 invalidates host requests while retaining pending puzzle preparation", () => {
  const app = client();
  app.run(`
    const controller = new AbortController();
    roundQuestionPreparations.set("future-round", { status: "pending", controller });
    state.workflow.previewPending = true;
    invalidateAsyncHostResults();
  `);
  assert.equal(app.value("controller.signal.aborted"), false);
  assert.equal(app.value("roundQuestionPreparations.size"), 1);
  assert.equal(app.value("isHostBusy()"), false);
});

test("a paused preview result is cached until its matching round can use it", () => {
  const app = client();
  app.run(`
    const preparation = {
      gameId: state.workflow.gameId, roundId: getDifyRoundScopeKey(),
      riddleIndex: state.game.currentRiddleIndex, relationship: state.passengers.relationship,
      status: "ready", plan: {id:"plan-1",steps:[]},
    };
    roundQuestionPreparations.set(preparation.roundId, preparation);
    state.game.status = "paused";
    state.game.coveredFactKeys = ["already-covered"];
    state.game.usedRoundQuestionStepIds = ["already-used"];
  `);
  assert.equal(app.value("applyPreparedRoundPlan(preparation)"), false);
  assert.equal(app.value("state.game.roundQuestionPlan"), null);
  app.run('state.game.status = "playing"; state.timeline.status = "running";');
  assert.equal(app.value("applyPreparedRoundPlan(preparation)"), true);
  assert.equal(app.value("state.game.roundQuestionPlan.id"), "plan-1");
  assert.deepEqual(app.value("state.game.coveredFactKeys"), ["already-covered"]);
  assert.deepEqual(app.value("state.game.usedRoundQuestionStepIds"), ["already-used"]);
  app.run("state.game.roundIndex += 1;");
  assert.equal(app.value("applyPreparedRoundPlan(preparation)"), false);
});

test("ready page prefetches once, future replies stay isolated, and only chat starts thinking", async () => {
  const app = client();
  const requests = holdRequests(app);
  app.run("applyGoldenLineDefaults(); const first = ensureCurrentRoundPreparation(); prepareFollowingRound(first);");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].input.game.round_index, 1);
  assert.equal(requests[1].input.game.round_index, 2);
  assert.equal(app.value("state.game.status"), "idle");
  assert.equal(app.value("isHostBusy()"), false);
  assert.equal(app.value("state.workflow.hostThinkingTimer"), null);

  app.run("const second = [...roundQuestionPreparations.values()].find(entry => entry.roundIndex === 2);");
  replyPreview(requests[1]);
  await app.run("second.promise");
  assert.equal(app.value("state.game.roundQuestionPlan"), null);
  app.run('state.game.status = "playing";');
  replyPreview(requests[0]);
  await app.run("first.promise");
  assert.equal(app.value("state.game.roundQuestionPlan.id"), requests[0].input.round_id);

  app.run("state.game.roundIndex = 2; state.game.currentRiddleIndex = second.riddleIndex; state.game.roundQuestionPlan = null; ensureCurrentRoundPreparation(); applyPreparedRoundPlan(second); prepareFollowingRound(second);");
  assert.equal(requests.length, 3);
  assert.equal(requests[2].input.game.round_index, 3);
  assert.equal(app.value("state.game.roundQuestionPlan.id"), requests[1].input.round_id);
  assert.equal(app.value("state.workflow.hostThinkingActive"), false);
  app.run('beginWorkflowRequest(buildWorkflowInput("chat", null, "它常见吗？"));');
  assert.equal(app.value("isHostBusy()"), true);
  const thinkingTimer = app.timers.get(app.value("state.workflow.hostThinkingTimer"));
  assert.ok(thinkingTimer);
  assert.ok(thinkingTimer.delay >= 300);
  thinkingTimer.callback();
  assert.equal(app.value("state.workflow.hostThinkingActive"), true);
  app.run("abortActiveWorkflow(); cancelPreviewWorkflow();");
  replyPreview(requests[2]);
});

test("no simulation runs while preview is pending or failed; late valid plans skip asked questions", async () => {
  const app = client();
  const requests = holdRequests(app);
  app.run(`
    applyGoldenLineDefaults();
    const first = ensureCurrentRoundPreparation();
    state.game.status = "playing";
    const spoken = [];
    runScriptedQuestion = async (seat, text) => spoken.push({seat, text});
  `);
  await app.run("runRandomTimelinePassengerQuestion()");
  assert.deepEqual(app.value("spoken"), []);
  replyPreview(requests[0], { failed: true });
  await app.run("first.promise");
  await app.run("runRandomTimelinePassengerQuestion()");
  assert.deepEqual(app.value("spoken"), []);
  app.run(`
    first.status = "ready";
    first.plan = normalizeRoundQuestionPlan({steps:[
      {id:"q1",fact_key:"category",variants:{adult:"它是人造的吗？",child:"它是人做出来的吗？"}},
      {id:"q2",fact_key:"location",depends_on:["category"],variants:{default:"它常见于室内吗？"}}
    ]});
    state.game.history = [{input:{round_id:getDifyRoundScopeKey(),player_input:"它是人造的吗?"},output:{}}];
  `);
  await app.run("runRandomTimelinePassengerQuestion()");
  assert.equal(app.value("spoken.length"), 1);
  assert.equal(app.value("spoken[0].text"), "它常见于室内吗？");
});

test("changing the ready-page puzzle aborts its old preview and ignores its late response", async () => {
  const app = client();
  const requests = holdRequests(app);
  app.run("applyGoldenLineDefaults(); const old = ensureCurrentRoundPreparation(); setEnvironment('城区晴天白天'); const replacement = ensureCurrentRoundPreparation(); state.game.status = 'playing';");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.notEqual(requests[0].input.game.current_answer, requests[1].input.game.current_answer);
  replyPreview(requests[0]);
  await app.run("old.promise");
  assert.equal(app.value("state.game.roundQuestionPlan"), null);
  replyPreview(requests[1]);
  await app.run("replacement.promise");
  assert.equal(app.value("state.game.roundQuestionPlan.id"), requests[1].input.round_id);
});

test("summary reserves the next game's first puzzle and ready entry reuses its pending request", async () => {
  const app = client();
  const requests = holdRequests(app);
  app.run(`
    applyGoldenLineDefaults();
    const previousGame = state.workflow.gameId;
    savePersistentDifyConversationId("global-conversation");
    state.game.status = "summary";
    prepareNextGameFirstRound();
    const reserved = nextGamePreparation;
  `);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.notEqual(requests[1].input.game_id, app.value("previousGame"));
  assert.equal(requests[1].input.game.round_index, 1);
  assert.equal(requests[1].input.game.status, "playing");
  app.run("resetCurrentGoldenLine();");
  assert.equal(app.value("state.workflow.gameId"), requests[1].input.game_id);
  assert.equal(app.value("state.game.roundIndex"), 1);
  assert.equal(app.value("getPersistentDifyConversationId()"), "global-conversation");
  assert.equal(requests.length, 2);
  replyPreview(requests[1]);
  await app.run("reserved.promise");
  assert.equal(app.value("state.game.roundQuestionPlan"), null);
  app.run('state.game.status = "playing"; applyPreparedRoundPlan(reserved); prepareFollowingRound(reserved);');
  assert.equal(app.value("state.game.roundQuestionPlan.id"), requests[1].input.round_id);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].input.game.round_index, 2);
  app.run("cancelPreviewWorkflow();");
  replyPreview(requests[0]);
  replyPreview(requests[2]);
});

function replyPartial(request, { status = "partial", steps, repairable = true } = {}) {
  const prefix = steps || [{ id: "q1", fact_key: "category", variants: { default: "它常见吗？" } }];
  request.resolve({ ok: true, json: async () => ({
    route: "preview", game_id: request.input.game_id, round_id: request.input.round_id,
    scene_version: request.input.scene_version, event_id: request.input.event.id, event_type: "start_game",
    workflow_output: JSON.stringify({
      preview_status: status,
      preview_diagnostic: { status, repairable },
      round_question_plan: { plan_id: request.input.round_id, steps: prefix },
      ...(repairable ? { preview_repair: { attempt: 1, accepted_steps: prefix, validation_errors: ["invalid_step_2"] } } : {}),
    }),
  }) });
}

test("safe prefix is usable during repair and a failed repair never discards used facts", async () => {
  const app = client();
  const requests = holdRequests(app);
  app.run('applyGoldenLineDefaults(); const first = ensureCurrentRoundPreparation(); state.game.status = "playing";');
  replyPartial(requests[0]);
  for (let i = 0; i < 10 && requests.length < 2; i += 1) await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.equal(app.value("first.status"), "partial");
  assert.equal(app.value("first.repairPending"), true);
  assert.equal(app.value("state.game.roundQuestionPlan.steps.length"), 1);
  assert.equal(app.value("isHostBusy()"), false);
  assert.equal(requests[1].input.round_question_plan_request.repair.attempt, 1);
  app.run('state.game.coveredFactKeys = ["category"]; state.game.usedRoundQuestionStepIds = ["q1"]; invalidateAsyncHostResults();');
  assert.equal(requests[1].signal.aborted, false);
  replyPartial(requests[1], { status: "failed", steps: [] });
  await app.run("first.promise");
  assert.equal(requests.length, 2);
  assert.equal(app.value("first.status"), "partial");
  assert.equal(app.value("first.repairPending"), false);
  assert.deepEqual(app.value("state.game.coveredFactKeys"), ["category"]);
  assert.deepEqual(app.value("state.game.usedRoundQuestionStepIds"), ["q1"]);
  assert.equal(app.value("state.game.roundQuestionPlan.steps.length"), 1);
});

test("reset aborts repair and ignores its late result", async () => {
  const app = client();
  const requests = holdRequests(app);
  app.run('applyGoldenLineDefaults(); const first = ensureCurrentRoundPreparation(); state.game.status = "playing";');
  replyPartial(requests[0]);
  for (let i = 0; i < 10 && requests.length < 2; i += 1) await Promise.resolve();
  app.run('cancelPreviewWorkflow(); state.game.roundQuestionPlan = null;');
  assert.equal(requests[1].signal.aborted, true);
  replyPartial(requests[1]);
  await app.run("first.promise");
  assert.equal(app.value("state.game.roundQuestionPlan"), null);
  assert.equal(requests.length, 2);
});

test("passenger display respects the current 1500ms minimum without delaying slow replies", () => {
  const app = client();
  app.run("Date.now = () => 10000; state.workflow.lastBubbleShownAt = 10000;");
  assert.equal(app.value('getBubbleOutputDelayMs({trigger_type:"chat"})'), 1500);
  app.run("Date.now = () => 10500;");
  assert.equal(app.value('getBubbleOutputDelayMs({trigger_type:"chat"})'), 1000);
  app.run("Date.now = () => 11501;");
  assert.equal(app.value('getBubbleOutputDelayMs({trigger_type:"chat"})'), 0);
  assert.equal(app.value('getBubbleOutputDelayMs({trigger_type:"event"})'), 0);
});
