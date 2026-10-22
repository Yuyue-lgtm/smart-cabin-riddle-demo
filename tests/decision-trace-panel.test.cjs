const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8")
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, "\n");

function createClient() {
  const context = vm.createContext({
    structuredClone,
    console,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    window: { setTimeout, clearTimeout, setInterval, clearInterval },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(source, context);
  return {
    value: (expression) => vm.runInContext(`JSON.stringify(${expression})`, context),
    run: (code) => vm.runInContext(code, context),
  };
}

test("fusion panel stays empty until a meaningful trace and keeps the last event instead of synthesizing cabin status", () => {
  const app = createClient();
  assert.deepEqual(JSON.parse(app.value("({ perception: state.decisionTrace.perception, decision: state.decisionTrace.decision, execution: state.decisionTrace.execution })")), {
    perception: "", decision: "", execution: "",
  });

  app.run(`state.car.environment = "高速路晴天白天";
    state.car.speed = 80;
    updateDecisionTrace({ perception: "副驾说：这是什么？", decision: "根据当前题目回答物体属性", execution: "主持人气泡：显示中" });`);
  assert.deepEqual(JSON.parse(app.value("({ perception: state.decisionTrace.perception, decision: state.decisionTrace.decision, execution: state.decisionTrace.execution })")), {
    perception: "副驾说：这是什么？",
    decision: "根据当前题目回答物体属性",
    execution: "主持人气泡：显示中",
  });
  app.run('updateDecisionTrace({});');
  assert.deepEqual(JSON.parse(app.value("({ perception: state.decisionTrace.perception, decision: state.decisionTrace.decision, execution: state.decisionTrace.execution })")), {
    perception: "", decision: "", execution: "",
  });

  app.run("resetDecisionTrace()");
  assert.deepEqual(JSON.parse(app.value("({ perception: state.decisionTrace.perception, decision: state.decisionTrace.decision, execution: state.decisionTrace.execution })")), {
    perception: "", decision: "", execution: "",
  });
});

test("game start is shown as an explicit perception event", () => {
  const app = createClient();
  app.run(`render = () => {};
    const input = buildWorkflowInput("event", { id: "start-test", type: "start_game", priority: "P3" }, "");
    applyWorkflowOutput(localDecision(input), input, "local");`);
  assert.equal(app.value("state.decisionTrace.perception"), '"游戏开始：第 1 题已就绪"');
  assert.equal(app.value("state.decisionTrace.decision"), '"启动本题答题流程"');
});

test("scripted passenger questions show perception immediately and defer decision and execution", async () => {
  const app = createClient();
  app.run(`
    render = () => {};
    showPassengerBubble = () => {};
    dispatchWorkflow = async () => {};
    state.game.status = "playing";
  `);

  await app.run('runScriptedQuestion("rearLeft", "它是人造的吗？")');
  assert.deepEqual(JSON.parse(app.value("({ perception: state.decisionTrace.perception, decision: state.decisionTrace.decision, execution: state.decisionTrace.execution })")), {
    perception: "左后提问：它是人造的吗？",
    decision: "",
    execution: "",
  });
});

test("passenger chat response fills decision, then execution receipts", () => {
  const app = createClient();
  app.run(`
    render = () => {};
    state.game.status = "playing";
    const input = buildWorkflowInput("chat", null, "它是人造的吗？");
    showPassengerQuestionPerception("front", input.player_input);
    const initialTrace = {
      perception: state.decisionTrace.perception,
      decision: state.decisionTrace.decision,
      execution: state.decisionTrace.execution,
    };
    const output = {
      ai_reply_text: "不是。",
      game_status: "playing",
      decision_trace: { schema_version: 2, decision: "根据当前题目回答物体属性", priority: "P2" },
      ui_change: { animation: "speak", show_answer: false },
      _bff: { route: "chat", game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version },
    };
    applyWorkflowOutput(output, input, "chat");
  `);
  assert.deepEqual(JSON.parse(app.value("initialTrace")), {
    perception: "副驾提问：它是人造的吗？",
    decision: "",
    execution: "",
  });
  const trace = JSON.parse(app.value("({ perception: state.decisionTrace.perception, decision: state.decisionTrace.decision, execution: state.decisionTrace.execution })"));
  assert.match(trace.perception, /它是人造的吗/);
  assert.match(trace.decision, /根据当前题目回答物体属性/);
  assert.equal(trace.execution, "主持话术：等待显示");
});

test("knowhow retrieval status and matches appear under decision, not perception", () => {
  const app = createClient();
  app.run(`
    const input = buildWorkflowInput("chat", null, "它是人造的吗？");
    const trace = normalizeDecisionTrace({
      perception: { schema_version: 2, signals: [{ field: "question", value: "它是人造的吗？" }] },
      decision_trace: { schema_version: 2, decision: "按当前题目回应" },
      knowhow_status: "used",
      retrieved_knowhow: [{ title: "适龄提问", knowhow_id: "HK09" }],
      strategy: "direct_answer",
    }, input);
  `);
  const trace = JSON.parse(app.value("trace"));
  assert.match(trace.perception, /它是人造的吗/);
  assert.doesNotMatch(trace.perception, /经验库检索|检索到|采用经验/);
  assert.match(trace.decision, /经验库检索：已检索/);
  assert.match(trace.decision, /检索到：适龄提问（HK09）/);
});

test("priority panel preserves staged perception before decision and execution", () => {
  const app = createClient();
  app.run(`state.game.status="playing";
    state.passengers.seats.rearLeft.mood="睡着";
    registerSituationEvent({id:"left",type:"passenger_sleep",seat:"rearLeft",priority:"P2"});
    state.passengers.seats.rearRight.mood="睡着";
    registerSituationEvent({id:"right",type:"passenger_sleep",seat:"rearRight",priority:"P2"});
    updateDecisionTrace({perception:"副驾提问：它是人造的吗？"});`);
  const view = JSON.parse(app.value('getDecisionQueuePresentation()'));
  assert.match(view.perception, /它是人造的吗/);
  assert.match(view.perception, /同时事件：.*后排左睡着.*后排右睡着/);
  assert.equal(view.priority, '');
  assert.equal(view.decision, '');
  assert.equal(view.execution, '');
  app.run('resetDecisionTrace();');
  assert.deepEqual(JSON.parse(app.value('getDecisionQueuePresentation()')), { perception: '', decision: '', execution: '', priority: '' });
});

test("panel shows P1 responding while two P2 seats wait in FIFO order without erasing model details", () => {
  const app = createClient();
  app.run(`render=()=>{}; window.setTimeout=()=>1; state.game.status="playing"; state.host.text="";
    state.passengers.seats.rearLeft.mood="睡着";
    registerSituationEvent({id:"left",type:"passenger_sleep",seat:"rearLeft",priority:"P2"});
    state.passengers.seats.rearRight.mood="睡着";
    registerSituationEvent({id:"right",type:"passenger_sleep",seat:"rearRight",priority:"P2"});
    state.car.environment="隧道";
    const env={id:"env",type:"environment_change",value:"隧道",priority:"P1"}; registerSituationEvent(env);
    const traceId=updateDecisionTrace({perception:"检测到后排右睡着",decision:"启用睡眠关怀，等待话术后执行",priority:"P2"});
    findSituationEvent("right").traceId=traceId;
    const scope=getSituationScope(buildWorkflowInput("event",env,""),{expires_at_ms:Date.now()+60000});
    publishHostLine("进入隧道了",{source:"environment",priority:"P1",sceneScope:scope});`);
  const view = JSON.parse(app.value('getDecisionQueuePresentation()'));
  assert.equal(view.priority, 'P2');
  assert.match(view.perception, /同时事件：.*后排左睡着.*环境切换：隧道/);
  assert.match(view.decision, /P1 环境切换：隧道正在回应，本事件排队/);
  assert.match(view.decision, /启用睡眠关怀/);
  assert.match(view.execution, /正在回应：P1 环境切换：隧道/);
  assert.match(view.execution, /接下来：P2 后排左睡着 → P2 后排右睡着/);
  assert.equal(app.value('state.decisionTrace.decision'), '"启用睡眠关怀，等待话术后执行"');
});

test("same-priority FIFO and cancellation reasons are reflected without phantom queue entries", () => {
  const app = createClient();
  app.run(`state.game.status="playing";
    state.passengers.seats.rearLeft.mood="睡着"; registerSituationEvent({id:"left",type:"passenger_sleep",seat:"rearLeft",priority:"P2"});
    state.passengers.seats.rearRight.mood="睡着"; registerSituationEvent({id:"right",type:"passenger_sleep",seat:"rearRight",priority:"P2"});
    const id=updateDecisionTrace({perception:"后排右睡着",decision:"关怀计划",priority:"P2"}); findSituationEvent("right").traceId=id;`);
  assert.match(JSON.parse(app.value('getDecisionQueuePresentation()')).decision, /同级事件按发生顺序/);
  app.run('setSituationEventStatus(findSituationEvent("right"),"cancelled","乘客已醒，本次关怀取消");');
  const view = JSON.parse(app.value('getDecisionQueuePresentation()'));
  assert.match(view.decision, /乘客已醒，本次关怀取消/);
  assert.match(view.execution, /接下来：P2 后排左睡着/);
  assert.doesNotMatch(view.execution, /接下来：.*后排右睡着/);
  app.run(`state.workflow.deferredHostReplies.push({gameId:state.workflow.gameId,p0Epoch:state.workflow.p0Epoch,expiresAt:Date.now()+30000,
    sequence:3,options:{priority:HOST_SPEECH_PRIORITIES.P2,source:"chat"}});`);
  assert.match(JSON.parse(app.value('getDecisionQueuePresentation()')).execution, /P2 乘客提问回答/);
});

test("P0 priority and retained waiting events are visible in the panel", () => {
  const app = createClient();
  app.run(`render=()=>{}; window.setTimeout=()=>1; state.game.status="playing"; state.host.text="";
    state.passengers.seats.rearRight.mood="睡着"; registerSituationEvent({id:"right",type:"passenger_sleep",seat:"rearRight",priority:"P2"});
    publishHostLine("先坐稳",{priority:"P0",source:"hard_brake"});
    updateDecisionTrace({perception:"检测到急刹",decision:"安全优先，暂停游戏",priority:"P0"});`);
  const view = JSON.parse(app.value('getDecisionQueuePresentation()'));
  assert.equal(view.priority, 'P0');
  assert.match(view.decision, /P0 立即处理，其他待办保留等待/);
  assert.match(view.execution, /正在回应：P0 安全暂停/);
  assert.match(view.execution, /接下来：P2 后排右睡着/);
});

test("priority presentation follows frontend arbitration instead of an event model's claimed priority", () => {
  const app = createClient();
  app.run(`const input=buildWorkflowInput("event",{id:"sleep",type:"passenger_sleep",seat:"rearRight",priority:"P2"},"");
    const trace=normalizeDecisionTrace({decision_trace:{schema_version:2,decision:"关怀",priority:"P0"}},input);`);
  assert.equal(JSON.parse(app.value('trace')).priority, 'P2');
});
