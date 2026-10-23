const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {previewFixture}=require('./helpers/preview-fixture.cjs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [];
    let releaseSleep;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('smart-cabin-dify-user-id', `game-control-browser-test-${Date.now()}`));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const scope = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type };
      if (body.route === 'preview') return route.fulfill({json:previewFixture(input)});
      if (body.operation === 'game_opening') return route.fulfill({status:503,json:{error:'fixture_no_opening'}});
      if (body.route === 'situation') {
        const sleep = input.event.type === 'passenger_sleep';
        const scene = { ...scope, generated_at_ms: Date.now(), expires_at_ms: Date.now() + 60000, analysis_status: 'ready',
          request_proactive_speech: !sleep, request_host_decision: sleep, host_decision_seat: input.event.seat };
        return route.fulfill({ json: { route: 'situation', ...scope, scene_output: scene,
          situation_handoff: 'browser-ticket', workflow_output: JSON.stringify({ ai_reply_text: '', scene_output: scene }) } });
      }
      const command = input.player_input === '暂停游戏' ? true : input.player_input === '继续游戏' ? false : null;
      if (command !== null && process.env.LIVE_GAME_CONTROL === '1') return route.continue();
      const sleep = input.event?.type === 'passenger_sleep';
      if (sleep) await new Promise(resolve => { releaseSleep = resolve; });
      const output = { intent: command !== null ? 'game_related_chat' : 'event', reply_mode: 'chat_only',
        ai_reply_text: command === true ? '我来暂停游戏，保留进度。' : command === false ? '我来继续游戏，接着刚才的题目。'
          : sleep ? '我来关灯、分区音量0，空调调至用户记忆值。' : '我们进入隧道啦。',
        game_status: input.game.status, is_correct: false, covered_fact_keys: [], decision_trace: { guard_status: 'passed' },
        execution: { actions: command !== null ? [{ type: 'game.set_paused', paused: command }]
          : sleep ? [{ type: 'cabin.apply_sleep_comfort', seat: input.event.seat }] : [] } };
      return route.fulfill({ json: { route: 'chat', operation: body.operation || 'passenger_chat', ...scope,
        workflow_output: JSON.stringify(output) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'networkidle' });
    await page.waitForFunction(()=>!startupLoading.active&&getGameScreenMode()==='ready');
    await page.evaluate(() => {
      for (const timeline of ROUND_GOLDEN_TIMELINES) timeline.steps = [{ delay: 8000, type: 'passenger_question', label: '测试自动提问' }];
      globalThis.stepTimes = [];
      runRoundTimelineStep = async () => { stepTimes.push(simulationRuntime.now()); };
    });
    await page.locator('#readyStartButton').click();
    assert.equal(await page.locator('#questionProgress').innerText(), '1 / 6');
    assert.equal(await page.locator('#pencilProgressDots .dot').count(), 6);
    assert.deepEqual(await page.locator('#pencilProgressDots .dot').evaluateAll(dots => dots.map(dot => dot.style.left)),
      ['20px', '66px', '112px', '158px', '204px', '250px']);
    const puzzle = await page.evaluate(() => ({ answer: getCurrentRiddle().answer, index: state.game.currentRiddleIndex }));
    await page.locator('#playerInput').fill('暂停游戏');
    await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => isPlayerGamePaused());
    const frozen = await page.evaluate(() => getQuestionElapsedMs());
    assert.equal(await page.evaluate(() => simulationRuntime.paused), false);
    assert.equal(await page.evaluate(() => state.workflow.hostThinkingActive), false);
    assert.equal(await page.locator('#playerInput').isEnabled(), true);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(() => getQuestionElapsedMs()), frozen);
    assert.equal(await page.evaluate(() => stepTimes.length), 0);
    await page.locator('#playerInput').fill('继续游戏');
    await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => state.game.status === 'playing' && !state.workflow.inFlight);
    assert.equal(await page.evaluate(() => state.game.questionCount), 0);
    assert.deepEqual(await page.evaluate(() => ({ answer: getCurrentRiddle().answer, index: state.game.currentRiddleIndex })), puzzle);
    const remaining = await page.evaluate(() => state.timeline.startedAt + 8000 - simulationRuntime.now());
    assert.ok(remaining > 500, 'resume should retain the original automatic-question delay');
    await page.waitForFunction(() => stepTimes.length === 1, null, { timeout: Math.max(1000, remaining + 3000) });
    fs.mkdirSync('tmp', { recursive: true });
    await page.screenshot({ path: process.env.LIVE_GAME_CONTROL === '1' ? 'tmp/game-control-live.png' : 'tmp/game-control-six-rounds.png' });
    if (process.env.LIVE_GAME_CONTROL === '1') {
      assert.deepEqual(errors, []);
      console.log('PASS: real published Chatflow pause/resume via input, six dots, unchanged puzzle/counts, retained clock and automatic-question delay.');
      return;
    }
    await page.evaluate(() => {
      applyImmediatePassengerSleep('rearRight');
      void dispatchWorkflow('event', { id: 'automatic-sleep-control-test', type: 'passenger_sleep', seat: 'rearRight', source: 'timeline' });
    });
    await page.waitForFunction(() => state.workflow.inFlight && state.workflow.activeLabel.includes('座舱'));
    assert.equal(await page.locator('[data-speed]').count(), 0);
    assert.equal(await page.locator('[data-environment="隧道"]').isEnabled(), true);
    const previousSpeed = await page.evaluate(() => state.car.speed);
    await page.locator('[data-environment="隧道"]').click();
    assert.equal(await page.evaluate(() => state.car.speed), previousSpeed);
    assert.equal(await page.evaluate(() => state.car.environment), '隧道');
    await page.locator('#pauseTimeline').click();
    assert.equal(await page.locator('[data-environment="隧道"]').isDisabled(), true);
    await page.locator('#pauseTimeline').click();
    releaseSleep();
    await page.waitForFunction(() => !state.workflow.inFlight);
    await page.evaluate(() => {
      clearHostSpeechLock(); clearResultFeedback(); clearQuestionClock(); finishTimelineSilently();
      state.game.roundIndex=6; state.game.status='failed'; advanceAfterTimeout(6); render();
    });
    assert.equal(await page.evaluate(() => state.game.status), 'summary');
    assert.equal(await page.locator('#summaryTotal').innerText(), '6');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: 'tmp/game-control-summary-small.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: input pause/resume, exact clock/next-event preservation, six-round summary, live controls during automatic sleep and full-simulation freeze protection.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
