const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], tts = [], assetErrors = [];
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/assets/') && response.status() >= 400) {
        assetErrors.push({ url: response.url(), status: response.status() });
      }
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/client-diagnostic', route => route.fulfill({ status: 202, json: { ok: true } }));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true,
      workflow_proxy: { configured: true }, host_voice_configured: true } }));
    await page.route('**/api/workflow', route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const steps = ['它是人造的吗？', '它通常在户外使用吗？', '它有把手吗？', '它能折叠吗？'].map((text, i) => ({
        id: `step-${i}`, order: i + 1, fact_key: `fact-${i}`, depends_on: [], expected_answer: '是', variants: { default: text } }));
      return route.fulfill({ json: { route: body.route, game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_id: input.event?.id || '', event_type: input.event?.type || '',
        workflow_output: JSON.stringify({ round_question_plan: { plan_id: input.round_id, steps }, preview_status: 'ready' }),
        scene_output: { analysis_status: 'skipped', request_proactive_speech: false } } });
    });
    await page.route('**/api/tts', route => {
      tts.push(route.request().postDataJSON().text);
      return route.fulfill({ contentType: 'audio/mpeg', body: fs.readFileSync('assets/hi-audio.mp3') });
    });
    const sample = () => page.evaluate(() => {
      const canvas = els.hostCanvas;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0, checksum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 16) visible++;
        checksum = (checksum + pixels[i] + pixels[i + 1] * 3 + pixels[i + 2] * 7) % 1000000007;
      }
      return { source: hostSprite.source.split('?')[0], frame: hostSprite.frameIndex, visible, checksum };
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => getGameScreenMode() === 'ready' && hostSprite.playing, undefined, { timeout: 60000 });
    assert.ok(await page.evaluate(() => startupLoading.tasks.filter(task => task.id.startsWith('ready-host-')).every(task => task.status === 'ready')));
    assert.equal(await page.locator('#hostBubble').isVisible(), false);
    const firstGuide=await page.evaluate(()=>({visible:!els.soundOnboarding.hidden,elapsed:Date.now()-soundOnboarding.enteredAt}));
    if(firstGuide.visible)assert.ok(firstGuide.elapsed>=1900,'Onboarding never appears before the two-second entry delay');
    assert.deepEqual(await page.locator('#hostAvatar').evaluate(el => {
      const style = getComputedStyle(el);
      return [style.left, style.top, style.width, style.height];
    }), ['813px', '251px', '556px', '556px']);
    const first = await sample();
    assert.equal(first.source, './assets/hi.webp');
    await page.waitForTimeout(300);
    assert.notEqual((await sample()).checksum, first.checksum);
    assert.ok(first.visible > 1000);
    await page.screenshot({ path: 'tmp/ready-map-greeting-desktop.png' });
    const greetingLoad = await page.evaluate(() => hostSprite.loadId);
    await page.locator('#backgroundMusicToggle').click();
    assert.equal(await page.evaluate(() => hostSprite.loadId), greetingLoad);
    await page.waitForFunction(() => state.workflow.hostSpeech.source === 'ready_welcome'
      && state.workflow.hostSpeech.voicePlaying && hostSprite.source.includes('host-ready-speak'), undefined, { timeout: 20000 });
    assert.equal(tts.length, 1);
    assert.equal(tts[0], await page.evaluate(() => getPrestartHostText(getActiveGoldenLine())));
    assert.ok((await sample()).visible > 1000);
    assert.equal(await page.locator('#hostBubble').isVisible(), true);
    const welcomeShadow = await page.locator('#hostBubble').evaluate(el => getComputedStyle(el).boxShadow);
    assert.ok(welcomeShadow.includes('0px 4px 10px'), welcomeShadow);
    assert.ok(welcomeShadow.includes('0px 14px 32px'), welcomeShadow);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#hostBubble').evaluate(el =>
      Math.round(parseFloat(getComputedStyle(el).top) + parseFloat(getComputedStyle(el).height))), 267);
    await page.screenshot({ path: 'tmp/ready-map-welcome-desktop.png' });
    await page.waitForFunction(() => state.workflow.hostSpeech.voiceFinished
      && hostSprite.source.includes('host-ready-normal'), undefined, { timeout: 15000 });
    const idle = await sample();
    await page.waitForTimeout(300);
    assert.notEqual((await sample()).checksum, idle.checksum);
    await page.screenshot({ path: 'tmp/ready-map-idle-desktop.png' });
    await page.locator('#backgroundMusicToggle').click();
    await page.locator('#backgroundMusicToggle').click();
    assert.equal(tts.length, 1);
    assert.equal((await sample()).source, './assets/host-ready-normal.webp');

    // Switching scenes restarts greeting, but starting early must cancel its old welcome.
    await page.evaluate(() => nextGoldenLine());
    await page.waitForFunction(() => hostSprite.source.includes('/hi.webp') && hostSprite.playing);
    await page.locator('#readyStartButton').click();
    await page.waitForFunction(() => getGameScreenMode() !== 'ready');
    await page.waitForTimeout(6500);
    assert.equal(tts.length, 1);
    assert.equal(await page.evaluate(() => state.workflow.hostSpeech.source === 'ready_welcome'), false);
    assert.ok(!(await sample()).source.includes('host-ready-'));

    await page.evaluate(() => {
      invalidateAsyncHostResults(); finishTimelineSilently(); clearHostSpeechLock();
      state.game.status = 'summary'; state.host.text = ''; render();
    });
    await page.waitForFunction(() => hostSprite.source.includes('host-cheer') && hostSprite.playing);
    assert.ok((await sample()).visible > 1000);
    await page.waitForFunction(() => hostSceneMotion.completed && hostSprite.source === RESOURCE_CONFIG.host.normal.src, undefined, { timeout: 12000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      localStorage.removeItem(SOUND_ONBOARDING_COUNT_KEY);
      soundOnboarding.showCount = 0;
      setBackgroundMusicEnabled(false); applyGoldenLineDefaults(getActiveGoldenLine(), false); render();
    });
    await page.waitForFunction(() => hostSprite.source.includes('/hi.webp') && hostSprite.playing);
    assert.ok((await sample()).visible > 1000);
    await page.screenshot({ path: 'tmp/ready-map-greeting-mobile.png' });
    await page.waitForFunction(() => !els.soundOnboarding.hidden, undefined, { timeout: 4000 });
    const onboardingElapsed = await page.evaluate(() => Date.now() - soundOnboarding.enteredAt);
    assert.ok(onboardingElapsed >= 1900 && onboardingElapsed < 4000);
    assert.equal(await page.evaluate(() => hostSceneMotion.completed), false);
    assert.equal(await page.locator('#soundOnboarding').isVisible(), true);
    await page.screenshot({ path: 'tmp/ready-map-onboarding-2s-mobile.png' });
    await page.waitForFunction(() => hostSprite.source.includes('host-ready-speak'), undefined, { timeout: 12000 });
    assert.equal(await page.locator('#hostBubble').isVisible(), true);
    assert.equal(await page.locator('#soundOnboarding').isVisible(), false, 'Guide yields while the welcome bubble occupies the same space');
    await page.screenshot({ path: 'tmp/ready-map-welcome-mobile.png' });
    await page.waitForFunction(() => hostSprite.source.includes('host-ready-normal'), undefined, { timeout: 12000 });
    await page.waitForFunction(() => !els.soundOnboarding.hidden, undefined, { timeout: 12000 });
    assert.equal(await page.locator('#hostBubble').isVisible(), false);
    assert.equal(await page.locator('#soundOnboarding').isVisible(), true);
    await page.screenshot({ path: 'tmp/ready-map-onboarding-mobile.png' });
    assert.equal(tts.length, 1, 'Muted welcome must not synthesize');

    const frames = await page.evaluate(async () => {
      const results = [];
      for (const key of ['greeting', 'readyNormal', 'readySpeak']) {
        const media = RESOURCE_CONFIG.host[key], image = await loadReadyHostMedia(media);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 72;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let blank = 0;
        for (const { frame } of createHostSpriteFrames(media)) {
          ctx.clearRect(0, 0, 72, 72);
          ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, 72, 72);
          const data = ctx.getImageData(0, 0, 72, 72).data;
          let visible = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 16) visible++;
          if (!visible) blank++;
        }
        results.push({ key, frame_count: media.frameCount, blank });
      }
      return results;
    });
    assert.ok(frames.every(row => row.blank === 0));
    assert.equal(await page.evaluate(() => getSoundOnboardingShowCount()), 1);
    await page.evaluate(() => { resetCurrentGoldenLine(); });
    await page.waitForFunction(() => !els.soundOnboarding.hidden, undefined, { timeout: 18000 });
    assert.equal(await page.evaluate(() => getSoundOnboardingShowCount()), 2);
    await page.evaluate(() => { resetCurrentGoldenLine(); });
    await page.waitForFunction(() => hostSceneMotion.completed && state.workflow.hostSpeech.source === 'ready_welcome', undefined, { timeout: 12000 });
    await page.waitForFunction(() => !state.host.text, undefined, { timeout: 12000 });
    assert.equal(await page.locator('#soundOnboarding').isVisible(), false);
    assert.equal(await page.evaluate(() => getSoundOnboardingShowCount()), 2);
    await page.evaluate(() => {
      clearHostSpeechLock(); state.host.text = ''; state.game.status = 'playing';
      state.host.avatarState = 'awkward'; render();
    });
    await page.waitForFunction(() => hostSprite.source === RESOURCE_CONFIG.host.normal.src);
    await page.evaluate(() => { state.game.status = 'victory'; state.ui.showAnswer = true; render(); });
    assert.equal(await page.locator('.reveal-ring').count(), 0);
    assert.equal(await page.locator('#revealAnswerText').isVisible(), true);
    await page.setViewportSize({ width: 2380, height: 1120 });
    await page.screenshot({ path: 'tmp/reveal-without-ring-desktop.png' });
    assert.deepEqual(assetErrors, []);
    assert.deepEqual(errors, []);
    const report = { passed: true, frames, tts_requests: tts.length, errors, assetErrors,
      onboarding_display_limit: 2, reveal_ring_removed: true,
      real_sprite_assets: true, workflow_and_tts_stubbed: true, audio_output_muted: true };
    fs.writeFileSync('tmp/ready-map-browser.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
