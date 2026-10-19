const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");
const { handleWorkflowBody } = require("../api/dify-bff");
const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8").replace(/\nboot\(\);\s*$/, "\n");
const flush = () => new Promise(resolve => setImmediate(resolve));

function client() {
  let now = 100000, id = 0;
  const timers = new Map();
  const schedule = (fn, delay) => { timers.set(++id, { fn, delay }); return id; };
  const context = vm.createContext({ structuredClone, console, crypto: webcrypto, AbortController,
    Date: class extends Date { static now() { return now; } }, cancelAnimationFrame() {},
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    window: { setTimeout: schedule, clearTimeout: id => timers.delete(id) },
    localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(source, context);
  vm.runInContext('render = () => {}; state.host.text = ""; state.game.status = "playing"; state.timeline.status = "running";', context);
  const run = code => vm.runInContext(code, context);
  const requests = [];
  context.capture = (input, signal, options) => new Promise((resolve, reject) => requests.push({ input, signal, options, resolve, reject }));
  run('requestWorkflow = capture;');
  return { run, context, requests, advance(ms) { now += ms; },
    value: code => JSON.parse(run(`JSON.stringify(${code})`)),
    fire(code) { const timer = timers.get(run(code)); assert.ok(timer, code); timer.fn(); } };
}

function sceneReply(app, request, { speak = true, decision = false } = {}) {
  const input = request.input;
  const scene = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
    event_id: input.event.id, event_type: input.event.type, expires_at_ms: app.run('Date.now() + 60000'),
    analysis_status: "ready", request_proactive_speech: speak, request_host_decision: decision,
    host_decision_seat: decision ? input.event.seat : null };
  request.resolve({ ai_reply_text: "分析节点不能直接播这句话", scene_output: scene,
    _bff: { route: "situation", ...scene, situation_handoff: speak || decision ? "test-handoff" : null } });
}

function hostReply(request, text, extra = {}) {
  const input = request.input;
  request.resolve({ ai_reply_text: text, intent: "event", decision_trace: { guard_status: "passed" },
    _bff: { route: "chat", operation: "situation_reply", event_id: input.event.id,
      game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version }, ...extra });
}

test("sleep detection waits for an explicit host comfort action before changing devices", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight");');
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  const pending = app.run('dispatchSituationWorkflow({id:"sleep-1",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0]); await pending; await flush();
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  hostReply(app.requests[1], "我来给休息的朋友关灯、降低分区音量，空调恢复记忆设置。", {
    execution: { actions: [{ type: "cabin.apply_sleep_comfort", seat: "rearRight" }] },
  });
  await flush();
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  assert.equal(app.run('startHostSpeechActions()'), true);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ["rearRight"]);
  assert.match(app.value('state.decisionTrace.execution'), /区域关灯、分区音量0、空调调至用户记忆值/);
  assert.equal(app.value('backgroundMusic.enabled'), false);
  app.run('applyImmediatePassengerWake("rearRight");');
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ["rearRight"]);
});

test("a host sleep reply without actions leaves zone devices unchanged", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearLeft");');
  const pending = app.run('dispatchSituationWorkflow({id:"sleep-no-action",type:"passenger_sleep",seat:"rearLeft",priority:"P2"})');
  sceneReply(app, app.requests[0]); await pending; await flush();
  hostReply(app.requests[1], "有朋友休息了，我们轻声继续。", { execution: { actions: [] } });
  await flush();
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
});

test("a silent analysis still produces sleep action speech and waits for its first display", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight");');
  const pending = app.run('dispatchSituationWorkflow({id:"sleep-silent",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await pending; await flush();
  assert.equal(app.requests.length, 2);
  hostReply(app.requests[1], "我来关灯、降低分区音量，空调恢复记忆设置。", { execution: { actions: [{ type: "cabin.apply_sleep_comfort", seat: "rearRight" }] } });
  await flush();
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  assert.match(app.value('state.host.text'), /关灯/);
  assert.equal(app.run('startHostSpeechActions()'), true);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ["rearRight"]);
  assert.equal(app.run('startHostSpeechActions()'), false);
});

test("queued comfort devices wait for P1 speech, then start once with their own bubble", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight"); publishHostLine("优先提醒", {priority:"P1",source:"speed_overspeed"}); state.workflow.hostSpeech.visibleAt=Date.now(); state.workflow.hostSpeech.wasVisible=true;');
  const pending = app.run('dispatchSituationWorkflow({id:"queued-comfort",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await pending; await flush();
  hostReply(app.requests[1], "我来关灯、降低分区音量，空调恢复记忆设置。", { execution: { actions: [{ type: "cabin.apply_sleep_comfort", seat: "rearRight" }] } });
  await flush();
  assert.equal(app.value('state.host.text'), "优先提醒");
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  assert.equal(app.value('state.workflow.deferredHostReplies.length'), 1);
  assert.equal(app.run('startHostSpeechActions()'), false);
  app.advance(7000);
  app.run('resumeDeferredHostReply();');
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  assert.equal(app.run('startHostSpeechActions()'), true);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ["rearRight"]);
});

test("minimum-display queue preserves the action plan and cancels it if the passenger wakes", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight"); publishHostLine("上一句回答",{priority:"P2",source:"chat"}); state.workflow.hostSpeech.visibleAt=Date.now(); state.workflow.hostSpeech.wasVisible=true;');
  app.advance(500);
  const pending = app.run('dispatchSituationWorkflow({id:"minimum-comfort",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0]); await pending; await flush();
  hostReply(app.requests[1], "我来关灯、降低分区音量，空调恢复记忆设置。", { execution: { actions: [{ type: "cabin.apply_sleep_comfort", seat: "rearRight" }] } });
  await flush();
  assert.equal(app.value('state.workflow.deferredHostReplies[0].options.startActions.actions.length'), 1);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  app.run('applyImmediatePassengerWake("rearRight");');
  app.advance(6000); app.fire('state.workflow.hostSpeech.timer');
  assert.equal(app.run('startHostSpeechActions()'), false);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
});

test("wake keeps devices unchanged until the restoration speech is actually displayed", async () => {
  const app = client();
  app.run('state.ui.sleepComfortSeats=["rearRight"]; state.passengers.seats.rearRight.mood="睡着"; applyImmediatePassengerWake("rearRight");');
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ["rearRight"]);
  const pending = app.run('dispatchSituationWorkflow({id:"wake-restore",type:"passenger_wake",seat:"rearRight",priority:"P3"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await pending; await flush();
  hostReply(app.requests[1], "你醒啦，我来把灯光、空调和分区音量恢复原设置。", { execution: { actions: [{ type: "cabin.restore_sleep_comfort", seat: "rearRight" }] } });
  await flush();
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ["rearRight"]);
  assert.equal(app.run('startHostSpeechActions()'), true);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  assert.match(app.value('state.decisionTrace.execution'), /恢复原设置/);
});

test("P0 cancels pending restoration without clearing already-applied comfort", async () => {
  const app = client();
  app.run('state.ui.sleepComfortSeats=["rearRight"]; state.passengers.seats.rearRight.mood="睡着"; applyImmediatePassengerWake("rearRight");');
  const pending = app.run('dispatchSituationWorkflow({id:"wake-p0",type:"passenger_wake",seat:"rearRight",priority:"P3"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await pending; await flush();
  hostReply(app.requests[1], "我来恢复该区灯光、空调和分区音量。", { execution: { actions: [{ type: "cabin.restore_sleep_comfort", seat: "rearRight" }] } });
  await flush();
  app.run('applyImmediateSafetyPause();');
  assert.equal(app.run('startHostSpeechActions()'), false);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ["rearRight"]);
});

test("comfort actions cannot target awake seats, other seats, normal chat or stale state", () => {
  const app = client();
  app.run(`
    applyImmediatePassengerSleep("rearRight");
    const input = { ...buildRealtimeChatInput(buildFullWorkflowInput("event", {
      id: "comfort-guard", type: "passenger_sleep", seat: "rearRight", priority: "P2",
    }, "")), trigger_type: "event", dialogue_request: { kind: "situation_event" } };
    const action = { type: "cabin.apply_sleep_comfort", seat: "rearRight" };
  `);
  assert.equal(app.value('canApplySleepComfortAction(action, input)'), true);
  assert.equal(app.value('canApplySleepComfortAction({...action,seat:"front"}, input)'), false);
  assert.equal(app.value('canApplySleepComfortAction({...action,enabled:true}, input)'), false);
  assert.equal(app.value('canApplySleepComfortAction(action, {...input, trigger_type:"chat"})'), false);
  app.run('applyImmediatePassengerWake("rearRight");');
  assert.equal(app.value('canApplySleepComfortAction(action, input)'), false);
  app.run('applyImmediatePassengerSleep("rearRight"); state.workflow.p0Epoch += 1;');
  assert.equal(app.value('canApplySleepComfortAction(action, input)'), false);
});

test("event analysis automatically calls Chatflow in sequence and only Chatflow speech is displayed", async () => {
  const app = client();
  app.run('state.car.environment = "隧道";');
  const pending = app.run('dispatchSituationWorkflow({id:"e1",type:"environment_change",value:"隧道",previous_value:"车库",priority:"P1"})');
  assert.equal(app.requests.length, 1);
  assert.equal(app.value('state.host.text'), "");
  sceneReply(app, app.requests[0]); await pending; await flush();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].input.trigger_type, "event");
  assert.equal(app.requests[1].input.dialogue_request.kind, "situation_event");
  assert.equal(app.requests[1].input.player_input, "");
  assert.equal(app.requests[1].options.situationHandoff, "test-handoff");
  assert.equal(app.value('state.workflow.hostAwaitingReply'), false);
  assert.equal(app.value('state.workflow.hostThinkingTimer'), null);
  assert.equal(app.value('state.host.text'), "");
  hostReply(app.requests[1], "我们进入隧道啦。"); await flush();
  assert.equal(app.value('state.host.text'), "我们进入隧道啦。");
  assert.equal(app.value('state.game.questionCount'), 0);
  assert.equal(app.value('state.game.status'), "playing");
});

test("silent or failed analysis never calls Chatflow or generates generic filler", async () => {
  const app = client();
  const pending = app.run('dispatchSituationWorkflow({id:"silent",type:"cabin_laughing",priority:"P4"})');
  sceneReply(app, app.requests[0], { speak: false }); await pending;
  assert.equal(app.requests.length, 1);
  const failed = app.run('dispatchSituationWorkflow({id:"fail",type:"game_stuck",priority:"P3"})');
  app.requests[1].reject(new Error("unavailable")); await failed;
  assert.equal(app.requests.length, 2);
  assert.equal(app.value('state.host.text'), "");
});

test("event generation failures remain silent and report their actual cause", async () => {
  const app = client();
  const pending = app.run('dispatchSituationWorkflow({id:"broken",type:"environment_change",priority:"P1"})');
  sceneReply(app, app.requests[0]); await pending; await flush();
  hostReply(app.requests[1], "", { intent: "fallback", decision_trace: { guard_status: "event_reply_skipped" },
    _diagnostic: { model_output_status: "retry_exhausted", model_nodes: [{ error_code: "structured_output_parse_failed" }] } });
  await flush();
  assert.equal(app.value('state.host.text'), "");
  assert.equal(app.value('state.decisionTrace.execution'), "主持人回复格式错误，重试后仍失败");
  assert.equal(app.value('state.game.status'), "playing");
});

test("late analysis and late event replies are invalidated by environment changes and P0", async () => {
  const app = client();
  app.run('state.car.environment="隧道";');
  const first = app.run('dispatchSituationWorkflow({id:"old",type:"environment_change",priority:"P1"})');
  app.run('state.car.environment="车库";');
  sceneReply(app, app.requests[0]); await first;
  assert.equal(app.requests.length, 1);
  const latest = app.run('dispatchSituationWorkflow({id:"new",type:"environment_change",priority:"P1"})');
  sceneReply(app, app.requests[1]); await latest;
  assert.equal(app.requests.length, 3);
  app.run('applyImmediateSafetyPause();');
  hostReply(app.requests[2], "不能覆盖安全气泡"); await flush();
  assert.equal(app.value('state.game.status'), "paused");
  assert.equal(app.value('state.host.text'), "大家坐稳，游戏先暂停。");
  assert.equal(app.value('state.workflow.pendingSituationReplies.length'), 0);
});

test("event replies share the chat request queue; P1 takes the next slot and stale types are replaced", async () => {
  const app = client();
  app.run('state.workflow.inFlight = true; state.workflow.pendingChats = [{seat:"front",text:"它是人造的吗？"}];');
  const first = app.run('dispatchSituationWorkflow({id:"old",type:"driver_tired",priority:"P1"})');
  sceneReply(app, app.requests[0]); await first;
  const latest = app.run('dispatchSituationWorkflow({id:"new",type:"driver_tired",priority:"P1"})');
  sceneReply(app, app.requests[1]); await latest;
  assert.equal(app.value('state.workflow.pendingSituationReplies.length'), 1);
  assert.equal(app.requests.length, 2);
  app.run('state.workflow.inFlight = false; void processNextPendingChat();');
  assert.equal(app.requests[2].input.event.id, "new");
  assert.equal(app.value('state.workflow.pendingChats.length'), 1);
  hostReply(app.requests[2], "主驾辛苦了，先专心开车。"); await flush();
});

test("event models cannot reveal answers, change status, or execute actions", async () => {
  const app = client();
  const pending = app.run('dispatchSituationWorkflow({id:"e1",type:"speed_overspeed",priority:"P1"})');
  sceneReply(app, app.requests[0]); await pending;
  hostReply(app.requests[1], "越权结果", { is_correct: true, game_status: "victory", ui_change: { show_answer: true } });
  await flush();
  assert.equal(app.value('state.game.status'), "playing");
  assert.equal(app.value('state.ui.showAnswer'), false);
  assert.equal(app.value('state.host.text'), "");
});

test("distinct P1 speech is queued and becomes next only after the current bubble finishes", () => {
  const app = client();
  app.run('publishHostLine("问题的回答",{source:"chat"}); state.workflow.hostSpeech.visibleAt=Date.now();');
  app.advance(500);
  app.run('publishHostLine("注意车速",{source:"speed_overspeed",priority:"P1"});');
  assert.equal(app.value('state.host.text'), "问题的回答");
  app.advance(1040); app.fire('state.workflow.deferredHostRepliesTimer');
  assert.equal(app.value('state.host.text'), "问题的回答");
  app.advance(4500); app.fire('state.workflow.hostSpeech.timer');
  assert.equal(app.value('state.host.text'), "注意车速");
  app.run('state.workflow.hostSpeech.visibleAt=Date.now(); publishHostLine("关心主驾",{source:"driver_tired",priority:"P1"});');
  assert.equal(app.value('state.workflow.deferredHostReplies.some(row=>row.text==="关心主驾")'), true);
});

test("two sleeping seats survive reverse analysis completion and generate FIFO using fresh snapshots", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearLeft");');
  const left = app.run('dispatchSituationWorkflow({id:"multi-left",type:"passenger_sleep",seat:"rearLeft",priority:"P2"})');
  app.run('applyImmediatePassengerSleep("rearRight");');
  const right = app.run('dispatchSituationWorkflow({id:"multi-right",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[1], { speak: false, decision: true }); await right;
  assert.equal(app.requests.length, 2, 'later same-priority event must not jump past the older analysis');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await left;
  assert.equal(app.value('findSituationEvent("multi-left").status'), 'pending_analysis');
  const refreshed = app.run('processNextPendingChat()');
  assert.equal(app.requests[2].input.passengers.states.rear_right, '睡着');
  sceneReply(app, app.requests[2], { speak: false, decision: true }); await refreshed;
  assert.equal(app.requests[3].input.event.seat, 'rearLeft');
  hostReply(app.requests[3], '左后关灯、分区音量0、空调调至用户记忆值。', {
    execution: { actions: [{ type: 'cabin.apply_sleep_comfort', seat: 'rearLeft' }] },
  }); await flush();
  assert.equal(app.run('startHostSpeechActions()'), true);
  const second = app.run('processNextPendingChat()');
  assert.equal(app.requests[4].input.event.seat, 'rearRight');
  assert.deepEqual(Array.from(app.requests[4].input.car.sleep_comfort_seats), ['rearLeft']);
  hostReply(app.requests[4], '右后关灯、分区音量0、空调调至用户记忆值。', {
    execution: { actions: [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }] },
  }); await second;
  assert.match(app.value('state.host.text'), /左后/);
  app.advance(6000); app.fire('state.workflow.hostSpeech.timer');
  assert.match(app.value('state.host.text'), /右后/);
  assert.equal(app.run('startHostSpeechActions()'), true);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ['rearLeft', 'rearRight']);
  assert.equal(app.value('state.workflow.situationEvents.filter(row=>row.status==="superseded").length'), 0);
});

test("slow P1 analysis keeps its priority over a ready lower-priority event", async () => {
  const app = client();
  const high = app.run('dispatchSituationWorkflow({id:"priority-high",type:"driver_tired",priority:"P1"})');
  const low = app.run('dispatchSituationWorkflow({id:"priority-low",type:"near_destination",priority:"P2"})');
  sceneReply(app, app.requests[1]); await low;
  assert.equal(app.requests.length, 2);
  sceneReply(app, app.requests[0]); await high;
  assert.equal(app.requests[2].input.event.id, 'priority-high');
  hostReply(app.requests[2], '主驾请注意休息。'); await flush();
  const next = app.run('processNextPendingChat()');
  hostReply(app.requests[3], '快到目的地了。'); await next;
  assert.equal(app.value('state.host.text'), '主驾请注意休息。');
  app.advance(3000); app.fire('state.workflow.hostSpeech.timer');
  assert.equal(app.value('state.host.text'), '快到目的地了。');
});

test("unrelated environment changes do not cancel a generated sleep action, while waking does", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight");');
  const pending = app.run('dispatchSituationWorkflow({id:"sleep-env",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await pending;
  app.run('state.car.environment="隧道";');
  hostReply(app.requests[1], '右后关灯、音量0、空调用户记忆值。', {
    execution: { actions: [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }] },
  }); await flush();
  assert.equal(app.run('startHostSpeechActions()'), true);
  const original = app.requests[1].input;
  app.context.original = original;
  app.run('applyImmediatePassengerWake("rearRight");');
  assert.equal(app.run('canApplySleepComfortAction({type:"cabin.apply_sleep_comfort",seat:"rearRight"},original)'), false);
});

test("a waking event supersedes only the same seat's pending sleep, not the other sleeping seat", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearLeft"); applyImmediatePassengerSleep("rearRight"); state.workflow.inFlight=true;');
  const left = app.run('dispatchSituationWorkflow({id:"sleep-left",type:"passenger_sleep",seat:"rearLeft",priority:"P2"})');
  const right = app.run('dispatchSituationWorkflow({id:"sleep-right",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  app.run('applyImmediatePassengerWake("rearRight");');
  const wake = app.run('dispatchSituationWorkflow({id:"wake-right",type:"passenger_wake",seat:"rearRight",priority:"P3"})');
  sceneReply(app, app.requests[0]); await left;
  sceneReply(app, app.requests[1]); await right;
  sceneReply(app, app.requests[2], { speak: false }); await wake;
  assert.equal(app.value('findSituationEvent("sleep-right").status'), 'superseded');
  assert.equal(app.value('findSituationEvent("sleep-left").status'), 'ready');
  assert.equal(app.value('state.workflow.pendingSituationReplies.length'), 1);
});

test("P0 preserves an unanswered event but rejects the old result and reanalyzes after recovery", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight");');
  const pending = app.run('dispatchSituationWorkflow({id:"care-p0",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await pending;
  app.run('applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake");');
  hostReply(app.requests[1], '旧模型不能覆盖安全气泡'); await flush();
  assert.equal(app.value('state.host.text'), '大家坐稳，游戏先暂停。');
  assert.equal(app.value('findSituationEvent("care-p0").status'), 'pending_analysis');
  app.advance(4500); app.fire('state.workflow.recoveryTimer');
  assert.equal(app.requests[2].input.event.id, 'care-p0');
  assert.notEqual(app.requests[2].input.p0_epoch, app.requests[0].input.p0_epoch);
  sceneReply(app, app.requests[2], { speak: false, decision: true }); await flush();
  hostReply(app.requests[3], '我来关灯、分区音量0、空调用户记忆值。', {
    execution: { actions: [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }] },
  }); await flush();
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
  app.advance(1500); app.fire('state.workflow.hostSpeech.timer');
  assert.equal(app.run('startHostSpeechActions()'), true);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), ['rearRight']);
});

test("a pre-P0 analysis finishing late cannot mark its replacement request failed", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight");');
  const old = app.run('dispatchSituationWorkflow({id:"analysis-p0",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  app.run('applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake");');
  app.advance(4500); app.fire('state.workflow.recoveryTimer');
  assert.equal(app.requests.length, 2);
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await old;
  assert.equal(app.value('findSituationEvent("analysis-p0").status'), 'analyzing');
  sceneReply(app, app.requests[1], { speak: false, decision: true }); await flush();
  assert.equal(app.requests[2].input.event.id, 'analysis-p0');
  hostReply(app.requests[2], '关灯、音量0、空调用户记忆值。', {
    execution: { actions: [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }] },
  }); await flush();
  assert.equal(app.value('findSituationEvent("analysis-p0").status'), 'waiting_speech');
});

test("a pre-P0 model result finishing late cannot corrupt the replacement model task", async () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearRight");');
  const first = app.run('dispatchSituationWorkflow({id:"model-p0",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await first;
  app.run('applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake");');
  app.advance(4500); app.fire('state.workflow.recoveryTimer');
  sceneReply(app, app.requests[2], { speak: false, decision: true }); await flush();
  assert.equal(app.requests[3].input.event.id, 'model-p0');
  hostReply(app.requests[1], '旧模型回复'); await flush();
  assert.equal(app.value('findSituationEvent("model-p0").status'), 'generating');
  hostReply(app.requests[3], '关灯、音量0、空调用户记忆值。', {
    execution: { actions: [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }] },
  }); await flush();
  assert.equal(app.value('findSituationEvent("model-p0").status'), 'waiting_speech');
});

test("expired analysis is refreshed rather than silently losing an important event", async () => {
  const app = client();
  app.run('state.workflow.inFlight=true; applyImmediatePassengerSleep("rearRight");');
  const pending = app.run('dispatchSituationWorkflow({id:"care-expired",type:"passenger_sleep",seat:"rearRight",priority:"P2"})');
  sceneReply(app, app.requests[0], { speak: false, decision: true }); await pending;
  app.advance(61000); app.run('state.workflow.inFlight=false;');
  await app.run('processNextPendingChat()');
  assert.equal(app.value('findSituationEvent("care-expired").status'), 'pending_analysis');
  const retry = app.run('processNextPendingChat()');
  assert.equal(app.requests[1].input.event.id, 'care-expired');
  sceneReply(app, app.requests[1], { speak: false, decision: true }); await retry;
  hostReply(app.requests[2], '现在来关灯、分区音量0、空调用户记忆值。', {
    execution: { actions: [{ type: 'cabin.apply_sleep_comfort', seat: 'rearRight' }] },
  }); await flush();
  assert.equal(app.run('startHostSpeechActions()'), true);
});

test("device actions are idempotent per event even if execution is requested twice", () => {
  const app = client();
  app.run(`applyImmediatePassengerSleep("rearRight");
    registerSituationEvent({id:"care-once",type:"passenger_sleep",seat:"rearRight",priority:"P2"});
    const input={...buildWorkflowInput("event",{id:"care-once",type:"passenger_sleep",seat:"rearRight",priority:"P2"},""),dialogue_request:{kind:"situation_event"}};
    const action={type:"cabin.apply_sleep_comfort",seat:"rearRight"};
    applyWorkflowActions([action],input); state.ui.zoneLights.rearRight=true; applyWorkflowActions([action],input);`);
  assert.equal(app.value('state.ui.zoneLights.rearRight'), true);
  assert.equal(app.value('findSituationEvent("care-once").executedActions.length'), 1);
});

test("ordinary current-round answers survive unrelated cabin changes but never cross a new round or P0", () => {
  const app = client();
  app.run('const ordinary=buildWorkflowInput("chat",null,"它是人造的吗？"); state.car.environment="隧道"; applyImmediatePassengerSleep("rearLeft");');
  assert.equal(app.run('isCurrentWorkflowInput(ordinary)'), true);
  app.run('state.workflow.p0Epoch+=1;');
  assert.equal(app.run('isCurrentWorkflowInput(ordinary)'), false);
  app.run('state.workflow.p0Epoch-=1; state.game.roundIndex+=1;');
  assert.equal(app.run('isCurrentWorkflowInput(ordinary)'), false);
});

test("P2 passenger questions and events use arrival order, while P1 always gets the next slot", () => {
  const app = client();
  app.run('state.workflow.pendingChats=[{seat:"front",text:"先问的问题",sequence:1}]; state.workflow.situationEventSequence=1; const later=registerSituationEvent({id:"fifo-event",type:"near_destination",priority:"P2"});');
  assert.equal(app.run('shouldProcessSituationBeforeChat(later)'), false);
  app.run('state.workflow.pendingChats[0].sequence=3;');
  assert.equal(app.run('shouldProcessSituationBeforeChat(later)'), true);
  app.run('state.workflow.pendingChats[0].sequence=1; later.event.priority="P1";');
  assert.equal(app.run('shouldProcessSituationBeforeChat(later)'), true);
});

test("BFF signs analysis handoffs, routes verified events to Chatflow, and rejects forged/P0/stale handoffs", async t => {
  const previous = [process.env.DIFY_CHATFLOW_API_KEY, process.env.DIFY_SITUATION_API_KEY];
  process.env.DIFY_CHATFLOW_API_KEY = "chat-key"; process.env.DIFY_SITUATION_API_KEY = "scene-key";
  t.after(() => ["DIFY_CHATFLOW_API_KEY", "DIFY_SITUATION_API_KEY"].forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]));
  const calls = [];
  const input = { trigger_type: "event", game_id: "serial", round_id: "serial-1", scene_version: "sv-1",
    game: { status: "playing", current_answer: "海豚" }, car: { environment: "隧道" },
    event: { id: "serial-e1", type: "environment_change", priority: "P1", value: "隧道", previous_value: "车库" } };
  const scene = { ...input, event_id: input.event.id, generated_at_ms: Date.now(), expires_at_ms: Date.now() + 60000,
    analysis_status: "ready", request_proactive_speech: true, host_response: { ai_reply_text: "旧串词不要播" },
    dialogue_context: { guidance: { strategy: "soft_response" }, selected_snapshot: { environment: "隧道" } } };
  t.mock.method(global, "fetch", async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(url.endsWith("/workflows/run")
      ? { data: { outputs: { scene_output: JSON.stringify(scene) } } }
      : { conversation_id: "persistent-conversation", host_result: { ai_reply_text: "我们进入隧道啦。", context_scope: { game_id: "serial", round_id: "serial-1", scene_version: "sv-1" } } }), { headers: { "Content-Type": "application/json" } });
  });
  const analysis = await handleWorkflowBody({ route: "situation", user_id: "user1", input_payload: input });
  assert.equal(analysis.payload.scene_output.host_response, null);
  assert.equal(JSON.parse(analysis.payload.workflow_output).ai_reply_text, "");
  const body = { route: "chat", operation: "situation_reply", user_id: "user1", conversation_id: "persistent-conversation",
    situation_handoff: analysis.payload.situation_handoff, input_payload: input };
  const reply = await handleWorkflowBody(body);
  assert.equal(reply.status, 200);
  assert.equal(reply.payload.operation, "situation_reply");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /chat-messages$/);
  assert.equal(calls[1].body.conversation_id, "persistent-conversation");
  assert.equal(JSON.parse(calls[1].body.inputs.snapshot).dialogue_request.kind, "situation_event");
  assert.equal(JSON.parse(calls[1].body.inputs.situation).event_id, input.event.id);
  assert.ok(!calls[1].body.query.includes("海豚"));
  for (const invalid of [
    { ...body, situation_handoff: "forged" }, { ...body, user_id: "user2" },
    { ...body, input_payload: { ...input, scene_version: "sv-2" } },
    { ...body, input_payload: { ...input, event: { ...input.event, type: "hard_brake", priority: "P0" } } },
  ]) assert.equal((await handleWorkflowBody(invalid)).status, 409);
  assert.equal(calls.length, 2);
});

test("BFF provides a seat-bound decision handoff for silent confirmed sleep only", async t => {
  const previous = [process.env.DIFY_CHATFLOW_API_KEY, process.env.DIFY_SITUATION_API_KEY];
  process.env.DIFY_CHATFLOW_API_KEY = "chat-key"; process.env.DIFY_SITUATION_API_KEY = "scene-key";
  t.after(() => ["DIFY_CHATFLOW_API_KEY", "DIFY_SITUATION_API_KEY"].forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]));
  const input = { trigger_type: "event", game_id: "sleep", round_id: "sleep-1", scene_version: "sv-sleep",
    game: { status: "playing" }, passengers: { states: { rear_right: "睡着", front: "睡着" } },
    event: { id: "sleep-event", type: "passenger_sleep", priority: "P2", seat: "rearRight" } };
  t.mock.method(global, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith("/workflows/run")) {
      const snapshot = JSON.parse(body.inputs.snapshot);
      return new Response(JSON.stringify({ data: { outputs: { scene_output: JSON.stringify({
        game_id: snapshot.game_id, round_id: snapshot.round_id, scene_version: snapshot.scene_version,
        event_id: snapshot.event.id, generated_at_ms: Date.now(), expires_at_ms: Date.now() + 60000,
        analysis_status: "ready", request_proactive_speech: false,
      }) } } }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ host_result: { ai_reply_text: "", execution: { actions: [] } } }), { headers: { "Content-Type": "application/json" } });
  });
  const analysis = await handleWorkflowBody({ route: "situation", user_id: "sleep-user", input_payload: input });
  assert.equal(analysis.payload.scene_output.request_host_decision, true);
  const body = { route: "chat", operation: "situation_reply", user_id: "sleep-user",
    situation_handoff: analysis.payload.situation_handoff, input_payload: input };
  assert.equal((await handleWorkflowBody(body)).status, 200);
  assert.equal((await handleWorkflowBody({ ...body, input_payload: { ...input,
    event: { ...input.event, seat: "front" } } })).status, 409);
  const awake = await handleWorkflowBody({ route: "situation", user_id: "sleep-user", input_payload: { ...input,
    passengers: { states: { rear_right: "普通" } } } });
  assert.equal(awake.payload.scene_output.request_host_decision, false);
  assert.equal(awake.payload.situation_handoff, null);
  const waking = await handleWorkflowBody({ route: "situation", user_id: "sleep-user", input_payload: {
    ...input, car: { sleep_comfort_seats: ["rearRight"] }, passengers: { states: { rear_right: "普通" } },
    event: { ...input.event, type: "passenger_wake" },
  } });
  assert.equal(waking.payload.scene_output.request_host_decision, true);
  assert.ok(waking.payload.situation_handoff);
});
