const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8")
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, "\n");

function client() {
  let now = 100000;
  let nextTimer = 0;
  const timers = new Map();
  const schedule = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, dueAt: now + delay });
    return id;
  };
  const cancel = id => timers.delete(id);
  const context = vm.createContext({
    structuredClone,
    crypto: webcrypto,
    console,
    AbortController,
    Date: class extends Date { static now() { return now; } },
    setTimeout: schedule,
    clearTimeout: cancel,
    window: { addEventListener() {}, setTimeout: schedule, clearTimeout: cancel },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(source, context);
  return {
    run: code => vm.runInContext(code, context),
    value: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.dueAt <= target)
          .sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
        if (!next) break;
        now = next[1].dueAt;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
  };
}

test("the five current golden lines use the specified start and preparation-preview environments", () => {
  const app = client();
  assert.deepEqual(app.value("GOLDEN_TIMELINES.map(line => [line.name, line.environment, line.previewEnvironment])"), [
    ["城市风景亲子游", "车库", "城区晴天白天"],
    ["赛博城市朋友夜游", "城区夜晚", "城区夜晚"],
    ["雪景雨天长辈同行", "风景区雪景白天", "风景区雪景白天"],
    ["傍晚深夜家庭返程", "风景区傍晚", "风景区傍晚"],
    ["风景归城家人同行", "风景区晴天白天", "风景区晴天白天"],
  ]);
  assert.equal(app.run("GOLDEN_TIMELINES.length"), 5);
  assert.equal(app.run('GOLDEN_TIMELINES.every(line => !("rounds" in line) && line.durationMs === 300000)'), true);
  assert.equal(app.run("QUESTION_DURATION_MS"), 90000);
});

test("scenario persona configuration keeps the front seat real and the baby non-speaking", () => {
  const app = client();
  const d = app.value('getPassengerPersonas("父母+小孩", GOLDEN_TIMELINES[3])');
  assert.equal(d.front.is_real_user, true);
  assert.equal(d.front.can_guess, true);
  assert.equal(d.rear_right.role, "婴儿");
  assert.equal(d.rear_right.can_guess, false);
  assert.match(d.rear_right.persona, /不生成完整发言/);
  assert.equal(d.rear_left.role, "妈妈");
});

test("experience schedules trigger only real events and environment changes, never reference dialogue", () => {
  const app = client();
  const allowed = new Set([
    "environment_change", "hard_brake", "temporary_interruption", "driver_tired",
    "passenger_sleep", "passenger_wake", "cabin_laughing", "near_destination", "speed_overspeed",
  ]);
  const lines = app.value("GOLDEN_TIMELINES");
  const steps = lines.flatMap(line => line.steps);
  assert.ok(steps.every(step => allowed.has(step.type)));
  assert.ok(steps.every(step => step.delay >= 0 && step.delay <= 300000));
  assert.ok(steps.every(step => !("text" in step) && !("player_input" in step)));
  for (const line of lines) {
    assert.equal(line.steps.at(-1).delay, 280000);
    assert.ok(line.steps.every((step, index) => index === 0 || step.delay - line.steps[index - 1].delay >= 5000));
  }
});

test("scheduled line environments are available in the cabin environment map", () => {
  const app = client();
  assert.equal(app.run(`GOLDEN_TIMELINES.every(line => [line.environment, line.previewEnvironment,
    ...line.steps.filter(step => step.type === "environment_change").map(step => step.value)]
    .every(environment => Boolean(RESOURCE_CONFIG.environments[environment])))`), true);
});

function startRecordedExperience(app) {
  app.run(`
    var fired = [];
    render = () => {};
    runRoundTimelineStep = async step => { fired.push({ type: step.type, at: simulationRuntime.now(), round: state.game.roundIndex }); };
    state.game.status = "playing";
    startGoldenExperience();
  `);
}

test("scene events survive question completion and keep their original due times", () => {
  const app = client();
  startRecordedExperience(app);
  const startedAt = app.run("goldenExperience.startedAt");
  app.advance(12000);
  app.run('finishTimelineSilently(); state.game.roundIndex = 2; state.game.status = "playing"; startGoldenExperience();');
  assert.equal(app.run("goldenExperience.startedAt"), startedAt);
  app.advance(8000);
  assert.deepEqual(app.value("fired"), [{ type: "environment_change", at: startedAt + 20000, round: 2 }]);
  app.advance(100000);
  assert.equal(app.run("fired[1].at"), startedAt + 120000);
});

test("cabin events continue during game safety pause, but full simulation pause freezes the trip clock", () => {
  const app = client();
  startRecordedExperience(app);
  app.advance(10000);
  app.run('state.game.status = "paused"; simulationRuntime.pause();');
  app.advance(60000);
  assert.equal(app.run("fired.length"), 0);
  app.run("simulationRuntime.resume()");
  app.advance(9999);
  assert.equal(app.run("fired.length"), 0);
  app.advance(1);
  assert.equal(app.run("fired.length"), 1);
  assert.equal(app.run("state.game.status"), "paused");
});

test("automatic questions and scene events share a five-second minimum dispatch gap", () => {
  const app = client();
  startRecordedExperience(app);
  app.advance(19000);
  app.run("lastPresetStartedAt = simulationRuntime.now()");
  app.advance(4999);
  assert.equal(app.run("fired.length"), 0);
  app.advance(1);
  assert.equal(app.run("fired[0].at"), 124000);
  assert.equal(app.run("presetStepWaitMs(simulationRuntime.now())"), 5000);
});

test("the real round-question loop reserves the shared dispatch slot without resetting the trip clock", async () => {
  const app = client();
  startRecordedExperience(app);
  app.run(`
    stopGoldenExperience();
    GOLDEN_TIMELINES[0].steps = [{ delay: 12000, type: "environment_change", label: "scene" }];
    ROUND_GOLDEN_TIMELINES[0].steps = [
      { delay: 10000, type: "passenger_question", label: "question1" },
      { delay: 20000, type: "passenger_question", label: "question2" }
    ];
    ensureCurrentRoundPreparation = () => ({ timelineId: ROUND_GOLDEN_TIMELINES[0].id });
    startGame = async () => {};
    waitUntilRoundTimelineReady = async () => {};
    startQuestionClock = () => {};
    startQuestionIntro = () => {};
    var questionLoop = startRoundGoldenTimeline();
  `);
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  await flush();
  app.advance(10000);
  await flush();
  assert.equal(app.run("lastPresetStartedAt"), 110000);
  app.advance(2000);
  await flush();
  assert.equal(app.run("fired.length"), 1);
  app.advance(3000);
  await flush();
  app.advance(5000);
  await flush();
  await app.run("questionLoop");
  assert.deepEqual(app.value("fired.map(event => [event.type, event.at])"), [
    ["passenger_question", 110000], ["environment_change", 115000], ["passenger_question", 120000],
  ]);
});

test("late scene events are spaced rather than dispatched in a catch-up burst", () => {
  const app = client();
  app.run(`GOLDEN_TIMELINES[0].steps = [
    { delay: 20000, type: "environment_change", label: "first" },
    { delay: 25000, type: "passenger_sleep", label: "second" }
  ]`);
  startRecordedExperience(app);
  app.advance(19000);
  app.run("lastPresetStartedAt = simulationRuntime.now() + 10000");
  app.advance(20000);
  assert.deepEqual(app.value("fired.map(event => event.at)"), [134000, 139000]);
});

test("slow or failed event replies do not block subsequent scene events", async () => {
  const app = client();
  startRecordedExperience(app);
  app.run("runRoundTimelineStep = step => { fired.push(step.type); return new Promise(() => {}); }");
  app.advance(120000);
  assert.equal(app.run("fired.length"), 2);
  app.run("runRoundTimelineStep = async () => { throw new Error('synthetic failure'); }");
  app.advance(20000);
  await Promise.resolve();
  assert.equal(app.run("goldenExperience.nextIndex"), 3);
  assert.notEqual(app.run("goldenExperience.timer"), null);
});

test("the five-minute window ends without changing questions or restarting on later rounds", () => {
  const app = client();
  startRecordedExperience(app);
  app.advance(300000);
  assert.equal(app.run("goldenExperience.completed"), true);
  assert.equal(app.run("state.game.roundIndex"), 1);
  assert.equal(app.run("state.game.status"), "playing");
  assert.equal(app.run("fired.length"), 8);
  app.run("state.game.roundIndex = 5; startGoldenExperience()");
  app.advance(300000);
  assert.equal(app.run("fired.length"), 8);
});

test("reset cancels old scene timers and a new game starts a fresh trip clock", () => {
  const app = client();
  startRecordedExperience(app);
  app.advance(19000);
  app.run("stopGoldenExperience()");
  app.advance(100000);
  assert.equal(app.run("fired.length"), 0);
  app.run('state.workflow.gameId = "new-game"; startGoldenExperience()');
  app.advance(20000);
  assert.equal(app.run("fired.length"), 1);
  assert.equal(app.run("goldenExperience.startedAt"), 219000);
});

test("an early game summary cancels remaining scene events", () => {
  const app = client();
  startRecordedExperience(app);
  app.run('state.game.status = "summary"');
  app.advance(300000);
  assert.equal(app.run("fired.length"), 0);
  assert.equal(app.run("goldenExperience"), null);
});

test("the editable document has no round bindings or expected-behavior columns and keeps five-second spacing", () => {
  const app = client();
  const doc = fs.readFileSync(require.resolve("../docs/GOLDEN_EXPERIENCE_LINES_V2_DRAFT.md"), "utf8");
  assert.doesNotMatch(doc, /\| 题段 \||\| R[123] \||\| 预期行为与验收/);
  const groups = new Map();
  for (const row of doc.split("\n")) {
    const match = row.match(/^\| ([A-E])\d{2} \| (\d{2}):(\d{2}) \| ([^|]+) \|/);
    if (!match) continue;
    const rows = groups.get(match[1]) || [];
    rows.push({ time: Number(match[2]) * 60 + Number(match[3]), type: match[4].trim() });
    groups.set(match[1], rows);
  }
  assert.equal(groups.size, 5);
  [...groups.values()].forEach((rows, index) => {
    assert.equal(rows[0].time, 0);
    assert.equal(rows.at(-1).time, 280);
    assert.ok(rows.every((row, i) => i === 0 || row.time - rows[i - 1].time >= 5));
    assert.deepEqual(rows.filter(row => row.time && ["座舱事件", "环境切换"].includes(row.type)).map(row => row.time),
      app.value(`GOLDEN_TIMELINES[${index}].steps.map(step => step.delay / 1000)`));
  });
});
