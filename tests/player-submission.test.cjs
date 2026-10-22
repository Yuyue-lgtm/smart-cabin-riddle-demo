const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");

const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8")
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, "\n");

function client() {
  let now = 100000;
  let id = 0;
  const timers = new Map();
  const schedule = (callback, delay) => { timers.set(++id, { callback, delay }); return id; };
  const context = vm.createContext({
    structuredClone, console, crypto: webcrypto, AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout: schedule, clearTimeout: key => timers.delete(key),
    requestAnimationFrame: schedule, cancelAnimationFrame() {},
    window: { addEventListener() {}, setTimeout: schedule, clearTimeout: key => timers.delete(key) },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run(`
    render = () => {};
    startConfetti = () => {};
    showCorrectSeatLight = () => {};
    startResultFeedback = () => {};
    notifyP0Situation = () => {};
    scheduleNextRound = () => {};
    const bubbles = [], diagnostics = [];
    showPassengerBubble = (seat, text) => bubbles.push({seat, text});
    recordClientRuntimeDiagnostic = (type, detail) => diagnostics.push({type, ...detail});
    state.game.status = "playing";
    state.timeline.status = "running";
    els.playerInput = { value: "" };
  `);
  return { run, context, advance(ms) { now += ms; } };
}

test("player input onboarding appears during play and resets for a new game", () => {
  const app = client();
  app.run('els.playerInputGuide={hidden:true}; resetPlayerInputGuide();');
  assert.equal(app.run('shouldShowPlayerInputGuide("playing")'), true);
  assert.equal(app.run('shouldShowPlayerInputGuide("ready")'), false);
  app.run("dismissPlayerInputGuide();");
  assert.equal(app.run('shouldShowPlayerInputGuide("playing")'), false);
  assert.equal(app.run("els.playerInputGuide.hidden"), true);
  app.run("resetPlayerInputGuide();");
  assert.equal(app.run('shouldShowPlayerInputGuide("playing")'), true);
});

for (const voiceState of ["voicePending", "voicePlaying"]) {
  test(`a correct submission resolves immediately during ${voiceState} and clears obsolete work`, async () => {
    const app = client();
    app.run(`
      state.workflow.hostSpeech.${voiceState} = true;
      state.workflow.pendingChats.push({seat:"rearLeft",text:"旧问题"});
      deferHostReply("旧回复", {priority:"P2",source:"chat"});
      state.workflow.situationEvents.push({status:"analyzing",event:{id:"old",priority:"P2"}});
      requestWorkflow = () => { throw new Error("correct answer must not request chat"); };
      els.playerInput.value = getCurrentRiddle().answer;
    `);
    await app.run("sendQuestion()");
    assert.equal(app.run("state.game.status"), "victory");
    assert.equal(app.run("state.ui.correctSeat"), "front");
    assert.equal(app.run("state.workflow.hostSpeech.source"), "victory");
    assert.equal(app.run("state.workflow.pendingChats.length"), 0);
    assert.equal(app.run("state.workflow.deferredHostReplies.length"), 0);
    assert.equal(app.run("bubbles.length"), 1);
    assert.equal(app.run("state.game.history.at(-1).output.decision_trace.matched_rule"), "frontend_answer_hit");
    assert.equal(app.run('diagnostics.some(d => d.stage === "queued")'), false);
  });
}

test("a late remote reply cannot overwrite a correct submission", async () => {
  const app = client();
  let resolveReply;
  app.context.pendingReply = () => new Promise(resolve => { resolveReply = resolve; });
  app.run("requestWorkflow = pendingReply;");
  const priorRequest = app.run('dispatchWorkflow("chat", null, "它是人造的吗？")');
  app.run("const priorController = state.workflow.activeController; els.playerInput.value = getCurrentRiddle().answer;");
  await app.run("sendQuestion()");
  assert.equal(app.run("priorController.signal.aborted"), true);
  resolveReply({ai_reply_text: "迟到的旧回复", game_status: "playing"});
  await priorRequest;
  assert.equal(app.run("state.game.status"), "victory");
  assert.equal(app.run("state.workflow.hostSpeech.source"), "victory");
  assert.equal(app.run("state.game.history.length"), 1);
});

test("queued questions show one bubble and do not add a host acknowledgement", async () => {
  const app = client();
  app.run(`
    state.workflow.hostSpeech.voicePlaying = true;
    state.host.text = "上一句主持话术";
    els.playerInput.value = "它是人造的吗？";
    const dispatched = [];
    dispatchWorkflow = async (...args) => dispatched.push(args);
  `);
  await app.run("sendQuestion()");
  assert.equal(app.run("state.game.status"), "playing");
  assert.equal(app.run("state.host.text"), "上一句主持话术");
  assert.equal(app.run("state.workflow.deferredHostReplies.length"), 0);
  assert.equal(app.run("bubbles.length"), 1);
  app.advance(12000);
  app.run("state.workflow.hostSpeech.voicePlaying = false;");
  await app.run("processNextPendingChat()");
  assert.equal(app.run("bubbles.length"), 1);
  assert.equal(app.run("dispatched.length"), 1);
  assert.equal(app.run('diagnostics.find(d => d.stage === "dispatched").elapsed_ms'), 12000);
});

test("correct text cannot bypass manual or safety pause", async () => {
  for (const mode of ["safety_pause", "normal"]) {
    const app = client();
    app.run(`state.game.status="paused"; state.ui.cabinMode=${JSON.stringify(mode)};
      els.playerInput.value=getCurrentRiddle().answer;`);
    await app.run("sendQuestion()");
    assert.equal(app.run("state.game.status"), "paused");
    assert.equal(app.run("state.ui.showAnswer"), false);
    assert.equal(app.run("bubbles.length"), 0);
  }
});
