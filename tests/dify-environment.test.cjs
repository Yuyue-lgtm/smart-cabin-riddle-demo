const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");
const { handleWorkflowBody } = require("../api/dify-bff");
const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8").replace(/\nboot\(\);\s*$/, "\n");

function client() {
  let now = 100000, id = 0;
  const timers = new Map();
  const schedule = (callback, delay) => { timers.set(++id, { callback, delay }); return id; };
  const context = vm.createContext({ Date: class extends Date { static now() { return now; } },
    structuredClone, console, crypto: webcrypto, AbortController, cancelAnimationFrame() {},
    setTimeout: schedule, clearTimeout: (id) => timers.delete(id),
    window: { setTimeout: schedule, clearTimeout: (id) => timers.delete(id), setInterval: schedule, clearInterval() {} },
    localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(source, context);
  vm.runInContext('render = () => {}; state.game.status = "playing"; state.timeline.status = "running"; state.host.text = "";', context);
  return { context, run: (code) => vm.runInContext(code, context),
    value: (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
    advance(ms) { now += ms; }, fire(code) { const timer = timers.get(vm.runInContext(code, context)); assert.ok(timer, code); timer.callback(); } };
}

test("environment speech waits for the current bubble to finish, then passenger answers follow", () => {
  const app = client();
  app.run('publishHostLine("上一条回答", {source:"chat"}); state.workflow.hostSpeech.visibleAt = Date.now();');
  app.advance(500);
  app.run('publishHostLine("我们驶上高速啦。", {priority:"P1",source:"environment"});');
  assert.equal(app.value("state.host.text"), "上一条回答");
  app.advance(1020);
  app.fire("state.workflow.deferredHostRepliesTimer");
  assert.equal(app.value("state.host.text"), "上一条回答");
  app.advance(4480);
  app.fire("state.workflow.hostSpeech.timer");
  assert.equal(app.value("state.host.text"), "我们驶上高速啦。");
  assert.equal(app.value("state.workflow.pendingEnvironmentSpeech"), null);
  app.run('state.workflow.hostSpeech.visibleAt = Date.now(); publishHostLine("新问题的回答", {source:"passenger_question"}); state.workflow.hostAwaitingReply = true;');
  assert.equal(app.value("state.workflow.deferredHostReplies.length"), 1);
  app.advance(2000);
  assert.equal(app.value("getHostPresentation().hostBubbleHidden"), false);
  app.run("state.workflow.hostAwaitingReply = false;");
  app.advance(1000);
  app.fire("state.workflow.hostSpeech.timer");
  assert.equal(app.value("state.host.text"), "新问题的回答");
});

test("P0 keeps precedence and invalidates queued environment and passenger speech", () => {
  const app = client();
  app.run('publishHostLine("安全暂停", {priority:"P0",source:"hard_brake"}); state.workflow.hostSpeech.visibleAt = Date.now();');
  app.advance(2000);
  app.run('publishHostLine("进入隧道啦。", {priority:"P1",source:"environment"});');
  assert.equal(app.value("state.host.text"), "安全暂停");
  app.run('deferHostReply("旧回答", {source:"chat"}); invalidateAsyncHostResults();');
  assert.equal(app.value("state.workflow.deferredHostReplies.length"), 0);
  assert.equal(app.value("state.workflow.pendingEnvironmentSpeech"), null);
});

test("victory-period chat is queued safely and holds the next-round handoff", () => {
  const app = client();
  app.run('state.game.status = "victory"; state.ui.showAnswer = true; state.game.roundIndex = 7;');
  app.run('publishHostLine("答案揭晓", {priority:"P0",source:"victory",durationMs:6000});');
  app.run('scheduleHostThinkingForRequest(1, {trigger_type:"chat",game:{status:"victory"}});');
  assert.equal(app.value("state.workflow.hostThinkingTimer"), null);
  assert.equal(app.value('getDefaultHostReply({}, {trigger_type:"chat",game:{status:"victory"}})'), "");
  app.run(`const gameId = state.workflow.gameId;
    const roundId = getDifyRoundScopeKey();
    const sceneVersion = getSceneVersion();
    const input = {game_id:gameId,round_id:roundId,p0_epoch:state.workflow.p0Epoch,
      scene_version:sceneVersion,trigger_type:"chat",player_input:"可以夸一下我吗？",
      game:{status:"victory"},passengers:{selected_seat:"front",selected_seat_label:"副驾"},
      interaction:{current_speaker:"front"},event:null};
    const output = {ai_reply_text:"你刚才答得很漂亮！",game_status:"playing",ui_change:{},
      _bff:{route:"chat",game_id:gameId,round_id:roundId,scene_version:sceneVersion}};
    state.car.environment = "隧道";
    applyWorkflowOutput(output,input,"chat");`);
  assert.equal(app.value("state.game.status"), "victory");
  assert.equal(app.value("state.ui.showAnswer"), true);
  assert.equal(app.value("state.host.text"), "答案揭晓");
  assert.equal(app.value("state.workflow.deferredHostReplies.length"), 1);

  app.run("advanceAfterVictory(7);");
  assert.equal(app.value("state.game.roundIndex"), 7);
  app.advance(6000);
  app.fire("state.workflow.hostSpeech.timer");
  assert.equal(app.value("state.host.text"), "你刚才答得很漂亮！");
  app.run("advanceAfterVictory(7);");
  assert.equal(app.value("state.game.roundIndex"), 7);
});

test("round handoff diagnostics identify frontend wait gates without recording bubble text", () => {
  const app = client();
  let payload;
  app.context.fetch = async (url, options) => {
    assert.equal(url, "/api/client-diagnostic");
    payload = JSON.parse(options.body);
    return { ok: true };
  };
  app.run(`state.health.runtime = "local";
    state.game.status = "victory"; state.game.roundIndex = 1; state.timeline.status = "running";
    state.workflow.inFlight = true;
    state.workflow.pendingChats = [{text:"private passenger question"}];
    state.workflow.deferredHostReplies = [{roundId:getDifyRoundScopeKey(),text:"private reply",
      options:{source:"environment",priority:"P1"}}];
    state.workflow.hostSpeech.source = "victory";
    state.workflow.hostSpeech.expiresAt = simulationRuntime.now() + 2000;
    state.workflow.resultFeedback = {shown:false,output:null,expiresAt:simulationRuntime.now()+5000};
    advanceAfterVictory(1);`);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.blockers)), [
    "workflow_in_flight", "result_feedback_not_shown",
  ]);
  assert.equal(payload.host_speech_source, "victory");
  assert.deepEqual(JSON.parse(JSON.stringify(payload.deferred_reply_sources)), ["environment"]);
  assert.doesNotMatch(JSON.stringify(payload), /private passenger question|private reply/);
});

test("environment analysis hands off to Chatflow before any environment speech", async () => {
  const app = client();
  const requests = [];
  app.context.capture = (input) => new Promise((resolve) => requests.push({ input, resolve }));
  app.run('requestWorkflow = capture;');
  app.run('state.car.environment = "高速路晴天白天";');
  const environment = app.run('dispatchSituationWorkflow({id:"env",type:"environment_change",value:state.car.environment,previous_value:"车库",priority:"P1"})');
  const ambient = app.run('dispatchSituationWorkflow({id:"ambient",type:"cabin_laughing",priority:"P4"})');
  assert.equal(app.value("state.host.text"), "");
  const speechId = app.value("state.workflow.hostSpeech.id");
  function reply(request, text) {
    const input = request.input;
    const scene = { ...input, event_id: input.event.id, analysis_status: "ready", request_proactive_speech: Boolean(text), expires_at_ms: app.run("Date.now() + 60000") };
    request.resolve({ ai_reply_text: text, scene_output: scene, _bff: { route:"situation",event_id:scene.event_id,
      game_id:scene.game_id,round_id:scene.round_id,scene_version:scene.scene_version, situation_handoff:"test-handoff" } });
  }
  reply(requests[0], "迟到的模型话术不应播出");
  await environment;
  assert.equal(app.value("state.host.text"), "");
  assert.equal(app.value("state.workflow.hostSpeech.id"), speechId);
  assert.equal(app.value("state.decisionTrace.source"), "response");
  assert.match(app.value("state.decisionTrace.execution"), /Chatflow/);
  assert.equal(requests[2].input.dialogue_request.kind, "situation_event");
  assert.equal(app.value("state.workflow.situationInFlight"), true);
  reply(requests[1], "");
  await ambient;
  assert.equal(app.value("state.workflow.situationInFlight"), false);
  const input = requests[2].input;
  requests[2].resolve({ai_reply_text:"我们驶上高速啦。",intent:"event",decision_trace:{guard_status:"passed"},
    _bff:{route:"chat",operation:"situation_reply",event_id:input.event.id,
      game_id:input.game_id,round_id:input.round_id,scene_version:input.scene_version}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.value("state.host.text"), "我们驶上高速啦。");
});

test("consecutive environment changes discard obsolete results", async () => {
  const app = client();
  const requests = [];
  app.context.capture = (input) => new Promise((resolve) => requests.push({ input, resolve }));
  app.run('requestWorkflow = capture;');
  app.run('state.car.environment = "高速路晴天白天";');
  const first = app.run('dispatchSituationWorkflow({id:"env-old",type:"environment_change",value:state.car.environment,previous_value:"车库",priority:"P1"})');
  app.run('state.car.environment = "隧道"; state.workflow.hostSpeech.visibleAt = Date.now();');
  const next = app.run('dispatchSituationWorkflow({id:"env-new",type:"environment_change",value:state.car.environment,previous_value:"高速路晴天白天",priority:"P1"})');
  requests[0].resolve({ai_reply_text:"旧环境"});
  await first;
  assert.equal(app.value("state.host.text"), "");
  requests[1].resolve(null);
  await next;
  assert.equal(app.value("state.host.text"), "");
  assert.equal(requests.length, 2);
});

test("environment failures stay silent without a local or generic replacement", async () => {
  const app = client();
  app.run('state.car.environment = "隧道"; requestWorkflow = async () => { throw new Error("offline"); };');
  await app.run('dispatchWorkflow("event", {type:"environment_change",value:"隧道",previous_value:"车库"})');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.value("state.host.text"), "");
  const speechId = app.value("state.workflow.hostSpeech.id");
  await app.run('dispatchWorkflow("event", {type:"environment_change",value:"隧道",previous_value:"隧道"})');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.value("state.workflow.hostSpeech.id"), speechId);
});

test("P0 takes over immediately, recovers locally at 4.5s, and ignores background UI plans", async () => {
  const app = client();
  const requests = [];
  app.context.capture = input => new Promise(resolve => requests.push({input,resolve}));
  app.run('requestWorkflow = capture; publishHostLine("刚显示的回答", {source:"chat"}); state.workflow.hostSpeech.visibleAt = Date.now();');
  await app.run('dispatchWorkflow("event", {type:"hard_brake"})');
  assert.equal(app.value("state.host.text"), "大家坐稳，游戏先暂停。");
  assert.equal(app.value("state.game.status"), "paused");
  assert.equal(requests[0].input.event.priority, "P0");
  assert.equal(requests[0].input.trigger_type, "event");
  const input = requests[0].input;
  const scene = { game_id:input.game_id,round_id:input.round_id,scene_version:input.scene_version,
    event_id:input.event.id,expires_at_ms:app.run("Date.now() + 60000"),analysis_status:"ready",request_proactive_speech:true };
  requests[0].resolve({ai_reply_text:"模型不要接管",game_status:"victory",ui_change:{show_answer:true},
    scene_output:scene,_bff:{route:"situation",...scene}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.value("state.host.text"), "大家坐稳，游戏先暂停。");
  assert.equal(app.value("state.game.status"), "paused");
  assert.equal(app.value("state.ui.showAnswer"), false);
  assert.equal(app.value("state.decisionTrace.source"), "local");
  app.advance(4500);
  app.fire("state.workflow.recoveryTimer");
  assert.equal(app.value("state.game.status"), "playing");
  assert.equal(app.value("state.workflow.hostSpeech.source"), "safety_recovery");
});

test("BFF reports background analysis failures without fabricating environment speech", async (t) => {
  const previous = process.env.DIFY_SITUATION_API_KEY;
  process.env.DIFY_SITUATION_API_KEY = "test-key";
  t.after(() => previous === undefined ? delete process.env.DIFY_SITUATION_API_KEY : process.env.DIFY_SITUATION_API_KEY = previous);
  const input = { game_id:"env-game", round_id:"env-round", scene_version:"env-scene", trigger_type:"event",
    game:{status:"playing",current_answer:"安全带"}, car:{environment:"高速路晴天白天"},
    event:{id:"env-1",type:"environment_change",value:"高速路晴天白天",previous_value:"车库",priority:"P1"} };
  t.mock.method(global, "fetch", async () => { throw new Error("offline"); });
  const result = await handleWorkflowBody({route:"situation",input_payload:input});
  assert.equal(result.status, 502);
  assert.equal(result.payload.error, "DIFY_SITUATION_PROXY_ERROR");
  assert.equal(result.payload.scene_output, undefined);
  const other = await handleWorkflowBody({route:"situation",input_payload:{...input,event:{id:"other",type:"passenger_sleep"}}});
  assert.equal(other.status, 502);
  assert.equal(other.payload.scene_output, undefined);
});

test("silent environment analysis is returned as-is without entering Chatflow context", async (t) => {
  const previous = process.env.DIFY_SITUATION_API_KEY;
  process.env.DIFY_SITUATION_API_KEY = "test-key";
  t.after(() => previous === undefined ? delete process.env.DIFY_SITUATION_API_KEY : process.env.DIFY_SITUATION_API_KEY = previous);
  const scene = {game_id:"env-panel",round_id:"env-panel-1",scene_version:"env-panel-sv",event_id:"env-panel-event",
    analysis_status:"ready",usable_for_dialogue:true,expires_at_ms:Date.now()+60000,
    request_proactive_speech:false,host_response:null};
  const urls = [];
  t.mock.method(global, "fetch", async url => {
    urls.push(url);
    return new Response(JSON.stringify({workflow_run_id:"environment-analysis",data:{outputs:{scene_output:JSON.stringify(scene)}}}));
  });
  const response = await handleWorkflowBody({route:"situation",user_id:"environment-panel-test",
    input_payload:{...scene,trigger_type:"event",game:{status:"playing"},car:{environment:"隧道"},
      event:{id:scene.event_id,type:"environment_change",previous_value:"车库",value:"隧道",priority:"P1"}}});
  assert.equal(response.status, 200);
  assert.equal(response.payload.workflow_run_id, "environment-analysis");
  assert.equal(response.payload.scene_output.request_proactive_speech, false);
  assert.equal(response.payload.cached, false);
  assert.equal(JSON.parse(response.payload.workflow_output).ai_reply_text, "");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/v1\/workflows\/run$/);
});
