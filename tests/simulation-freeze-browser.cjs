const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {previewFixture}=require('./helpers/preview-fixture.cjs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [];
    let releaseChat, chatSent = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/readiness', route => route.fulfill({ json: { ok: true, routes: {} } }));
    await page.route('**/api/client-diagnostic', route => route.fulfill({ status: 202, json: { ok: true } }));
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      if(body.route==='preview')return route.fulfill({json:previewFixture(input)});
      if(body.operation==='game_opening')return route.fulfill({status:503,json:{error:'fixture_no_opening'}});
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
    await page.waitForFunction(()=>!startupLoading.active&&getGameScreenMode()==='ready');
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
    assert.equal(await page.locator('#resetScenario').isEnabled(), true);
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
      animations: document.getAnimations().filter(animation=>animation.effect?.target?.closest?.('.game-region, .cabin-region'))
        .map(animation => [animation.animationName || '', animation.currentTime, animation.playState]),
    }));
    const assertFrozenPixels=async(before,after,label)=>{
      const difference=await page.evaluate(async([before,after])=>{
        const images=await Promise.all([before,after].map(async data=>{const image=new Image();
          image.src=`data:image/png;base64,${data}`;await image.decode();return image;}));
        const canvas=document.createElement('canvas');canvas.width=images[0].width;canvas.height=images[0].height;
        const context=canvas.getContext('2d');
        const buffers=images.map(image=>{context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
          return context.getImageData(0,0,canvas.width,canvas.height).data;});
        let maxDelta=0;for(let i=0;i<buffers[0].length;i++)maxDelta=Math.max(maxDelta,Math.abs(buffers[0][i]-buffers[1][i]));
        return {maxDelta,sameDimensions:images[0].width===images[1].width&&images[0].height===images[1].height};
      },[before.toString('base64'),after.toString('base64')]);
      assert.equal(difference.sameDimensions,true,`${label}: screenshot dimensions changed`);
      assert.ok(difference.maxDelta<=1,`${label}: ${JSON.stringify(difference)}`);
    };
    const frozen = await snapshot();
    fs.mkdirSync('tmp', { recursive: true });
    const before = await page.locator('.game-region').screenshot({ path: 'tmp/simulation-frozen-game-before.png', animations: 'allow' });
    const cabinBefore=await page.locator('.cabin-region').screenshot({path:'tmp/simulation-frozen-cabin-before.png',animations:'allow'});
    releaseChat();
    await page.waitForTimeout(6500);
    assert.deepEqual(await snapshot(), frozen, 'game, bubbles, backgrounds, decision trace, sprites, CSS and Canvas stay frozen');
    const after = await page.locator('.game-region').screenshot({ path: 'tmp/simulation-frozen-game-after.png', animations: 'allow' });
    const cabinAfter=await page.locator('.cabin-region').screenshot({path:'tmp/simulation-frozen-cabin-after.png',animations:'allow'});
    await assertFrozenPixels(before,after,'game pixels stay frozen after 6.5 seconds');
    await assertFrozenPixels(cabinBefore,cabinAfter,'cabin pixels stay frozen; resume-button guide intentionally keeps moving');
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
      animations: document.getAnimations().filter(animation=>animation.effect?.target?.closest?.('.game-region, .cabin-region'))
        .map(animation => [animation.animationName || '', animation.currentTime, animation.playState]),
    }));
    const summary = await summarySnapshot();
    const summaryBefore = await page.locator('.game-region').screenshot({ path: 'tmp/simulation-frozen-summary-before.png', animations: 'allow' });
    await page.waitForTimeout(5000);
    assert.deepEqual(await summarySnapshot(), summary, 'summary intro, MVP, confetti and host remain frozen');
    const summaryAfter = await page.locator('.game-region').screenshot({ path: 'tmp/simulation-frozen-summary-after.png', animations: 'allow' });
    await assertFrozenPixels(summaryBefore,summaryAfter,'summary remains frozen');
    await page.locator('#pauseTimeline').click();
    assert.equal(await page.evaluate(() => state.timeline.status), 'finished');
    await page.waitForFunction(() => summaryConfettiAnimation.fallingVisible);
    assert.notEqual((await summarySnapshot()).pixels, summary.pixels);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(()=>!startupLoading.active&&getGameScreenMode()==='ready');
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
    await page.locator('#pauseTimeline').click();
    assert.equal(await page.locator('#resetScenario').isEnabled(), true);
    assert.equal(await page.locator('#resetScenario').evaluate(button => getComputedStyle(button).pointerEvents), 'auto');
    await page.locator('#resetScenario').click();
    await page.waitForFunction(() => !simulationRuntime.paused && state.timeline.status === 'idle' && state.game.status === 'idle');
    assert.deepEqual(errors, []);
    console.log('PASS: gameplay/summary states freeze exactly and screenshots stay within one color level of rasterization tolerance; delayed output, timers, sprites and audio resume; paused reset works.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
