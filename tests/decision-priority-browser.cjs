const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      return route.fulfill({ json: { route: body.route, game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_id: input.event?.id, event_type: input.event?.type,
        workflow_output: JSON.stringify({ ai_reply_text: '' }) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'domcontentloaded' });
    await page.locator('#readyStartButton').click();
    await page.evaluate(() => {
      finishTimelineSilently(); clearHostSpeechLock(); state.host.text = '';
      state.host.preferences.invitations = false;
      state.passengers.seats.rearLeft.mood = '睡着';
      registerSituationEvent({ id: 'panel-left', type: 'passenger_sleep', seat: 'rearLeft', priority: 'P2' });
      state.passengers.seats.rearRight.mood = '睡着';
      registerSituationEvent({ id: 'panel-right', type: 'passenger_sleep', seat: 'rearRight', priority: 'P2' });
      state.car.environment = '隧道';
      const event = { id: 'panel-env', type: 'environment_change', value: '隧道', priority: 'P1' };
      registerSituationEvent(event);
      const id = updateDecisionTrace({ perception: '检测到后排右睡着', decision: '启用关怀：关灯、分区音量0、空调用户记忆值', priority: 'P2' });
      findSituationEvent('panel-right').traceId = id;
      const sceneScope = getSituationScope(buildWorkflowInput('event', event, ''), { expires_at_ms: Date.now() + 60000 });
      publishHostLine('进入隧道啦。', { priority: 'P1', source: 'environment', sceneScope });
      render();
    });
    assert.match(await page.locator('#decisionPriority').innerText(), /^P2 /);
    assert.match(await page.locator('#decisionPerception').innerText(), /同时事件：.*后排左睡着.*环境切换：隧道/);
    assert.match(await page.locator('#decisionDecision').innerText(), /P1 环境切换：隧道正在回应，本事件排队/);
    assert.match(await page.locator('#decisionExecution').innerText(), /接下来：P2 后排左睡着 → P2 后排右睡着/);
    fs.mkdirSync('tmp', { recursive: true });
    await page.locator('.cabin-decision-card').screenshot({ path: 'tmp/decision-priority-desktop.png' });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(() => {
      const badge = document.querySelector('#decisionPriority').getBoundingClientRect();
      const heading = document.querySelector('#decisionPriority').parentElement.getBoundingClientRect();
      return badge.width > 0 && badge.right <= heading.right + 1;
    });
    await page.locator('.cabin-decision-card').screenshot({ path: 'tmp/decision-priority-small.png' });
    await page.evaluate(() => {
      applyImmediateSafetyPause(); render();
    });
    assert.match(await page.locator('#decisionPriority').innerText(), /^P0 /);
    assert.match(await page.locator('#decisionDecision').innerText(), /P0 立即处理，其他待办保留等待/);
    assert.match(await page.locator('#decisionExecution').innerText(), /正在回应：P0 安全暂停/);
    await page.evaluate(() => { resetDecisionTrace(); render(); });
    assert.equal(await page.locator('#decisionPriority').isVisible(), false);
    assert.equal(await page.locator('#decisionExecution').innerText(), '');
    assert.deepEqual(errors, []);
    console.log('PASS: priority badge, simultaneous perception, P1/P2 FIFO display, P0 waiting policy, staged empty state and two viewport sizes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
