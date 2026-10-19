const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
    await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:4179/');
    await page.waitForFunction(() => document.querySelector('#appShell')?.style.transform);
    assert(await page.locator('#gameScreen').evaluate((element) => element.classList.contains('screen-ready')));
    await page.clock.install();
    await page.evaluate(() => {
      clearHostSpeechLock();
      state.host.text = '';
      state.game.status = 'playing';
      setEnvironment('城区晴天白天');
      window.makeTraceInput = () => ({ trigger_type: 'event', event: { type: 'environment_change', value: state.car.environment, previous_value: '车库', priority: 'P1' }, game: { status: 'playing' }, passengers: { selected_seat: 'front', selected_seat_label: '副驾' } });
      window.makeTraceOutput = () => ({ ai_reply_text: '我们来到市区啦。', game_status: 'playing',
        perception: { schema_version: 2, signals: [{ field: 'environment', label: '车外环境', previous_value: '车库', value: '城区晴天白天' }], confidence: null },
        decision_trace: { schema_version: 2, decision: '回应新的车外环境', priority: 'P1' }, execution: { kind: 'plan', actions: [] } });
      publishHostLine('上一条话术', { durationMs: 1000 });
      applyWorkflowOutput(makeTraceOutput(), makeTraceInput());
      render();
    });
    let trace = await page.evaluate(() => state.decisionTrace);
    assert.equal(trace.receipts.speech.status, 'queued');
    assert(!/置信度|时机|P1|passed|规则/.test(trace.perception + trace.decision + trace.execution));
    await page.clock.fastForward(1100);
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.speech.status), 'showing');
    await page.clock.fastForward(3100);
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.speech.status), 'completed');

    await page.evaluate(() => {
      publishHostLine('还在说话', { durationMs: 1000 });
      applyWorkflowOutput(makeTraceOutput(), makeTraceInput());
      window.replacedReceipts = state.decisionTrace.receipts;
      applyWorkflowOutput(makeTraceOutput(), makeTraceInput());
      render();
    });
    assert.equal(await page.evaluate(() => window.replacedReceipts.speech.status), 'superseded');
    await page.evaluate(() => {
      const input = makeTraceInput();
      input.event.value = '旧环境';
      applyWorkflowOutput(makeTraceOutput(), input);
    });
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.speech.status), 'skipped');
    await page.evaluate(() => clearEnvironmentAnnouncement());

    // Older completions update their own receipt, never the active panel.
    await page.evaluate(() => {
      const old = updateDecisionTrace(normalizeDecisionTrace(makeTraceOutput(), makeTraceInput()));
      const oldReceipts = state.decisionTrace.receipts;
      const current = updateDecisionTrace(normalizeDecisionTrace(makeTraceOutput(), makeTraceInput()));
      recordExecutionReceipt(current, 'speech', 'queued', '新的话术等待中');
      recordExecutionReceipt(old, 'speech', 'completed', '旧话术结束');
      window.oldReceiptStatus = oldReceipts.speech.status;
    });
    assert.equal(await page.evaluate(() => window.oldReceiptStatus), 'completed');
    assert.equal(await page.evaluate(() => state.decisionTrace.execution), '新的话术等待中');

    await page.evaluate(() => {
      clearHostSpeechLock();
      publishHostLine('安全暂停', { priority: 'P0' });
      const input = makeTraceInput();
      input.event = { type: 'passenger_question', priority: 'P2' };
      applyWorkflowOutput(makeTraceOutput(), input);
      render();
    });
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.speech.status), 'blocked');

    await page.evaluate(() => {
      clearHostSpeechLock();
      const output = makeTraceOutput();
      output.execution.actions = [{ type: 'music.set_enabled', enabled: true }];
      els.backgroundMusic.play = () => Promise.reject(new DOMException('gesture required', 'NotAllowedError'));
      applyWorkflowOutput(output, makeTraceInput());
      render();
    });
    await page.waitForFunction(() => state.decisionTrace.receipts.music?.status === 'failed');
    assert.match(await page.evaluate(() => state.decisionTrace.execution), /浏览器拦截/);

    await page.evaluate(() => {
      els.backgroundMusic.play = () => Promise.resolve();
      window.fakePaused = false;
      Object.defineProperty(els.backgroundMusic, 'paused', { configurable: true, get: () => window.fakePaused });
      els.backgroundMusic.pause = () => { window.fakePaused = true; };
      setBackgroundMusicEnabled(true, state.decisionTrace.id);
    });
    await page.waitForFunction(() => state.decisionTrace.receipts.music?.status === 'playing');
    await page.evaluate(() => {
      els.backgroundMusic.play = () => new Promise((resolve) => { window.resolveOldPlay = resolve; });
      setBackgroundMusicEnabled(true, state.decisionTrace.id);
    });
    await page.evaluate(() => {
      setBackgroundMusicEnabled(false, state.decisionTrace.id);
      window.resolveOldPlay();
    });
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.music.status), 'stopped');

    await page.evaluate(() => {
      clearHostSpeechLock();
      const output = makeTraceOutput();
      output.is_correct = true;
      output.game_status = 'victory';
      output.execution.actions = [{ type: 'ambient_light.play_preset', preset: 'cabin-correct-light' }];
      applyWorkflowOutput(output, makeTraceInput());
      clearNextRoundTimer();
      render();
    });
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.light.status), 'simulating');
    await page.clock.fastForward(6100);
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.speech.status), 'completed');
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.light.status), 'completed');
    await page.evaluate(() => showCorrectSeatLight('front', state.decisionTrace.id));
    await page.evaluate(() => clearCorrectLightTimer());
    assert.equal(await page.evaluate(() => state.decisionTrace.receipts.light.status), 'cancelled');

    await page.evaluate(() => {
      state.game.status = 'playing';
      state.ui.correctLightSeat = null;
      state.ui.showAnswer = false;
      clearHostSpeechLock();
      applyWorkflowOutput(makeTraceOutput(), makeTraceInput());
      render();
    });
    for (const [width, height] of [[1920, 1080], [1440, 900], [1024, 768], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => resizeStage());
      const shell = await page.locator('#appShell').boundingBox();
      assert(shell.x >= -1 && shell.y >= -1 && shell.x + shell.width <= width + 1 && shell.y + shell.height <= height + 1);
      const card = await page.locator('.cabin-region .cabin-decision-card').boundingBox();
      const event = await page.locator('#importantEvent').boundingBox();
      if (event) assert(card.y + card.height <= event.y + 1);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => resizeStage());
    await page.screenshot({ path: 'tmp/trace-v2-full.png' });
    await page.locator('.cabin-region .cabin-decision-card').screenshot({ path: 'tmp/trace-v2-card.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: speech queue/expiry/preemption, receipt isolation, music failure/success/race, light simulation, responsive layout (4 sizes), no page errors');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
