const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {previewFixture}=require('./helpers/preview-fixture.cjs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], chats = [];
    let hold = true, release;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const scope = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type };
      if (body.route === 'preview') return route.fulfill({json:previewFixture(input)});
      if (body.operation === 'game_opening') return route.fulfill({status:503,json:{error:'fixture_no_opening'}});
      if (body.route === 'situation') {
        const scene = { ...scope, analysis_status: 'ready', request_proactive_speech: false, generated_at_ms: Date.now(), expires_at_ms: Date.now() + 60000 };
        return route.fulfill({ json: { route: 'situation', ...scope, scene_output: scene, workflow_output: JSON.stringify({ scene_output: scene }) } });
      }
      chats.push(input);
      const light = /灯/.test(input.player_input);
      if (!light && hold) { hold = false; await new Promise(resolve => { release = resolve; }); }
      const output = { ai_reply_text: light ? '我来关闭副驾灯光。' : '不是，它不是人造的。',
        intent: light ? 'game_related_chat' : 'answer_question', reply_mode: light ? 'chat_only' : 'answer_only', game_status: 'playing',
        decision_trace: { guard_status: 'passed' }, execution: { actions: light ? [{ type: 'cabin.set_zone_light', seat: 'front', enabled: false }] : [] }, ui_change: {} };
      try { await route.fulfill({ json: { route: 'chat', ...scope, workflow_output: JSON.stringify(output) } }); } catch { /* Interrupted requests may already be aborted. */ }
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(()=>!startupLoading.active&&getGameScreenMode()==='ready');
    await page.locator('#readyStartButton').click();
    await page.evaluate(() => { finishTimelineSilently(); clearHostSpeechLock(); state.host.text = ''; state.timeline.status='running'; startQuestionClock(); render(); });
    await page.locator('#playerInput').fill('关闭副驾灯光'); await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => state.ui.zoneLights.front === false);
    assert.equal(await page.locator('[data-sleep-shade="front"]').isVisible(), true);
    assert.equal(await page.locator('[data-comfort-zone="front"]').isVisible(), false);
    assert.equal(await page.evaluate(() => state.game.questionCount), 0);
    await page.evaluate(() => { clearHostSpeechLock(); state.host.text=''; render(); });
    await page.locator('#playerInput').fill('它是人造的吗？'); await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => state.workflow.activeChatInput?.player_input === '它是人造的吗？');
    await page.locator('[data-event="temporary_interruption"]').click();
    await page.waitForFunction(() => state.ui.cabinMode === 'temporary_interruption');
    const before = await page.evaluate(() => ({ elapsed: getQuestionElapsedMs(), round: state.game.roundIndex, count: state.game.questionCount }));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => getQuestionElapsedMs()), before.elapsed);
    await page.waitForFunction(() => state.game.status === 'playing', { timeout: 8000 });
    release();
    await page.waitForFunction(() => state.game.questionCount === 1, { timeout: 10000 });
    assert.equal(await page.evaluate(() => state.game.roundIndex), before.round);
    assert.equal(await page.evaluate(() => state.ui.zoneLights.front), false);
    assert.equal(chats.filter(input => input.player_input === '它是人造的吗？').length, 2);
    await page.screenshot({ path: 'tmp/cabin-policy-browser.png', fullPage: true });
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: 'tmp/cabin-policy-mobile.png', fullPage: true });
    await page.evaluate(() => { finishTimelineSilently(); jumpToQuestionSeconds(1); });
    await page.waitForFunction(() => state.game.status === 'failed');
    await page.locator('[data-event="hard_brake"]').click();
    await page.waitForFunction(() => state.game.status === 'paused');
    await page.waitForFunction(() => state.game.status === 'failed', undefined, { timeout: 8000 });
    assert.equal(await page.evaluate(() => state.ui.showAnswer), true);
    assert.equal(await page.evaluate(() => questionClock.active), false);
    assert.equal(await page.evaluate(() => state.workflow.nextRoundTimer !== null), true);
    await page.waitForFunction(() => state.game.roundIndex === 2 && state.game.status === 'playing' && questionClock.active,
      undefined, { timeout: 12000 });
    assert.equal(await page.evaluate(() => state.ui.showAnswer), false);
    await page.screenshot({ path: 'tmp/safety-reveal-recovery.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: device/temporary-interruption flow plus timeout -> brake -> restored reveal -> next playable round with active clock.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
