const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");
const { handleWorkflowBody } = require("../api/dify-bff");

const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8")
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, "\n");

function client() {
  let now = 100000;
  let timerId = 0;
  const timers = new Map();
  const schedule = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    structuredClone, console, crypto: webcrypto, AbortController,
    setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
    window: { setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
      setInterval: schedule, clearInterval: (id) => timers.delete(id) },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    render = () => {};
    state.game.status = "playing";
    state.timeline.status = "running";
    state.host.text = "";
    startQuestionClock();
  `, context);
  return {
    context, timers,
    advance(ms) { now += ms; },
    run: (code) => vm.runInContext(code, context),
    value: (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
  };
}

function holdSituation(app, { proactive = true } = {}) {
  let resolve;
  let input;
  app.context.captureSituation = (value) => {
    if (value.dialogue_request?.kind === "situation_event") return Promise.resolve({
      ai_reply_text:"副驾有什么想法？也来问一问吧。",intent:"event",decision_trace:{guard_status:"passed"},
      _bff:{route:"chat",operation:"situation_reply",event_id:value.event.id,
        game_id:value.game_id,round_id:value.round_id,scene_version:value.scene_version},
    });
    input = value;
    return new Promise((done) => { resolve = done; });
  };
  app.run(`
    requestWorkflow = captureSituation;
    normalizeDecisionTrace = () => ({});
    updateDecisionTrace = () => null;
  `);
  return () => {
    const scene = { analysis_status: "ready", request_proactive_speech: proactive,
      game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
      event_id: input.event.id, participation_version: input.participation.version,
      expires_at_ms: app.run("Date.now() + 10000") };
    resolve({ ai_reply_text: "副驾有什么想法？也来问一问吧。", scene_output: scene,
      _bff: { route: "situation", event_id: scene.event_id, game_id: scene.game_id,
        round_id: scene.round_id, scene_version: scene.scene_version, situation_handoff:"test-handoff" } });
  };
}

test("participation invitations use observed silence once per round, with no fixed timeline cue", () => {
  const app = client();
  app.run("const events = []; dispatchSituationWorkflow = async (event) => events.push(event);");
  assert.equal(app.value("ROUND_GOLDEN_TIMELINES.some(t => t.steps.some(s => ['cue_real_user','passenger_inactive'].includes(s.type)))"), false);
  app.advance(19999);
  app.run("maybeAnalyzeRealUserParticipation()");
  assert.equal(app.value("events.length"), 0);
  app.advance(1);
  app.run("maybeAnalyzeRealUserParticipation(); maybeAnalyzeRealUserParticipation();");
  assert.equal(app.value("events.length"), 1);
  assert.equal(app.value("events[0].type"), "passenger_inactive");
  assert.equal(app.value("events[0].priority"), "P4");
  assert.equal(app.value("state.host.text"), "");
  app.run("startQuestionClock()");
  app.advance(20000);
  app.run("maybeAnalyzeRealUserParticipation()");
  assert.equal(app.value("events.length"), 2);
});

test("situation-to-Chatflow payload preserves the active participation version", () => {
  const app = client();
  const invite = app.value(`buildRealtimeChatInput(buildFullWorkflowInput("event", {
    id: "inactive-payload", type: "passenger_inactive", source: "participation_monitor",
    seat: "front", priority: "P4"
  }, ""))`);
  assert.equal(invite.event.type, "passenger_inactive");
  assert.equal(invite.participation.seat, "front");
  assert.equal(invite.participation.version, app.value("state.workflow.participation.revision"));
  assert.equal(typeof invite.participation.inactive_duration_ms, "number");
  assert.equal(typeof invite.participation.dialogue_silence_ms, "number");
  assert.equal(Object.hasOwn(app.value(`buildRealtimeChatInput(buildFullWorkflowInput("event", {
    id: "environment-payload", type: "environment_change", priority: "P1"
  }, ""))`), "participation"), false);
});

test("recent real input, ongoing replies, sleeping, declined invitations and final seconds suppress invitations", () => {
  const app = client();
  app.advance(19000);
  app.run('recordParticipationActivity("front", "它常见吗？")');
  app.advance(1000);
  assert.equal(app.value("canOfferParticipationInvitation()"), false);
  app.advance(19000);
  assert.equal(app.value("canOfferParticipationInvitation()"), true);

  for (const setup of [
    'state.host.text = "正在回答"',
    'state.workflow.inFlight = true',
    'state.workflow.situationInFlight = true',
    'state.passengers.seats.front.mood = "睡着"',
    'state.game.status = "paused"',
    'state.timeline.status = "paused"',
  ]) {
    app.run(setup);
    assert.equal(app.value("canOfferParticipationInvitation()"), false, setup);
    app.run('state.host.text = ""; state.workflow.inFlight = false; state.workflow.situationInFlight = false; state.passengers.seats.front.mood = "普通"; state.game.status = "playing"; state.timeline.status = "running";');
  }
  app.run("publishHostLine('回答刚刚显示');");
  assert.equal(app.value("canOfferParticipationInvitation()"), false);
  app.advance(6000);
  const timer = app.value("state.workflow.hostSpeech.timer");
  app.timers.get(timer).callback();
  assert.equal(app.value("canOfferParticipationInvitation()"), false);
  app.advance(2500);
  assert.equal(app.value("canOfferParticipationInvitation()"), true);

  app.run('recordParticipationActivity("front", "让我自己想想")');
  app.advance(20000);
  assert.equal(app.value("canOfferParticipationInvitation()"), false);
  app.run("state.workflow.participation.invitationDeclined = false;");
  app.advance(20000);
  assert.equal(app.value("canOfferParticipationInvitation()"), false);
});

test("Workflow decides whether to speak; late invitations cannot replace a new question or new round", async () => {
  for (const change of ["", 'recordParticipationActivity("front", "新问题")', 'recordParticipationActivity("rearLeft", "模拟乘客新问题")', "state.game.roundIndex += 1"]) {
    const app = client();
    app.advance(20000);
    const reply = holdSituation(app);
    const pending = app.run('dispatchSituationWorkflow({id:"invite-1",type:"passenger_inactive",seat:"front",priority:"P4",source:"participation_monitor"})');
    if (change) app.run(change);
    reply();
    await pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.value("state.host.text"), change ? "" : "副驾有什么想法？也来问一问吧。", change);
  }
  const app = client();
  app.advance(20000);
  const reply = holdSituation(app, { proactive: false });
  const pending = app.run('dispatchSituationWorkflow({id:"silent-1",type:"passenger_inactive",seat:"front",priority:"P4",source:"participation_monitor"})');
  reply();
  await pending;
  assert.equal(app.value("state.host.text"), "");
});

test("inactive passenger events route exclusively to the Situation Workflow", async (t) => {
  const key = process.env.DIFY_SITUATION_API_KEY;
  process.env.DIFY_SITUATION_API_KEY = "test-situation-key";
  t.after(() => {
    if (key === undefined) delete process.env.DIFY_SITUATION_API_KEY;
    else process.env.DIFY_SITUATION_API_KEY = key;
  });
  const urls = [];
  t.mock.method(global, "fetch", async (url) => {
    urls.push(url);
    return { ok: true, text: async () => JSON.stringify({ workflow_run_id: "situation-run-1", data: { outputs: {
      scene_output: JSON.stringify({ analysis_status: "skipped", request_proactive_speech: false }),
    } } }) };
  });
  const response = await handleWorkflowBody({ route: "situation", input_payload: {
    trigger_type: "event", event: { id: "inactive-1", type: "passenger_inactive" },
  } });
  assert.equal(response.status, 200);
  assert.equal(response.payload.route, "situation");
  assert.equal(response.payload.workflow_run_id, "situation-run-1");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/v1\/workflows\/run$/);
});
