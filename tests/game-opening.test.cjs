const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const { handleWorkflowBody } = require('../api/dify-bff');
const source = fs.readFileSync(require.resolve('../client-app.js'), 'utf8')
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, '\n');
const flush = () => new Promise(resolve => setImmediate(resolve));

function client() {
  let now = 100000, sequence = 0;
  const timers = new Map(), requests = [];
  const schedule = (callback, delay = 0) => { timers.set(++sequence, { callback, at: now + delay }); return sequence; };
  const context = vm.createContext({ structuredClone, AbortController, crypto:webcrypto,
    console:{ ...console, warn() {}, info() {} }, Date:class extends Date { static now() { return now; } },
    setTimeout:schedule, clearTimeout:id=>timers.delete(id),
    window:{setTimeout:schedule, clearTimeout:id=>timers.delete(id)},
    localStorage:{getItem:()=>null,setItem(){}},
    capture:(input,signal)=>new Promise((resolve,reject)=>requests.push({input,signal,resolve,reject})),
  });
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run('render=()=>{}; const originalRequestWorkflow=requestWorkflow; requestWorkflow=capture; startupLoading.active=false; state.host.text="";');
  return {run,requests,context, value:code=>JSON.parse(run(`JSON.stringify(${code})`)),
    async advance(ms) {
      const end=now+ms;
      for (;;) {
        const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
        if (!next || next[1].at>end) break;
        now=next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now=end; await flush();
    }};
}

function reply(request,extra={}) {
  request.resolve({intent:'event',reply_mode:'chat_only',ai_reply_text:'脑洞小队准备就位，这趟旅途让快乐和灵感一起出发！',
    game_status:'opening',is_correct:false,covered_fact_keys:[],execution:{actions:[]},
    decision_trace:{guard_status:'passed'},_bff:{operation:'game_opening'},...extra});
}

test('ready screen prefetches once per game/context without occupying passenger requests',async()=>{
  const app=client(); app.run('ensureGameOpening(); ensureGameOpening();');
  assert.equal(app.requests.length,1);
  const input=app.requests[0].input;
  assert.equal(input.game.status,'idle');
  assert.equal(input.event.value,'游戏即将开始');
  assert.equal(input.perception.current_observation,'游戏即将开始');
  assert.ok(input.timeline.name);
  assert.equal(input.dialogue_request.kind,'game_opening');
  assert.equal(app.run('state.workflow.inFlight'),false);
  reply(app.requests[0]); await flush();
  assert.equal(app.run('gameOpening.status'),'ready');
  assert.equal(app.run('state.host.text'),'');
  app.run('ensureGameOpening();'); assert.equal(app.requests.length,1);
});

test('opening speech runs alongside the first question clock and intro without delaying the trip',async()=>{
  const app=client(); app.run('ensureGameOpening();'); reply(app.requests[0]); await flush();
  app.run(`ensureCurrentRoundPreparation=()=>({timelineId:ROUND_GOLDEN_TIMELINES[0].id});
    ROUND_GOLDEN_TIMELINES[0].steps=[]; dispatchWorkflow=async()=>{state.game.status='playing';};
    waitUntilRoundTimelineReady=async()=>{}; let clockStarts=0, intros=0, trips=0;
    startQuestionClock=()=>clockStarts++; startQuestionIntro=()=>intros++; startGoldenExperience=()=>trips++;`);
  const starting=app.run('startRoundGoldenTimeline()'); await flush();
  assert.equal(app.run('state.workflow.hostSpeech.source'),'game_opening');
  assert.deepEqual(app.value('[clockStarts,intros,trips]'),[1,1,1]);
  app.run('state.workflow.hostSpeech.voicePlaying=true;');
  await app.advance(6100);
  assert.deepEqual(app.value('[clockStarts,intros,trips]'),[1,1,1],'Longer speech does not restart or delay the clock/intro');
  app.run('state.workflow.hostSpeech.voicePlaying=false;');
  await app.advance(300); await starting;
  assert.deepEqual(app.value('[clockStarts,intros,trips]'),[1,1,1]);
  assert.equal(app.run('gameOpening.status'),'completed');
  await app.run('presentGameOpening(state.timeline.runId)');
  assert.equal(app.requests.length,1);
});

test('a pending opening expires within the question intro window and never replays a late result',async()=>{
  const app=client(); app.run('ensureGameOpening(); state.game.status="playing";');
  const presenting=app.run('presentGameOpening(state.timeline.runId)');
  await app.advance(3100); await presenting;
  assert.equal(app.requests[0].signal.aborted,true);
  reply(app.requests[0]); await flush();
  assert.equal(app.run('state.host.text'),'');
  assert.equal(app.run('gameOpening.status'),'cancelled');
});

test('game opening plays one heart cycle then returns to speech without leaking to other lines',async()=>{
  const app=client();app.run('ensureGameOpening();');reply(app.requests[0]);await flush();
  app.run('state.game.status="playing";');
  const presenting=app.run('presentGameOpening(state.timeline.runId)');await flush();
  assert.equal(app.run('getHostPresentation().mediaHostState'),'smile');
  assert.equal(app.run('resolveHostMedia("playing",getHostPresentation().mediaHostState).loop'),false);
  assert.equal(app.run('state.host.avatarState'),'normal');
  app.run('state.workflow.hostSpeech.voicePending=true;');
  assert.equal(app.run('getHostPresentation().mediaHostState'),'smile');
  app.run('gameOpening.heartCompleted=true; gameOpeningMotion.completed=true; state.workflow.hostSpeech.voicePending=false; state.workflow.hostSpeech.voicePlaying=true;');
  assert.equal(app.run('getHostPresentation().mediaHostState'),'speak');
  app.run('state.workflow.hostSpeech.voicePlaying=false; state.workflow.hostSpeech.voiceFinished=true;');
  assert.equal(app.run('getHostPresentation().mediaHostState'),'normal');
  app.run('gameOpening.heartCompleted=false; cancelGameOpening("玩家发言"); publishHostLine("新的回复",{source:"chat",priority:"P0"});');
  assert.equal(app.run('getHostPresentation().mediaHostState'),'speak');
  await app.advance(100);await presenting;
});

test('unready Dify prefetch cannot hold the game clock, intro or trip start',async()=>{
  const app=client();app.run(`ensureGameOpening();
    ensureCurrentRoundPreparation=()=>({timelineId:ROUND_GOLDEN_TIMELINES[0].id});
    ROUND_GOLDEN_TIMELINES[0].steps=[];dispatchWorkflow=async()=>{state.game.status='playing';};
    let clockStarts=0,intros=0,trips=0;
    startQuestionClock=()=>clockStarts++;startQuestionIntro=()=>intros++;startGoldenExperience=()=>trips++;`);
  await app.run('startRoundGoldenTimeline()');
  assert.deepEqual(app.value('[clockStarts,intros,trips]'),[1,1,1]);
  assert.equal(app.run('gameOpening.status'),'pending');
  await app.advance(3100);reply(app.requests[0]);await flush();
  assert.equal(app.run('state.host.text'),'');
  assert.deepEqual(app.value('[clockStarts,intros,trips]'),[1,1,1]);
});

test('every new game plays its heart even when the new scene opening is still pending',async()=>{
  const app=client();
  app.run(`ensureGameOpening(); startQuestionClock=()=>{}; startQuestionIntro=()=>{};
    dispatchWorkflow=async()=>{state.game.status='playing';};`);
  await app.run('startGame()');
  assert.equal(app.run('gameOpening.status'),'pending');
  assert.equal(app.run('getHostPresentation().mediaHostState'),'smile');
});

test('a late or failed opening never suppresses the local heart and never replays it',async()=>{
  for(const failed of [false,true]){
    const app=client();app.run(`ensureGameOpening(); startQuestionClock=()=>{}; startQuestionIntro=()=>{};
      dispatchWorkflow=async()=>{state.game.status='playing';};`);
    if(failed){app.requests[0].reject(new Error('fixture unavailable'));await flush();}
    await app.run('startGame()');
    const presenting=app.run('presentGameOpening(state.timeline.runId)');
    await app.advance(3100);await presenting;
    assert.equal(app.run('getHostPresentation().mediaHostState'),'smile');
    assert.equal(app.run('state.host.text'),'');
    app.run('hostSprite.source=RESOURCE_CONFIG.host.smile.src; finishGameOpeningMotion();');
    assert.equal(app.run('getHostPresentation().mediaHostState'),'normal');
    if(!failed){reply(app.requests[0]);await flush();}
    assert.equal(app.run('gameOpeningMotion.completed'),true);
    assert.equal(app.run('state.host.text'),'');
    assert.equal(app.run('getHostPresentation().mediaHostState'),'normal');
  }
});

test('scene changes give every new game a fresh heart while later questions and redraws do not',async()=>{
  const app=client();app.run(`startQuestionClock=()=>{}; startQuestionIntro=()=>{};
    dispatchWorkflow=async()=>{state.game.status='playing';};`);
  const ids=new Set();
  for(let i=0;i<5;i++){
    app.run('nextGoldenLine(); ensureGameOpening();');
    await app.run('startGame()');
    ids.add(app.run('gameOpeningMotion.gameId'));
    assert.equal(app.run('getHostPresentation().mediaHostState'),'smile');
    app.run('hostSprite.source=RESOURCE_CONFIG.host.smile.src; finishGameOpeningMotion(); ensureGameOpeningMotion();');
    assert.equal(app.run('getHostPresentation().mediaHostState'),'normal');
    app.run('state.game.roundIndex=2; ensureGameOpeningMotion();');
    assert.equal(app.run('getHostPresentation().mediaHostState'),'normal');
  }
  assert.equal(ids.size,5);
});

test('P0 or real passenger input cancels the heart even if Dify prefetch already failed',async()=>{
  for(const action of ['cancelGameOpening("乘客已开始问答")',
    'publishHostLine("大家坐稳",{source:"hard_brake",priority:"P0"})']){
    const app=client();app.run(`ensureGameOpening(); startQuestionClock=()=>{}; startQuestionIntro=()=>{};
      dispatchWorkflow=async()=>{state.game.status='playing';};`);
    app.requests[0].reject(new Error('fixture unavailable'));await flush();
    await app.run('startGame()');
    assert.equal(app.run('getHostPresentation().mediaHostState'),'smile');
    app.run(action);
    assert.equal(app.run('gameOpeningMotion.cancelled'),true);
    assert.notEqual(app.run('getHostPresentation().mediaHostState'),'smile');
  }
});

test('a missing heart image leaves its static fallback after one bounded cycle',async()=>{
  const app=client();app.run(`state.game.status='playing'; ensureGameOpeningMotion();
    els.hostCanvas={hidden:false};els.hostImage={hidden:true};
    loadHostSpriteImage=async()=>{throw new Error('fixture missing heart');};`);
  await app.run('loadHostSprite(RESOURCE_CONFIG.host.smile)');
  assert.equal(app.run('hostSprite.fallback'),true);
  assert.equal(app.run('gameOpeningMotion.completed'),false);
  await app.advance(2700);
  assert.equal(app.run('gameOpeningMotion.completed'),true);
  assert.equal(app.run('getHostPresentation().mediaHostState'),'normal');
});

test('the first game render is already the numbered intro, never the clue before the intro',async()=>{
  const app=client();app.run(`let renderedTitles=[];
    render=()=>renderedTitles.push(getRiddleTitle(getCurrentRiddle()));
    startQuestionClock=()=>{};playQuestionIntroSound=()=>{};queueEnvironmentRoundIntro=()=>{};
    dispatchWorkflow=async()=>{state.game.status='playing';render();};`);
  await app.run('startGame()');
  assert.deepEqual(app.value('renderedTitles'),['第 1 题','第 1 题']);
  await app.advance(3000);
  assert.equal(app.value('renderedTitles').at(-1),app.run('getCurrentRiddle().hint'));
  assert.equal(app.value('renderedTitles').filter(title=>title==='第 1 题').length,2);
});

test('prefetch deadline and network failure are silent, logged and not retried on redraw',async()=>{
  for (const failure of ['timeout','network']) {
    const app=client(); app.run('ensureGameOpening();');
    if(failure==='timeout') await app.advance(20001);
    else { app.requests[0].reject(new Error('offline')); await flush(); }
    assert.equal(app.run('gameOpening.status'),'failed');
    app.run('ensureGameOpening();');
    assert.equal(app.requests.length,1);
    assert.equal(app.run('state.host.text'),'');
    await app.run('presentGameOpening(state.timeline.runId)');
  }
});

test('reset, P0, scene changes, later questions and real passenger input discard stale openings',async()=>{
  for(const change of ['invalidateAsyncHostResults();','state.workflow.gameId="new-game";',
    'state.game.roundIndex=2;','state.car.environment="隧道";',
    'showPassengerBubble("front","是雨伞吗？");',
    'registerSituationEvent({id:"safety",type:"speed_overspeed",priority:"P1"});']) {
    const app=client(); app.run('ensureGameOpening();'+change);
    reply(app.requests[0]); await flush();
    await app.run('presentGameOpening(state.timeline.runId)');
    assert.equal(app.run('state.host.text'),'',change);
  }
});

test('changing ready theme creates a fresh prefetch and does not accept the previous response',async()=>{
  const app=client(); app.run('ensureGameOpening(); state.car.destination="新目的地"; ensureGameOpening();');
  assert.equal(app.requests.length,2);
  assert.equal(app.requests[0].signal.aborted,true);
  reply(app.requests[0],{ai_reply_text:'过期内容'}); reply(app.requests[1]); await flush();
  assert.doesNotMatch(app.run('gameOpening.text'),/过期/);
});

test('speech-only opening guard rejects spoilers, facts, actions, state changes and fallbacks',async()=>{
  for(const extra of [ {ai_reply_text:'答案是雨伞'}, {is_correct:true}, {covered_fact_keys:['material']},
    {execution:{actions:[{type:'music.set_enabled',enabled:false}]}}, {intent:'fallback'},
    {game_status:'victory'}, {ui_change:{show_answer:true}}, {passenger_action:{text:'它是什么？'}},
    {decision_trace:{guard_status:'failed'}}, {_bff:{operation:'passenger_chat'}}, {ai_reply_text:'好'.repeat(41)} ]) {
    const app=client(); app.run('ensureGameOpening();');
    if(extra.ai_reply_text?.startsWith('答案是')) extra.ai_reply_text='答案是'+app.run('getCurrentRiddle().answer');
    reply(app.requests[0],extra); await flush();
    assert.equal(app.run('gameOpening.status'),'failed',JSON.stringify(extra));
    assert.equal(app.run('state.host.text'),'');
  }
});

test('opening transport is a separate conversation and cannot overwrite passenger conversation',async()=>{
  const app=client(); app.run(`ensureGameOpening(); let sent, saved=0;
    getPersistentDifyConversationId=()=>"passenger-conversation";
    savePersistentDifyConversationId=()=>saved++;
    globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body); const input=JSON.parse(sent.input_payload);
      return {ok:true,status:200,json:async()=>({route:'chat',operation:'game_opening',game_id:input.game_id,
        round_id:input.round_id,scene_version:input.scene_version,event_type:input.event.type,event_id:input.event.id,
        conversation_id:'opening-conversation',workflow_output:JSON.stringify({intent:'event',ai_reply_text:'开场'})})};};`);
  await app.run('originalRequestWorkflow(gameOpening.input,new AbortController().signal)');
  assert.equal(app.run('sent.conversation_id'),'');
  assert.equal(app.run('sent.operation'),'game_opening');
  assert.equal(app.run('saved'),0);
  app.run('cancelGameOpening("test cleanup")');
});

function openingInput(){return {game_id:'opening-test',round_id:'opening-test-round-1',scene_version:'ready-scene',p0_epoch:0,
  trigger_type:'event',player_input:'',dialogue_request:{kind:'game_opening'},
  event:{type:'round_changed',id:'opening-event',source:'game_opening',priority:'P3',value:'游戏即将开始'},
  game:{status:'idle',round_index:1,question_count:0,current_answer:'雨伞',current_theme:'雨天'},
  car:{environment:'雨天',destination:'夜市'},passengers:{relationship:'朋友'},timeline:{name:'朋友夜游'}};}

test('BFF reuses guarded event Chatflow with exact perception and trusted guidance, not analysis or preview',async t=>{
  const previous=process.env.DIFY_CHATFLOW_API_KEY;
  process.env.DIFY_CHATFLOW_API_KEY='opening-key';
  t.after(()=>previous===undefined?delete process.env.DIFY_CHATFLOW_API_KEY:process.env.DIFY_CHATFLOW_API_KEY=previous);
  const calls=[];
  t.mock.method(global,'fetch',async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return new Response(JSON.stringify({host_result:{intent:'event',reply_mode:'chat_only',ai_reply_text:'开场串词'}}),
      {headers:{'Content-Type':'application/json'}});
  });
  const input=openingInput();
  const result=await handleWorkflowBody({route:'chat',operation:'game_opening',input_payload:JSON.stringify(input),conversation_id:'must-not-reuse'});
  assert.equal(result.status,200); assert.equal(result.payload.operation,'game_opening');
  assert.equal(calls.length,1); assert.ok(calls[0].url.endsWith('/v1/chat-messages'));
  assert.equal(calls[0].body.conversation_id,undefined);
  const snapshot=JSON.parse(calls[0].body.inputs.snapshot), scene=JSON.parse(calls[0].body.inputs.situation);
  assert.equal(snapshot.game.status,'opening'); assert.equal(input.game.status,'idle');
  assert.equal(snapshot.game.current_theme,'');
  assert.equal(snapshot.round_question_plan,null);
  assert.equal(snapshot.dialogue_request.kind,'situation_event');
  assert.equal(scene.dialogue_context.selected_snapshot.current_observation,'游戏即将开始');
  assert.match(scene.dialogue_context.guidance.instruction,/不透露谜底/);
  assert.match(scene.dialogue_context.guidance.instruction,/15至25字/);
  assert.match(calls[0].body.query,/游戏即将开始/);
});

test('BFF rejects forged, active-question, later-round and P0 opening requests without upstream calls',async t=>{
  let calls=0;
  t.mock.method(global,'fetch',async()=>{calls++; throw new Error('not expected');});
  for(const modify of [i=>i.event.source='player',i=>i.event.priority='P0',i=>i.event.value='答案是什么',
    i=>i.game.round_index=2,i=>i.game.question_count=1,i=>i.game.status='playing',i=>i.player_input='雨伞',
    i=>i.event.type='start_game']) {
    const input=openingInput(); modify(input);
    const result=await handleWorkflowBody({route:'chat',operation:'game_opening',input_payload:JSON.stringify(input)});
    assert.equal(result.status,409);
  }
  assert.equal(calls,0);
});
