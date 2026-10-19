const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../client-app.js'), 'utf8').replace(/\nboot\(\);\s*$/, '\n');

function client() {
  let now = 100000, id = 0;
  const timers = new Map();
  const schedule = (callback, delay) => { timers.set(++id, { callback, delay }); return id; };
  const context = vm.createContext({ structuredClone, crypto: webcrypto, AbortController, console: { ...console, info() {}, warn() {} },
    Date: class extends Date { static now() { return now; } }, cancelAnimationFrame() {},
    setTimeout: schedule, clearTimeout: key => timers.delete(key),
    window: { setTimeout: schedule, clearTimeout: key => timers.delete(key) },
    localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run(`render=()=>{}; state.game.status="playing"; state.timeline.status="running"; state.host.text="";
    state.timeline.startedAt=Date.now()-5000; questionClock.active=true; questionClock.startedAt=Date.now()-5000;
    questionClock.roundIndex=1;
    function command(line, paused, extra={}) {
      const input=buildWorkflowInput("chat",null,line);
      const output={intent:"game_related_chat",reply_mode:"chat_only",ai_reply_text:paused?"我来暂停游戏。":"我来继续游戏。",
        game_status:input.game.status,is_correct:false,covered_fact_keys:[],decision_trace:{guard_status:"passed"},
        execution:{actions:[{type:"game.set_paused",paused}]},
        _bff:{route:"chat",game_id:input.game_id,round_id:input.round_id,scene_version:input.scene_version},...extra};
      applyWorkflowOutput(output,input,"chat"); return input;
    }`);
  return { run, context, value: code => JSON.parse(run(`JSON.stringify(${code})`)), advance(ms) { now += ms; },
    fire(code) { const task = timers.get(run(code)); assert.ok(task, code); task.callback(); } };
}

test('game control recognizes explicit and short commands but not negatives, quotes, music or puzzle questions', () => {
  const app = client();
  for (const line of ['暂停游戏', '帮我暂停一下游戏', '游戏先暂停', '暂停一下']) assert.equal(app.run(`authorizedGamePause(${JSON.stringify(line)})`), true);
  for (const line of ['继续游戏', '恢复游戏', '接着玩', '继续吧']) assert.equal(app.run(`authorizedGamePause(${JSON.stringify(line)})`), false);
  for (const line of ['不要暂停游戏', '别继续游戏', '我不想继续游戏', '我不愿暂停游戏', '要不要暂停游戏', '如何暂停游戏', '如果暂停游戏会怎样', '他说“暂停游戏”', '它能暂停游戏吗', '暂停背景音乐', '暂停游戏然后继续游戏'])
    assert.equal(app.run(`authorizedGamePause(${JSON.stringify(line)})`), null, line);
});

test('pause and continue preserve puzzle, counts, facts and exact remaining time', () => {
  const app = client();
  app.run('state.game.questionCount=4; state.game.coveredFactKeys=["category"]; state.game.publicClues=["已公开线索"]; const old=getCurrentRiddle().answer; const original=command("暂停游戏",true);');
  assert.equal(app.run('state.game.status'), 'paused');
  assert.equal(app.run('isPlayerGamePaused()'), true);
  assert.equal(app.run('getQuestionElapsedMs()'), 5000);
  assert.equal(app.run('simulationRuntime.paused'), false);
  assert.equal(app.run('state.timeline.status'), 'running');
  app.advance(15000);
  assert.equal(app.run('getQuestionElapsedMs()'), 5000);
  assert.equal(app.run('isCurrentWorkflowInput(original)'), false);
  app.run('command("继续游戏",false);');
  assert.equal(app.run('state.game.status'), 'playing');
  assert.equal(app.run('state.timeline.startedAt'), 110000);
  assert.equal(app.run('getQuestionElapsedMs()'), 5000);
  app.advance(1000); assert.equal(app.run('getQuestionElapsedMs()'), 6000);
  assert.equal(app.run('state.game.questionCount'), 4);
  assert.deepEqual(app.value('state.game.coveredFactKeys'), ['category']);
  assert.deepEqual(app.value('state.game.publicClues'), ['已公开线索']);
  assert.equal(app.run('getCurrentRiddle().answer'), app.run('old'));
});

test('repeat pause and continue-while-running are idempotent', () => {
  const app = client(); app.run('command("暂停游戏",true); const originalPause=state.workflow.playerGamePause;');
  app.advance(5000); app.run('command("暂停游戏",true);');
  assert.equal(app.run('state.workflow.playerGamePause===originalPause'), true);
  app.run('command("继续游戏",false); const resumedStart=questionClock.startedAt; const resumedDuration=questionClock.pausedDurationMs; command("继续游戏",false);');
  assert.equal(app.run('questionClock.startedAt'), app.run('resumedStart'));
  assert.equal(app.run('questionClock.pausedDurationMs'), app.run('resumedDuration'));
  assert.equal(app.run('state.game.questionCount'), 0);
});

test('pause confirmation can appear while game is paused after the previous bubble finishes', () => {
  const app = client();
  app.run('publishHostLine("上一句回答",{priority:"P2",source:"chat"}); const previousSpeech=state.workflow.hostSpeech.timer; command("暂停游戏",true);');
  assert.equal(app.run('state.host.text'), '上一句回答');
  app.advance(6000); app.fire('previousSpeech');
  assert.equal(app.run('state.host.text'), '我来暂停游戏。');
  assert.equal(app.run('state.workflow.hostSpeech.source'), 'game_control');
  assert.equal(app.run('state.game.status'), 'paused');
});

test('safety pause cannot be resumed by a player and nested safety returns to the original player pause', () => {
  const app = client();
  app.run('command("暂停游戏",true); applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake"); command("继续游戏",false);');
  assert.equal(app.run('state.game.status'), 'paused');
  assert.equal(app.run('state.ui.cabinMode'), 'safety_pause');
  assert.equal(app.run('state.host.text'), '大家坐稳，游戏先暂停。');
  app.advance(4500); app.fire('state.workflow.recoveryTimer');
  assert.equal(app.run('state.game.status'), 'paused');
  assert.equal(app.run('isPlayerGamePaused()'), true);
  assert.equal(app.run('getQuestionElapsedMs()'), 5000);
  app.run('command("继续游戏",false);');
  assert.equal(app.run('state.game.status'), 'playing');
  assert.equal(app.run('getQuestionElapsedMs()'), 5000);
});

test('pause retains queued questions and verified answers, then restores them only on continue', () => {
  const app = client();
  app.run(`state.workflow.pendingChats=[{seat:"rearLeft",text:"它常见吗？"}];
    deferHostReply("已经校验的回答",{priority:"P2",source:"chat"}); command("暂停游戏",true);`);
  assert.equal(app.run('state.workflow.pendingChats.length'), 0);
  assert.equal(app.run('state.workflow.playerGamePause.pendingChats.length'), 1);
  assert.equal(app.run('state.workflow.playerGamePause.replies.length'), 1);
  app.run('command("继续游戏",false);');
  assert.equal(app.run('state.workflow.pendingChats[0].text'), '它常见吗？');
  assert.equal(app.run('state.workflow.deferredHostReplies.some(reply=>reply.text==="已经校验的回答")'), true);
});

test('ordinary model output cannot pause, skip or reveal without an explicit command', () => {
  const app = client();
  app.run('command("它是人造的吗？",true,{game_status:"paused",is_correct:true});');
  assert.equal(app.run('state.game.status'), 'playing');
  assert.equal(app.run('state.ui.showAnswer'), false);
  assert.equal(app.run('state.workflow.playerGamePause'), null);
});

test('control request does not play thinking, and local fallback also supplies a bounded control action', () => {
  const app = client();
  app.run('beginWorkflowRequest(buildWorkflowInput("chat",null,"暂停游戏"));');
  assert.equal(app.run('state.workflow.hostThinkingTimer'), null);
  app.run('abortActiveWorkflow(); const input=buildWorkflowInput("chat",null,"暂停游戏"); applyWorkflowOutput(localDecision(input),input,"local");');
  assert.equal(app.run('state.game.status'), 'paused');
  assert.equal(app.run('state.game.questionCount'), 0);
});

test('six-dot progress keeps its 46px spacing and a centered 270px rail', () => {
  const app = client();
  app.run(`globalThis.document={createElement:()=>({style:{},classList:{add(){}}})};
    els.roundProgress={}; els.questionProgress={}; els.pencilProgressRail={style:{}}; els.pencilRailFill={style:{}};
    let dots=[]; els.pencilProgressDots={replaceChildren(...next){dots=next;}}; renderGameProgress();`);
  assert.equal(app.run('state.game.totalRounds'), 6);
  assert.equal(app.run('RIDDLES.length'), 10);
  assert.equal(app.run('els.questionProgress.textContent'), '1 / 6');
  assert.equal(app.run('els.pencilProgressRail.style.width'), '270px');
  assert.deepEqual(app.value('dots.map(dot=>dot.style.left)'), ['20px', '66px', '112px', '158px', '204px', '250px']);
});

test('pause/continue cannot start a game from the ready page or revive an inactive clock', async () => {
  const app = client();
  app.run('state.game.status="idle"; questionClock.active=false; els.playerInput={value:"继续游戏"};');
  await app.run('sendQuestion()');
  assert.equal(app.run('state.game.status'), 'idle');
  assert.match(app.run('state.ui.alert'), /先开始游戏/);
  app.run('state.game.status="playing"; command("暂停游戏",true);');
  assert.equal(app.run('state.workflow.playerGamePause'), null);
});

test('the sixth correct or timed-out question ends the game rather than entering question seven', () => {
  for (const outcome of ['Victory', 'Timeout']) {
    const app = client();
    app.run(`state.game.roundIndex=6; state.game.status=${JSON.stringify(outcome === 'Victory' ? 'victory' : 'failed')};
      finishGameSeries=()=>{state.game.status="summary";}; advanceAfter${outcome}(6);`);
    assert.equal(app.run('state.game.status'), 'summary');
    assert.equal(app.run('state.game.roundIndex'), 6);
  }
});
