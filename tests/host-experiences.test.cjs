const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");
const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8").replace(/\nboot\(\);\s*$/, "\n");

function client(storage = new Map()) {
  let now = 100000, id = 0;
  const timers = new Map();
  const schedule = (fn, delay) => { timers.set(++id, { fn, delay }); return id; };
  const context = vm.createContext({ structuredClone, console, crypto: webcrypto, AbortController,
    Date: class extends Date { static now() { return now; } }, cancelAnimationFrame() {},
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    window: { setTimeout: schedule, clearTimeout: id => timers.delete(id) },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  vm.runInContext(source, context);
  vm.runInContext('render = () => {}; state.host.text = ""; state.game.status = "victory"; requestWorkflow = () => new Promise(() => {});', context);
  return { context, run: code => vm.runInContext(code, context),
    value: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
    advance(ms) { now += ms; },
    fire(code) { const id = vm.runInContext(code, context); const timer = timers.get(id); assert.ok(timer); timers.delete(id); timer.fn(); } };
}

test("real outcomes produce six-question milestones once, and timeouts break consecutive wins", () => {
  const app = client();
  const feedback = [];
  for (let round = 1; round <= 6; round++) {
    app.run(`state.game.roundIndex = ${round}; globalThis.feedback = recordRoundOutcome("front");`);
    feedback.push(app.value("feedback"));
    assert.equal(app.run('recordRoundOutcome("front")'), null);
  }
  assert.ok(feedback[0].candidate_ids.includes("HK13"));
  assert.ok(feedback[1].candidate_ids.includes("HK11"));
  assert.ok(feedback[4] === null);
  assert.deepEqual(feedback[5].candidate_ids, ["HK12", "HK10"]);
  assert.equal(app.value("getSummarySolvedCount()"), 6);
  assert.equal(app.value("getSummaryMvpSeat()"), "front");
  app.run('state.game.roundIndex = 7; recordRoundOutcome(); state.game.roundIndex = 8; recordRoundOutcome("front");');
  assert.equal(app.value("getPerformanceSnapshot().streak_count"), 1);
  assert.equal(app.value("getPerformanceSnapshot().per_seat_correct.front"), 7);
});

test("two unsolved rounds support comeback and only confirmed facts establish teamwork", () => {
  const app = client();
  app.run('recordRoundOutcome(); state.game.roundIndex = 2; recordRoundOutcome(); state.game.roundIndex = 3;');
  app.run(`state.game.roundQuestionPlan = {steps:[{factKey:"shape"},{factKey:"size"}]};
    const input = {trigger_type:"chat",game:{status:"playing"},round_id:getDifyRoundScopeKey(),passengers:{selected_seat:"rearLeft"}};
    recordQuestionContribution({ai_reply_text:"不是",covered_fact_keys:[]},input);
    recordQuestionContribution({covered_fact_keys:["unapproved"]},input);`);
  assert.equal(app.value("Object.keys(state.game.performance.contributions).length"), 0);
  app.run('recordQuestionContribution({covered_fact_keys:["shape"]},input); globalThis.feedback = recordRoundOutcome("front");');
  assert.deepEqual(app.value("feedback.candidate_ids"), ["HK14", "HK17", "HK13"]);
  assert.deepEqual(app.value("feedback.contributors"), ["rearLeft", "front"]);
});

test("preferences persist, suppress automatic praise and invitations, while explicit praise stays explicit", () => {
  const storage = new Map();
  const app = client(storage);
  app.run('updateHostPreferences("不用总夸我，少说点，别邀请别人，让我自己想想");');
  assert.deepEqual(app.value("state.host.preferences"), { praise: false, brief: true, invitations: false, independent: true });
  assert.equal(app.run('recordRoundOutcome("front")'), null);
  assert.equal(app.run('isExplicitPraiseRequest("不要夸我")'), false);
  assert.equal(app.run('isExplicitPraiseRequest("现在夸一下我")'), true);
  assert.deepEqual(client(storage).value("state.host.preferences"), app.value("state.host.preferences"));
  app.run('updateHostPreferences("可以主动夸，可以邀请，一起想，多说一点");');
  assert.deepEqual(app.value("state.host.preferences"), { praise: true, brief: false, invitations: true, independent: false });
});

test("post-result feedback waits for P0, has a factual timeout fallback and holds the round until displayed", () => {
  const app = client();
  app.run('publishHostLine("答案揭晓",{priority:"P0",source:"victory"}); startResultFeedback(recordRoundOutcome("front"));');
  assert.equal(app.value("state.host.text"), "答案揭晓");
  app.advance(6040);
  app.fire("state.workflow.hostSpeech.timer");
  app.fire("state.workflow.resultFeedback.timer");
  app.advance(1500);
  app.fire("state.workflow.resultFeedback.timer");
  assert.equal(app.value("state.workflow.hostSpeech.source"), "post_result_feedback");
  assert.match(app.value("state.host.text"), /副驾/);
  app.run("advanceAfterVictory(1)");
  assert.equal(app.value("state.game.roundIndex"), 1);
  assert.equal(app.value("state.game.performance.lastFeedbackRound"), 1);
  app.run('clearResultFeedback(); state.game.roundIndex = 2; globalThis.feedback = recordRoundOutcome("front");');
  assert.equal(app.value("feedback"), null);
});

test("a new P0 invalidates pending feedback and model results cannot resurrect it", async () => {
  const app = client();
  let resolve;
  app.context.capture = () => new Promise(done => { resolve = done; });
  app.run('requestWorkflow = capture; startResultFeedback(recordRoundOutcome("front")); globalThis.entry = state.workflow.resultFeedback; invalidateAsyncHostResults();');
  resolve({ ai_reply_text: "过时的表扬", scene_output: {} });
  await Promise.resolve();
  assert.equal(app.value("state.workflow.resultFeedback"), null);
  app.run("showResultFeedback(entry)");
  assert.equal(app.value("state.host.text"), "");
});
