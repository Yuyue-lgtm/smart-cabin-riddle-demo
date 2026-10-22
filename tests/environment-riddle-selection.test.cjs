const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../client-app.js'), 'utf8')
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, '\n');

function client() {
  let now = 100000, id = 0;
  const timers = new Map(), requests = [];
  const schedule = (callback, delay) => { timers.set(++id, { callback, at: now + delay }); return id; };
  const context = vm.createContext({
    structuredClone, AbortController, crypto: webcrypto, console: { ...console, info() {}, warn() {} },
    Date: class extends Date { static now() { return now; } },
    setTimeout: schedule, clearTimeout: handle => timers.delete(handle), cancelAnimationFrame() {},
    window: { setTimeout: schedule, clearTimeout: handle => timers.delete(handle) },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: (_url, options) => new Promise(resolve => requests.push({
      input: JSON.parse(JSON.parse(options.body).input_payload), signal: options.signal, resolve,
    })),
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('render=()=>{}; applyGoldenLineDefaults(); state.game.status="playing"; state.game.playedRiddleIndices=[state.game.currentRiddleIndex]; const first=ensureCurrentRoundPreparation(); prepareFollowingRound(first);');
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    now = end;
  }
  return { run, requests, advance, value: code => JSON.parse(run(`JSON.stringify(${code})`)) };
}

function reply(request, question = '它是人造的吗？') {
  const input = request.input;
  request.resolve({ ok: true, json: async () => ({ route: 'preview', game_id: input.game_id,
    round_id: input.round_id, scene_version: input.scene_version, event_type: input.event.type, event_id: input.event.id,
    workflow_output: JSON.stringify({ round_question_plan: { plan_id: input.round_id, steps: [
      { id: 'category', fact_key: 'category', variants: { default: question } },
      { id: 'location', fact_key: 'location', depends_on: ['category'], variants: { default: '它常见于室内吗？' } },
    ] } }),
  }) });
}

test('weather matches before place, and garage/tunnel do not force a puzzle', () => {
  const app = client();
  assert.deepEqual(app.value('getEnvironmentRiddleCandidates("城区雨天白天").map(i=>RIDDLES[i].answer)'), ['雨伞', '红绿灯']);
  assert.deepEqual(app.value('getEnvironmentRiddleCandidates("风景区雪景白天").map(i=>RIDDLES[i].answer)'), ['雪人', '草原']);
  assert.deepEqual(app.value('getEnvironmentRiddleCandidates("隧道")'), []);
  assert.deepEqual(app.value('getEnvironmentRiddleCandidates("车库")'), []);
});

test('selection skips all played puzzles and uses normal unused order when no suitable match remains', () => {
  const app = client();
  app.run('state.game.playedRiddleIndices=[1,0,6];');
  assert.equal(app.run('selectNextRiddleIndex(1,"城区雨天白天")'), 2);
  app.run('state.game.playedRiddleIndices=[1,2,3,4,5,6,7,8,9];');
  assert.equal(app.run('selectNextRiddleIndex(9,"隧道")'), 0);
  app.run('state.game.playedRiddleIndices=RIDDLES.map((_,i)=>i);');
  assert.equal(app.run('selectNextRiddleIndex(9,"城区晴天白天")'), null);
});

test('changing environment leaves the active puzzle, hints, facts, counts and preview intact', () => {
  const app = client();
  app.run('state.game.questionCount=7; state.game.publicClues=["公开线索"]; state.game.coveredFactKeys=["category"]; state.game.roundQuestionPlan={id:"active"};');
  const before = app.value('[state.game, getCurrentRiddle(), first]');
  app.run('setEnvironment("城区雨天白天");');
  app.advance(800);
  assert.deepEqual(app.value('[state.game, getCurrentRiddle(), first]'), before);
  assert.equal(app.requests[0].signal.aborted, false);
  assert.equal(app.requests.length, 3);
  assert.equal(app.requests[2].input.game.current_answer, '雨伞');
  assert.equal(app.requests[2].input.car.environment, '城区雨天白天');
});

test('rapid changes debounce to the latest environment, preserving the chosen timeline', () => {
  const app = client();
  const timeline = app.run('roundQuestionPreparations.get(state.workflow.gameId+"-round-2").timelineId');
  app.run('setEnvironment("城区雨天白天");'); app.advance(500);
  app.run('setEnvironment("风景区雪景白天");'); app.advance(799);
  assert.equal(app.requests.length, 2);
  app.advance(1);
  assert.equal(app.requests.length, 3);
  assert.equal(app.requests[2].input.game.current_answer, '雪人');
  assert.equal(app.requests[1].signal.aborted, true);
  assert.equal(app.run('roundQuestionPreparations.get(state.workflow.gameId+"-round-2").timelineId'), timeline);
});

test('same selected puzzle reuses pending preview despite a different environment or repeated refresh', () => {
  const app = client();
  app.run('setEnvironment("城区雨天白天");'); app.advance(800);
  app.run('setEnvironment("高速路雨天白天");'); app.advance(800);
  app.run('refreshFollowingRoundPreparation();');
  assert.equal(app.requests.length, 3);
  assert.equal(app.requests[2].signal.aborted, false);
});

test('the last question never prepares an extra question on environmental changes', () => {
  const app = client();
  app.run('state.game.roundIndex=state.game.totalRounds; setEnvironment("风景区雪景白天");');
  app.advance(800);
  assert.equal(app.requests.length, 2);
  assert.equal(app.run('state.workflow.nextRiddleRefreshTimer'), null);
  assert.equal(app.run('state.game.currentRiddleIndex'), 1);
});

test('replaced previews cannot overwrite their replacement even when their response arrives last', async () => {
  const app = client();
  app.run('const old=roundQuestionPreparations.get(state.workflow.gameId+"-round-2"); setEnvironment("城区雨天白天");');
  app.advance(800);
  app.run('const replacement=roundQuestionPreparations.get(state.workflow.gameId+"-round-2");');
  reply(app.requests[2], '它可以挡雨吗？'); await app.run('replacement.promise');
  reply(app.requests[1], '它可以砍东西吗？'); await app.run('old.promise');
  assert.equal(app.run('old.status'), 'cancelled');
  assert.equal(app.run('replacement.plan.steps[0].variants.default'), '它可以挡雨吗？');
  assert.equal(app.run('state.game.roundQuestionPlan'), null);
  app.run('state.game.roundIndex=2; state.game.currentRiddleIndex=replacement.riddleIndex; applyPreparedRoundPlan(replacement);');
  assert.equal(app.run('state.game.roundQuestionPlan.steps[0].variants.default'), '它可以挡雨吗？');
});

for (const outcome of ['Victory', 'Timeout']) {
  test(`${outcome} locks the latest environment at the boundary without waiting for its preview`, () => {
    const app = client();
    app.run(`
      startRoundGoldenTimeline=async()=>{};
      clearHostSpeechLock(); state.host.text="";
      state.game.status=${JSON.stringify(outcome === 'Victory' ? 'victory' : 'failed')};
      setEnvironment("风景区雪景白天");
      advanceAfter${outcome}(1);
    `);
    assert.equal(app.run('state.game.roundIndex'), 2);
    assert.equal(app.run('getCurrentRiddle().answer'), '雪人');
    assert.equal(app.run('state.game.roundQuestionPlan'), null);
    assert.equal(app.run('state.workflow.nextRiddleRefreshTimer'), null);
    assert.equal(app.requests[2].input.game.round_index, 2);
    assert.equal(app.requests[2].input.game.current_answer, '雪人');
    app.advance(800);
    assert.equal(app.requests.length, 3);
  });
}

test('after a question begins, later changes can only replace the following question', () => {
  const app = client();
  app.run('setEnvironment("风景区雪景白天");'); app.advance(800);
  app.run(`
    state.game.roundIndex=2; state.game.currentRiddleIndex=5;
    state.game.playedRiddleIndices.push(5);
    const second=ensureCurrentRoundPreparation(); prepareFollowingRound(second);
    setEnvironment("城区雨天白天");
  `);
  app.advance(800);
  assert.equal(app.run('getCurrentRiddle().answer'), '雪人');
  assert.equal(app.requests.at(-1).input.game.round_index, 3);
  assert.equal(app.requests.at(-1).input.game.current_answer, '雨伞');
});

test('manual freeze parks environment selection and safety pauses still permit future preparation', () => {
  const app = client();
  app.run('setEnvironment("城区雨天白天"); simulationRuntime.pause();');
  app.advance(9000); assert.equal(app.requests.length, 2);
  app.run('simulationRuntime.resume(); state.game.status="paused";');
  app.advance(799); assert.equal(app.requests.length, 2);
  app.advance(1); assert.equal(app.requests.length, 3);
  assert.equal(app.run('state.game.currentRiddleIndex'), 1);
  assert.equal(app.run('state.game.status'), 'paused');
});

test('reset cancels pending selection, clears played history and does not alter next-game preparation', () => {
  const app = client();
  app.run('setEnvironment("城区雨天白天"); const oldGame=state.workflow.gameId; applyGoldenLineDefaults();');
  const count = app.requests.length;
  app.advance(800);
  assert.equal(app.requests.length, count);
  assert.deepEqual(app.value('state.game.playedRiddleIndices'), []);
  assert.notEqual(app.run('state.workflow.gameId'), app.run('oldGame'));
  app.run('state.game.status="summary"; prepareNextGameFirstRound(); const reserved=nextGamePreparation; setEnvironment("风景区雪景白天");');
  const summaryCount = app.requests.length;
  app.advance(800);
  assert.equal(app.requests.length, summaryCount);
  assert.equal(app.run('nextGamePreparation===reserved'), true);
});

test('a changing environment still yields six unique puzzles in one complete game', async () => {
  const app = client();
  app.run(`
    startRoundGoldenTimeline=async()=>{await startGame();};
    dispatchWorkflow=async()=>{state.game.status="playing";};
    const seen=[state.game.currentRiddleIndex];
  `);
  const environments = ['风景区雪景白天', '城区雨天白天', '城区晴天白天', '高速路晴天白天', '风景区晴天白天', '隧道', '车库', '城区雨天白天', '风景区雪景白天'];
  for (let index = 0; index < app.run('state.game.totalRounds') - 1; index++) {
    app.run(`setEnvironment(${JSON.stringify(environments[index])});`);
    app.advance(800);
    app.run(`clearHostSpeechLock(); state.workflow.pendingChats=[]; state.game.status="failed"; advanceAfterTimeout(${index + 1}); seen.push(state.game.currentRiddleIndex);`);
    await Promise.resolve();
  }
  assert.equal(app.run('seen.length'), 6);
  assert.equal(app.run('new Set(seen).size'), 6);
  assert.equal(app.run('state.game.playedRiddleIndices.length'), 6);
  assert.equal(app.run('state.game.roundIndex'), 6);
  assert.equal(app.run('prepareFollowingRound({roundIndex:6,riddleIndex:state.game.currentRiddleIndex})'), null);
});
