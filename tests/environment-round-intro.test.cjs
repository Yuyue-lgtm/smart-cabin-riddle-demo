const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const { handleWorkflowBody } = require('../api/dify-bff');
const source = fs.readFileSync(require.resolve('../client-app.js'), 'utf8').replace(/\nboot\(\);\s*$/, '\n');
const flush = () => new Promise(resolve => setImmediate(resolve));

function client() {
  let now = 100000, id = 0;
  const timers = new Map(), requests = [];
  const schedule = (callback, delay) => { timers.set(++id, { callback, delay }); return id; };
  const context = vm.createContext({ structuredClone, AbortController, crypto: webcrypto,
    console: { ...console, info() {}, warn() {} }, Date: class extends Date { static now() { return now; } },
    setTimeout: schedule, clearTimeout: key => timers.delete(key), cancelAnimationFrame() {},
    window: { setTimeout: schedule, clearTimeout: key => timers.delete(key) },
    localStorage: { getItem: () => null, setItem() {} },
    capture: (input, signal) => new Promise((resolve, reject) => requests.push({ input, signal, resolve, reject })),
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run(`render=()=>{}; const originalRequestWorkflow=requestWorkflow; requestWorkflow=capture; state.game.status="playing"; state.timeline.status="running";
    state.game.roundIndex=2; state.game.currentRiddleIndex=5; state.car.environment="风景区雪景白天";
    state.host.text="";
    roundQuestionPreparations.set(getDifyRoundScopeKey(),{environmentSelection:{matched:true,environment:state.car.environment}});`);
  return { run, requests, value: code => JSON.parse(run(`JSON.stringify(${code})`)),
    advance(ms) { now += ms; }, fire(code) { const timer = timers.get(run(code)); assert.ok(timer, code); timer.callback(); } };
}

function reply(request, extra = {}) {
  const input = request.input;
  request.resolve({ intent: 'event', reply_mode: 'chat_only', ai_reply_text: '窗外换成雪景，这道新题咱们也应个景。',
    game_status: 'playing', is_correct: false, covered_fact_keys: [], decision_trace: { guard_status: 'passed' },
    execution: { actions: [] }, _bff: { route: 'chat', operation: 'environment_round_intro',
      event_id: input.event.id, game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version }, ...extra });
}

test('only a matching new round requests one intro, without thinking or a situation analysis call', async () => {
  const app = client();
  app.run('queueEnvironmentRoundIntro(); queueEnvironmentRoundIntro();');
  assert.equal(app.requests.length, 1);
  const request = app.requests[0];
  assert.equal(request.input.trigger_type, 'event');
  assert.equal(request.input.event.type, 'round_changed');
  assert.equal(request.input.dialogue_request.kind, 'environment_round_intro');
  assert.equal(request.input.player_input, '');
  assert.equal(app.run('state.workflow.hostThinkingActive'), false);
  assert.equal(app.run('state.workflow.hostThinkingTimer'), null);
  reply(request); await flush();
  assert.match(app.run('state.host.text'), /应个景/);
  assert.equal(app.run('state.workflow.hostSpeech.source'), 'environment_round_intro');
  assert.equal(app.run('state.game.questionCount'), 0);
  assert.deepEqual(app.value('state.game.coveredFactKeys'), []);
  assert.equal(app.run('state.workflow.inFlight'), false);
});

test('initial, nonmatching and already-started question rounds do not request an opening', () => {
  for (const change of ['state.game.roundIndex=1;', 'roundQuestionPreparations.clear();',
    'roundQuestionPreparations.get(getDifyRoundScopeKey()).environmentSelection.matched=false;',
    'state.game.questionCount=1;', 'state.passengers.seats.front.bubble="它是什么？";']) {
    const app = client(); app.run(change + 'queueEnvironmentRoundIntro();');
    assert.equal(app.requests.length, 0, change);
  }
});

test('intro waits behind an active higher-priority bubble but expires rather than being replayed late', async () => {
  const app = client();
  app.run('publishHostLine("优先提醒",{priority:"P1",source:"environment"}); queueEnvironmentRoundIntro();');
  assert.equal(app.requests.length, 0);
  app.advance(6001); app.fire('state.workflow.environmentRoundIntro.timer');
  app.run('clearHostSpeechLock(); state.host.text="";');
  await app.run('processNextPendingChat()');
  assert.equal(app.requests.length, 0);
});

test('a passenger bubble cancels an in-flight intro and its late response cannot replace speech', async () => {
  const app = client();
  app.run('queueEnvironmentRoundIntro(); showPassengerBubble("front","它是人造的吗？");');
  assert.equal(app.requests[0].signal.aborted, true);
  reply(app.requests[0]); await flush();
  assert.equal(app.run('state.host.text'), '');
  assert.equal(app.run('state.workflow.inFlight'), false);
  assert.equal(app.run('state.workflow.environmentRoundIntro.status'), 'cancelled');
});

test('an intro queued behind a bubble is discarded as soon as questions start', async () => {
  const app = client(); app.run('queueEnvironmentRoundIntro();');
  app.run('publishHostLine("安全提醒先说完",{priority:"P1",source:"environment"});');
  reply(app.requests[0]); await flush();
  assert.equal(app.run('state.workflow.deferredHostReplies.length'), 1);
  app.run('showPassengerBubble("rearLeft","它很常见吗？");');
  assert.equal(app.run('state.workflow.deferredHostReplies.length'), 0);
  assert.equal(app.run('state.host.text'), '安全提醒先说完');
});

test('P0, environment changes, and an expired window reject old intro results', async () => {
  for (const change of ['applyImmediateSafetyPause();', 'setEnvironment("隧道");',
    'state.game.roundIndex=3;', 'state.game.status="summary";', 'state.workflow.p0Epoch+=1;']) {
    const app = client(); app.run('queueEnvironmentRoundIntro(); ' + change);
    reply(app.requests[0]); await flush();
    assert.doesNotMatch(app.run('state.host.text'), /应个景/, change);
  }
  const app = client(); app.run('queueEnvironmentRoundIntro();');
  app.advance(6001); app.fire('state.workflow.environmentRoundIntro.timer');
  assert.equal(app.requests[0].signal.aborted, true);
  reply(app.requests[0]); await flush();
  assert.equal(app.run('state.host.text'), '');
});

test('invalid intro outputs cannot leak the answer, add facts, trigger devices or change game state', async () => {
  for (const output of [
    { ai_reply_text: '谜底就是雪人。' }, { intent: 'fallback' }, { is_correct: true },
    { covered_fact_keys: ['material'] }, { game_status: 'victory' }, { ui_change: { show_answer: true } },
    { execution: { actions: [{ type: 'music.set_enabled', enabled: false }] } },
    { passenger_action: { seat: 'rearLeft', text: '新问题' } },
    { _bff: { route: 'chat', operation: 'passenger_chat' } },
  ]) {
    const app = client(); app.run('queueEnvironmentRoundIntro();');
    reply(app.requests[0], output); await flush();
    assert.equal(app.run('state.host.text'), '', JSON.stringify(output));
    assert.equal(app.run('state.game.status'), 'playing');
    assert.equal(app.run('state.game.questionCount'), 0);
    assert.deepEqual(app.value('state.game.coveredFactKeys'), []);
  }
});

test('transport failure remains silent instead of producing a generic fallback', async () => {
  const app = client(); app.run('queueEnvironmentRoundIntro();');
  app.requests[0].reject(new Error('network unavailable')); await flush();
  assert.equal(app.run('state.host.text'), '');
  assert.equal(app.run('state.workflow.environmentRoundIntro.status'), 'skipped');
});

test('cancelled network results cannot overwrite the global conversation ID', async () => {
  const app = client();
  app.run(`
    const savedConversations=[]; savePersistentDifyConversationId=id=>savedConversations.push(id);
    const cancelledController=new AbortController(); cancelledController.abort();
    const cancelledInput=buildWorkflowInput("chat",null,"它常见吗？");
    globalThis.fetch=async()=>({ok:true,json:async()=>({route:"chat",game_id:cancelledInput.game_id,
      round_id:cancelledInput.round_id,scene_version:cancelledInput.scene_version,
      conversation_id:"obsolete-intro-conversation",workflow_output:JSON.stringify({ai_reply_text:"旧回复"})})});
  `);
  await assert.rejects(app.run('originalRequestWorkflow(cancelledInput,cancelledController.signal)'), error => error.name === 'AbortError');
  assert.deepEqual(app.value('savedConversations'), []);
});

test('higher-priority events preempt generation while P4 speech waits behind the P3 intro', async () => {
  const app = client(); app.run('queueEnvironmentRoundIntro(); publishHostLine("轻松氛围",{priority:"P4",source:"atmosphere"});');
  assert.equal(app.run('state.host.text'), '');
  assert.equal(app.run('state.workflow.deferredHostReplies.length'), 1);
  app.run('registerSituationEvent({id:"intro-overspeed",type:"speed_overspeed",priority:"P1"});');
  assert.equal(app.requests[0].signal.aborted, true);
  assert.equal(app.run('state.workflow.environmentRoundIntro.status'), 'cancelled');
  reply(app.requests[0]); await flush();
  assert.doesNotMatch(app.run('state.host.text'), /应个景/);
});

function introInput() {
  return { game_id: 'intro-test', round_id: 'intro-test-2', scene_version: 'intro-scene', p0_epoch: 0,
    trigger_type: 'event', player_input: '', dialogue_request: { kind: 'environment_round_intro' },
    event: { type: 'round_changed', id: 'intro-2', source: 'environment_riddle', priority: 'P3', value: '城区雨天白天' },
    game: { status: 'playing', round_index: 2, question_count: 0, current_answer: '雨伞', current_theme: '雨天' },
    car: { environment: '城区雨天白天' } };
}

test('BFF directly routes a validated intro into existing event Chatflow without calling situation Workflow', async t => {
  const previous = process.env.DIFY_CHATFLOW_API_KEY;
  process.env.DIFY_CHATFLOW_API_KEY = 'intro-chat-key';
  t.after(() => previous === undefined ? delete process.env.DIFY_CHATFLOW_API_KEY : process.env.DIFY_CHATFLOW_API_KEY = previous);
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ conversation_id: 'same-global-conversation', host_result: {
      intent: 'event', ai_reply_text: '下雨了，这道新题也应个景。', decision_trace: { guard_status: 'passed' },
    } }), { headers: { 'Content-Type': 'application/json' } });
  });
  const result = await handleWorkflowBody({ route: 'chat', operation: 'environment_round_intro',
    input_payload: JSON.stringify(introInput()), user_id: 'intro-test-user', conversation_id: 'same-global-conversation' });
  assert.equal(result.status, 200);
  assert.equal(result.payload.operation, 'environment_round_intro');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/v1/chat-messages'));
  assert.equal(calls[0].body.conversation_id, 'same-global-conversation');
  const snapshot = JSON.parse(calls[0].body.inputs.snapshot), situation = JSON.parse(calls[0].body.inputs.situation);
  assert.equal(snapshot.dialogue_request.kind, 'situation_event');
  assert.equal(snapshot.player_input, '');
  assert.equal(situation.event_type, 'round_changed');
  assert.equal(situation.request_proactive_speech, true);
  assert.equal(situation.usable_for_dialogue, false);
  assert.match(situation.dialogue_context.guidance.instruction, /不透露谜底/);
});

test('BFF rejects nonmatching, P0, unknown source, initial and active-question intro requests without network access', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw new Error('not expected'); });
  for (const modify of [
    input => { input.game.current_theme = '家庭'; }, input => { input.event.priority = 'P0'; },
    input => { input.event.source = 'player'; }, input => { input.game.round_index = 1; },
    input => { input.game.question_count = 1; }, input => { input.game.status = 'paused'; },
    input => { input.player_input = '给我提示'; }, input => { input.event.value = '隧道'; },
  ]) {
    const input = introInput(); modify(input);
    const result = await handleWorkflowBody({ route: 'chat', operation: 'environment_round_intro', input_payload: JSON.stringify(input) });
    assert.equal(result.status, 409);
    assert.equal(result.payload.error, 'INVALID_ENVIRONMENT_ROUND_INTRO');
  }
  assert.equal(calls, 0);
});
