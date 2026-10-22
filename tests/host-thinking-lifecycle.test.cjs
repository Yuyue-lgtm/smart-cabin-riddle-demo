const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");

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
    requestAnimationFrame: schedule, cancelAnimationFrame() {},
    window: { addEventListener() {}, setTimeout: schedule, clearTimeout: (id) => timers.delete(id) },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(source, context);
  vm.runInContext('render = () => {}; state.host.text = ""; state.game.status = "playing";', context);
  return { context, timers, advance(ms) { now += ms; },
    run: (code) => vm.runInContext(code, context),
    value: (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
  };
}

function startThinking(app) {
  app.run('const requestId = beginWorkflowRequest({trigger_type:"chat"});');
  app.timers.get(app.value("state.workflow.hostThinkingTimer")).callback();
  app.run(`
    hostSprite.source = RESOURCE_CONFIG.host.thinking.src;
    hostSprite.thinkingCycleId = state.workflow.hostThinkingCycleId;
    hostSprite.playing = true;
    hostSprite.loading = false;
  `);
}

test("a new answer bubble cannot interrupt and later restart an already-playing thought", () => {
  const app = client();
  startThinking(app);
  app.advance(2800);
  app.run(`
    finishWorkflowRequest(requestId);
    state.host.text = "这是这道题的回复";
    state.workflow.hostSpeech.visibleAt = Date.now();
  `);
  assert.equal(app.value("getHostPresentation().mediaHostState"), "thinking");
  assert.equal(app.value("getHostPresentation().hostBubbleHidden"), false);
  app.advance(1000);
  assert.equal(app.value("getHostPresentation().mediaHostState"), "thinking");
  app.run(`
    drawHostSpriteFrame = () => {};
    hostSprite.totalDurationMs = 4000;
    hostSprite.elapsedMs = 4000;
    stepHostSprite(1000);
  `);
  assert.equal(app.value("state.workflow.hostThinkingActive"), false);
  assert.equal(app.value("getHostPresentation().mediaHostState"), "speak");
  app.advance(6000);
  app.run('state.host.text = ""; resetHostSprite();');
  assert.equal(app.value("getHostPresentation().mediaHostState"), "normal");
});

test("an orphaned thinking flag cannot start an animation after a reply", () => {
  const app = client();
  app.run('state.workflow.hostThinkingActive = true; state.host.avatarState = "thinking";');
  assert.equal(app.value("getHostPresentation().mediaHostState"), "normal");
});

test("a fast reply cancels thinking even if its timer callback was already queued", () => {
  const app = client();
  app.run('const requestId = beginWorkflowRequest({trigger_type:"chat"});');
  const timer = app.timers.get(app.value("state.workflow.hostThinkingTimer"));
  app.run('stopWaitingForHostReply(requestId);');
  timer.callback();
  assert.equal(app.value("state.workflow.hostThinkingActive"), false);
  assert.equal(app.value("state.workflow.hostThinkingCycleId"), 0);
  assert.equal(app.value("getHostPresentation().hostThinking"), false);
});

test("a thinking image that loads after the answer cannot begin playback", async () => {
  const app = client();
  let releaseImage;
  app.context.pendingImage = () => new Promise((resolve) => { releaseImage = resolve; });
  app.run(`
    const requestId = beginWorkflowRequest({trigger_type:"chat"});
    loadHostSpriteImage = pendingImage;
  `);
  app.timers.get(app.value("state.workflow.hostThinkingTimer")).callback();
  const loading = app.run('loadHostSprite(RESOURCE_CONFIG.host.thinking)');
  assert.equal(app.value("hostSprite.loading"), true);
  app.run('stopWaitingForHostReply(requestId);');
  releaseImage({});
  await loading;
  assert.equal(app.value("hostSprite.playing"), false);
  assert.equal(app.value("hostSprite.source"), "");
  assert.equal(app.value("state.workflow.hostThinkingActive"), false);
});

test("events and aborted or superseded chat timers never start thinking", () => {
  const app = client();
  app.run('const eventRequest = beginWorkflowRequest({trigger_type:"event"});');
  assert.equal(app.value("state.workflow.hostThinkingTimer"), null);
  app.run('finishWorkflowRequest(eventRequest); const oldRequest = beginWorkflowRequest({trigger_type:"chat"});');
  const oldTimer = app.timers.get(app.value("state.workflow.hostThinkingTimer"));
  app.run('abortActiveWorkflow();');
  oldTimer.callback();
  assert.equal(app.value("state.workflow.hostThinkingActive"), false);
  app.run('const newRequest = beginWorkflowRequest({trigger_type:"chat"});');
  oldTimer.callback();
  assert.equal(app.value("state.workflow.hostThinkingActive"), false);
  app.timers.get(app.value("state.workflow.hostThinkingTimer")).callback();
  assert.equal(app.value("state.workflow.hostThinkingActive"), true);
});

test("existing host bubbles keep their minimum visible time before new thinking", () => {
  const app = client();
  app.run(`
    state.host.text = "上一句话";
    state.workflow.hostSpeech.visibleAt = Date.now();
    const requestId = beginWorkflowRequest({trigger_type:"chat"});
  `);
  assert.equal(app.timers.get(app.value("state.workflow.hostThinkingTimer")).delay, 1500);
  assert.equal(app.value("getHostPresentation().hostBubbleHidden"), false);
  app.advance(1500);
  app.timers.get(app.value("state.workflow.hostThinkingTimer")).callback();
  assert.equal(app.value("getHostPresentation().mediaHostState"), "thinking");
  assert.equal(app.value("getHostPresentation().hostBubbleHidden"), true);
});

test("a following chat reuses an unfinished thought without starting a second cycle", () => {
  const app = client();
  startThinking(app);
  app.run('finishWorkflowRequest(requestId); const followingRequest = beginWorkflowRequest({trigger_type:"chat"});');
  app.timers.get(app.value("state.workflow.hostThinkingTimer")).callback();
  assert.equal(app.value("state.workflow.hostThinkingCycleId"), 1);
  assert.equal(app.value("hostSprite.playing"), true);
  app.run('stopWaitingForHostReply(requestId);');
  assert.equal(app.value("state.workflow.hostAwaitingReply"), true);
  app.run('finishWorkflowRequest(followingRequest);');
  assert.equal(app.value("state.workflow.hostAwaitingReply"), false);
});

test("new chat thinking cannot hide a still-active six-second bubble", () => {
  const app = client();
  app.run('publishHostLine("这句回答要说完",{source:"chat",priority:"P2",durationMs:6000}); state.workflow.hostSpeech.visibleAt=Date.now();');
  app.advance(500);
  app.run('beginWorkflowRequest({trigger_type:"chat"});');
  assert.equal(app.timers.get(app.value('state.workflow.hostThinkingTimer')).delay, 5500);
  app.advance(2000);
  assert.equal(app.value('getHostPresentation().hostBubbleHidden'), false);
});

test("voice synthesis and playback keep the host busy and defer thinking until speech ends", () => {
  const app = client();
  assert.equal(app.value('isHostBusy()'), false);
  app.run('state.host.text="正在说的回答"; state.workflow.hostSpeech.voicePending=true;');
  assert.equal(app.value('isHostBusy()'), true);
  app.run('const requestId=beginWorkflowRequest({trigger_type:"chat"});');
  const pendingTimer = app.timers.get(app.value('state.workflow.hostThinkingTimer'));
  app.advance(pendingTimer.delay);
  pendingTimer.callback();
  assert.equal(app.value('state.workflow.hostThinkingActive'), false);
  app.run('state.workflow.hostSpeech.voicePending=false; state.workflow.hostSpeech.voicePlaying=true;');
  assert.equal(app.value('isHostBusy()'), true);
  const playingTimer = app.timers.get(app.value('state.workflow.hostThinkingTimer'));
  app.advance(playingTimer.delay);
  playingTimer.callback();
  assert.equal(app.value('state.workflow.hostThinkingActive'), false);
  app.run('state.workflow.hostSpeech.voicePlaying=false;');
  const followingTimer = app.timers.get(app.value('state.workflow.hostThinkingTimer'));
  app.advance(followingTimer.delay);
  followingTimer.callback();
  assert.equal(app.value('state.workflow.hostThinkingActive'), true);
  app.run('finishWorkflowRequest(requestId);');
  assert.equal(app.value('isHostBusy()'), false);
});
