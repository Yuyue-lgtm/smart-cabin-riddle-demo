const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [];
    let releaseChat, chatSent = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      if (body.route === 'chat') {
        chatSent = true;
        await new Promise(resolve => { releaseChat = resolve; });
      }
      return route.fulfill({ json: { route: body.route, game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_id: input.event?.id, event_type: input.event?.type,
        workflow_output: JSON.stringify({ ai_reply_text: body.route === 'chat' ? '不是，它不是人造的。' : '',
          intent: 'answer_question', reply_mode: 'answer_only', game_status: 'playing',
          is_valid_question: body.route === 'chat', is_correct: false, decision_trace: { guard_status: 'passed' } }) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'networkidle' });
    await page.locator('#readyStartButton').click();
    await page.evaluate(() => {
      finishTimelineSilently(); clearHostSpeechLock();
      state.host.text = ''; state.host.preferences.invitations = false;
      publishHostLine('暂停时，这句话和动画都应该停在原处。', { source: 'chat', durationMs: 6000 });
      showPassengerBubble('front', '它是人造的吗？');
      showImportantEvent('暂停检查');
      beginManualEventCooldown(els.eventButtons);
      startConfetti();
      setBackgroundMusicEnabled(true);
      render();
      void dispatchWorkflow('chat', null, '它是人造的吗？');
    });
    await page.waitForFunction(() => hostSprite.playing && !hostSprite.loading);
    await page.waitForTimeout(450);
    await page.waitForFunction(() => !els.backgroundMusic.paused);
    assert.equal(chatSent, true);
    await page.evaluate(() => {
      jumpToQuestionSeconds(10);
      setEnvironment(state.car.environment === '隧道' ? '车库' : '隧道');
    });
    await page.locator('#pauseTimeline').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#pauseTimeline').innerText(), '继续模拟');
    assert.equal(await page.locator('#pauseTimeline').isEnabled(), true);
    assert.equal(await page.locator('#resetScenario').isDisabled(), true);
    assert.equal(await page.locator('#sendQuestion').isDisabled(), true);
    assert.equal(await page.evaluate(() => [...els.eventButtons].every(button => button.disabled)), true);

    const snapshot = () => page.evaluate(() => ({
      time: simulationRuntime.now(), elapsed: getQuestionElapsedMs(),
      host: state.host.text, passenger: state.passengers.seats.front.bubble,
      event: { text: state.ui.importantEvent.text, phase: state.ui.importantEvent.phase },
      background: state.ui.screenEnvironment, round: state.game.roundIndex,
      frame: hostSprite.frameIndex, cooldown: manualEventCooldowns.size,
      music: { time: els.backgroundMusic.currentTime, paused: els.backgroundMusic.paused, enabled: backgroundMusic.enabled },
      hostPixels: els.hostCanvas.toDataURL(), confettiPixels: els.confettiCanvas.toDataURL(),
      decision: [els.decisionPerception.textContent, els.decisionDecision.textContent, els.decisionExecution.textContent],
      animations: document.getAnimations().map(animation => [animation.animationName || '', animation.currentTime, animation.playState]),
    }));
    const frozen = await snapshot();
    fs.mkdirSync('tmp', { recursive: true });
    const before = await page.screenshot({ path: 'tmp/simulation-frozen-game-before.png', animations: 'allow' });
    releaseChat();
    await page.waitForTimeout(6500);
    assert.deepEqual(await snapshot(), frozen, 'game, bubbles, backgrounds, decision trace, sprites, CSS and Canvas stay frozen');
    const after = await page.screenshot({ path: 'tmp/simulation-frozen-game-after.png', animations: 'allow' });
    assert.equal(before.equals(after), true, 'all three surfaces have identical pixels after 6.5 seconds');
    assert.equal(await page.evaluate(() => audioContext?.state), 'suspended');
    assert.equal(frozen.music.paused, true);
    assert.equal(frozen.music.enabled, true);
    await page.locator('#pauseTimeline').click();
    await page.waitForFunction(() => !state.workflow.inFlight);
    await page.waitForFunction(() => !els.backgroundMusic.paused);
    assert.ok(await page.evaluate(time => els.backgroundMusic.currentTime >= time, frozen.music.time));
    assert.equal(await page.evaluate(() => simulationRuntime.paused), false);
    assert.notEqual((await snapshot()).frame, frozen.frame);
    assert.notEqual((await snapshot()).confettiPixels, frozen.confettiPixels);
    assert.equal(await page.evaluate(() => state.ui.importantEvent.phase), 'visible');
    await page.waitForFunction(() => state.host.text === '不是，它不是人造的。', null, { timeout: 12000 });
    await page.waitForFunction(() => state.ui.screenEnvironment === state.car.environment);

    await page.evaluate(() => { finishGameSeries(); render(); });
    await page.waitForTimeout(1750);
    await page.locator('#pauseTimeline').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);
    const summarySnapshot = () => page.evaluate(() => ({
      time: simulationRuntime.now(), host: state.host.text,
      frame: hostSprite.frameIndex, pixels: els.summaryConfettiCanvas.toDataURL(),
      loop: summaryConfettiAnimation.fallingVisible,
      animations: document.getAnimations().map(animation => [animation.animationName || '', animation.currentTime, animation.playState]),
    }));
    const summary = await summarySnapshot();
    const summaryBefore = await page.screenshot({ path: 'tmp/simulation-frozen-summary-before.png', animations: 'allow' });
    await page.waitForTimeout(5000);
    assert.deepEqual(await summarySnapshot(), summary, 'summary intro, MVP, confetti and host remain frozen');
    const summaryAfter = await page.screenshot({ path: 'tmp/simulation-frozen-summary-after.png', animations: 'allow' });
    assert.equal(summaryBefore.equals(summaryAfter), true);
    await page.locator('#pauseTimeline').click();
    assert.equal(await page.evaluate(() => state.timeline.status), 'finished');
    await page.waitForFunction(() => summaryConfettiAnimation.fallingVisible);
    assert.notEqual((await summarySnapshot()).pixels, summary.pixels);

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#readyStartButton').click();
    await page.evaluate(() => {
      finishTimelineSilently();
      applyImmediateSafetyPause(); scheduleEventRecovery('hard_brake'); render();
    });
    await page.waitForTimeout(500);
    await page.locator('#pauseTimeline').click();
    await page.waitForTimeout(5000);
    assert.equal(await page.evaluate(() => state.ui.cabinMode), 'safety_pause');
    await page.locator('#pauseTimeline').click();
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => state.game.status), 'paused', 'manual resume must not end the independent safety pause early');
    await page.waitForFunction(() => state.game.status === 'playing', null, { timeout: 6000 });
    assert.deepEqual(errors, []);
    console.log('PASS: gameplay and summary freeze pixel-for-pixel; delayed Dify output, timers, CSS, sprites, Canvas and audio resume from pause.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
