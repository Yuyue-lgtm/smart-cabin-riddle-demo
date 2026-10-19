const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../client-app.js'), 'utf8').replace(/\nboot\(\);\s*$/, '\n');
function client() {
  let now = 100000, next = 0;
  const timers = new Map();
  const schedule = (fn, delay) => { timers.set(++next, { fn, delay }); return next; };
  const context = vm.createContext({ console, structuredClone, crypto: webcrypto, AbortController,
    Date: class extends Date { static now() { return now; } }, cancelAnimationFrame() {},
    window: { setTimeout: schedule, clearTimeout: id => timers.delete(id) },
    setTimeout: schedule, clearTimeout: id => timers.delete(id), localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('render=()=>{}; state.game.status="playing"; state.timeline.status="running"; state.host.text="";');
  return { run, context, value: code => JSON.parse(run(`JSON.stringify(${code})`)), advance(ms) { now += ms; },
    fire(code) { const timer = timers.get(run(code)); assert.ok(timer); timer.fn(); } };
}
test('zone commands require an explicit unique seat and reject riddles, negatives and hypotheses', () => {
  const app = client();
  assert.deepEqual(app.value('authorizedZoneLight("关闭我这边的灯光","rearRight")'), { type: 'cabin.set_zone_light', seat: 'rearRight', enabled: false });
  for (const phrase of ['把灯关了', '如果关闭副驾灯光', '不要关闭副驾灯光', '它能关灯吗', '关闭全车灯光'])
    assert.equal(app.run(`authorizedZoneLight(${JSON.stringify(phrase)})`), null);
});
test('sleep care restores the light setting from before sleep instead of forcing it on', () => {
  const app = client();
  app.run(`state.ui.zoneLights.rearRight=false; applyImmediatePassengerSleep("rearRight");
    let input={...buildFullWorkflowInput("event",{type:"passenger_sleep",seat:"rearRight",priority:"P2"},""),dialogue_request:{kind:"situation_event"}};
    applyWorkflowActions([{type:"cabin.apply_sleep_comfort",seat:"rearRight"}],input);
    applyImmediatePassengerWake("rearRight");
    input={...buildFullWorkflowInput("event",{type:"passenger_wake",seat:"rearRight",priority:"P3"},""),dialogue_request:{kind:"situation_event"}};
    applyWorkflowActions([{type:"cabin.restore_sleep_comfort",seat:"rearRight"}],input);`);
  assert.equal(app.value('state.ui.zoneLights.rearRight'), false);
  assert.deepEqual(app.value('state.ui.sleepComfortSeats'), []);
});
test('manual waking selects a still-sleeping passenger on every click, not a fixed rear seat', () => {
  const app = client();
  app.run('applyImmediatePassengerSleep("rearLeft"); applyImmediatePassengerSleep("rearRight");');
  assert.equal(app.run('getManualWakeSeat()'), 'rearRight');
  app.run('applyImmediatePassengerWake(getManualWakeSeat());');
  assert.equal(app.value('state.passengers.seats.rearRight.mood'), '普通');
  assert.equal(app.value('state.passengers.seats.rearLeft.mood'), '睡着');
  assert.equal(app.run('getManualWakeSeat()'), 'rearLeft');
  app.run('applyImmediatePassengerWake(getManualWakeSeat());');
  assert.deepEqual(app.value('getSleepingSeats()'), []);
  assert.equal(app.run('getManualWakeSeat()'), null);
});
test('manual wake prefers the selected sleeping seat and ignores lingering care on an awake seat', () => {
  const app = client();
  app.run('state.ui.sleepComfortSeats=["rearRight"]; applyImmediatePassengerSleep("rearLeft");');
  assert.equal(app.run('getManualWakeSeat()'), 'rearLeft');
  app.run('applyImmediatePassengerSleep("front"); state.passengers.selectedSeat="front";');
  assert.equal(app.run('getManualWakeSeat()'), 'front');
});
test('manual wake handler sends the chosen seat and sends nothing when nobody is sleeping', async () => {
  const app = client();
  app.run(`const clicks={};
    const control={addEventListener(){}};
    for(const name of ["backgroundMusicToggle","backgroundMusicToggleGame","switchScenario","resetScenario","summaryContinue","readyStartButton","startTimeline","pauseTimeline","sendQuestion","playerInput"]) els[name]=control;
    els.speedChips=[]; els.environmentChips=[];
    els.eventButtons=[{dataset:{event:"passenger_wake"},addEventListener(name,fn){clicks.wake=fn;}}];
    window.addEventListener=()=>{}; globalThis.document={addEventListener(){}};
    beginManualEventCooldown=()=>true; showImportantEvent=()=>{}; scheduleEventRecovery=()=>{};
    const sent=[]; dispatchWorkflow=async(trigger,event)=>{sent.push(event);};
    bindEvents(); applyImmediatePassengerSleep("rearLeft"); applyImmediatePassengerSleep("rearRight");`);
  await app.run('clicks.wake()');
  await app.run('clicks.wake()');
  await app.run('clicks.wake()');
  assert.deepEqual(app.value('sent.map(event=>[event.type,event.seat])'), [
    ['passenger_wake', 'rearRight'], ['passenger_wake', 'rearLeft'],
  ]);
  assert.deepEqual(app.value('getSleepingSeats()'), []);
  assert.equal(app.value('state.ui.alert'), '当前没有睡着的乘客');
});
test('ordinary light requests wait for their bubble and do not consume a game question', () => {
  const app = client();
  app.run(`const input=buildWorkflowInput("chat",null,"关闭副驾灯光");
    const output={intent:"game_related_chat",reply_mode:"chat_only",ai_reply_text:"我来关闭副驾灯光。",game_status:"playing",ui_change:{},
      decision_trace:{guard_status:"passed"},execution:{actions:[{type:"cabin.set_zone_light",seat:"front",enabled:false}]},
      _bff:{route:"chat",game_id:input.game_id,round_id:input.round_id,scene_version:input.scene_version}};
    applyWorkflowOutput(output,input,"chat");`);
  assert.equal(app.value('state.game.questionCount'), 0);
  assert.equal(app.value('state.ui.zoneLights.front'), true);
  assert.equal(app.run('startHostSpeechActions()'), true);
  assert.equal(app.value('state.ui.zoneLights.front'), false);
});
test('help recap contains only published clues and preserves confirmed facts', () => {
  const app = client();
  app.run('state.game.publicClues=["它不是人造的。"]; state.game.coveredFactKeys=["manufactured"];');
  assert.equal(app.run('publicClueRecap(buildWorkflowInput("chat",null,"给我提示"))'), '已公开：它不是人造的。');
  assert.deepEqual(app.value('state.game.coveredFactKeys'), ['manufactured']);
  assert.equal(app.run('publicClueRecap({game:{current_answer:"海豚",public_clues:["海豚"]}})').includes('海豚'), false);
});
test('temporary interruption preserves an unanswered request and resumes after 4.5s without charging twice', () => {
  const app = client();
  app.run(`state.game.questionCount=3; state.game.coveredFactKeys=["known"]; state.game.publicClues=["已公开线索"];
    state.workflow.activeChatInput=buildWorkflowInput("chat",null,"它是人造的吗？");
    state.workflow.pendingChats=[{seat:"rearLeft",text:"另一个问题"}];
    pauseQuestionClock=()=>{}; resumeQuestionClock=()=>{};
    processNextPendingChat=()=>{}; dispatchWorkflow=()=>{};
    applyTemporaryInterruption();`);
  assert.equal(app.value('state.game.status'), 'paused');
  assert.equal(app.value('state.workflow.pendingChats.length'), 2);
  assert.equal(app.value('state.workflow.pendingChats[0].text'), '它是人造的吗？');
  app.advance(4500); app.fire('state.workflow.interruption.timer');
  assert.equal(app.value('state.game.status'), 'playing');
  assert.equal(app.value('state.game.questionCount'), 3);
  assert.deepEqual(app.value('state.game.coveredFactKeys'), ['known']);
  assert.deepEqual(app.value('state.game.publicClues'), ['已公开线索']);
});
test('new safety interruption cancels a temporary resume and never restores over P0', () => {
  const app = client();
  app.run('pauseQuestionClock=()=>{}; applyTemporaryInterruption(); const oldTimer=state.workflow.interruption.timer; applyImmediateSafetyPause();');
  assert.equal(app.value('state.workflow.interruption'), null);
  assert.equal(app.value('state.ui.cabinMode'), 'safety_pause');
});
test('lower priority detections cannot replace the pause mode and strand its recovery', () => {
  const app = client();
  app.run('pauseQuestionClock=()=>{}; applyImmediateSafetyPause(); applyImmediatePassengerSleep("rearRight"); applyImmediateDriverTired("distracted"); applyImmediateNearDestination();');
  assert.equal(app.value('state.ui.cabinMode'), 'safety_pause');
  assert.equal(app.value('state.game.status'), 'paused');
  assert.equal(app.value('state.perception.driverState'), 'distracted');
});

for (const status of ['failed', 'victory']) {
  test(`hard brake during ${status} reveal restores the result and next-round transition`, () => {
    const app = client();
    app.run(`state.game.status=${JSON.stringify(status)}; state.game.roundIndex=2;
      state.ui.showAnswer=true; state.ui.cabinMode="reveal"; state.ui.correctSeat=${status === 'victory' ? '"front"' : 'null'};
      questionClock.active=false; state.workflow.nextRoundTimer=setTimeout(()=>{},6000);
      let advanced=null; advanceAfterTimeout=round=>{advanced=["failed",round];}; advanceAfterVictory=round=>{advanced=["victory",round];};
      applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake");`);
    assert.equal(app.value('state.game.status'), 'paused');
    assert.equal(app.value('state.workflow.nextRoundTimer'), null);
    app.advance(4500); app.fire('state.workflow.recoveryTimer');
    assert.equal(app.value('state.game.status'), status);
    assert.equal(app.value('state.ui.showAnswer'), true);
    assert.equal(app.value('questionClock.active'), false);
    assert.notEqual(app.value('state.workflow.nextRoundTimer'), null);
    app.fire('state.workflow.nextRoundTimer');
    assert.deepEqual(app.value('advanced'), [status, 2]);
  });
}

test('repeated brakes retain the original reveal, while old recovery callbacks cannot resume a new game', () => {
  const app = client();
  app.run('state.game.status="failed"; state.ui.showAnswer=true; state.ui.cabinMode="reveal"; applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake");');
  app.advance(4000);
  app.run('applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake");');
  app.advance(4500); app.fire('state.workflow.recoveryTimer');
  assert.equal(app.value('state.game.status'), 'failed');
  app.run('applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake"); const oldRecovery=state.workflow.recoveryTimer; state.workflow.gameId="new-game";');
  app.advance(4500); app.fire('oldRecovery');
  assert.equal(app.value('state.game.status'), 'paused');
});

test('brake before a game starts never fabricates an unclocked playing state', () => {
  const app = client();
  app.run('state.game.status="idle"; state.ui.cabinMode="normal"; applyImmediateSafetyPause(); scheduleEventRecovery("hard_brake");');
  app.advance(4500); app.fire('state.workflow.recoveryTimer');
  assert.equal(app.value('state.game.status'), 'idle');
  assert.equal(app.value('questionClock.active'), false);
});
