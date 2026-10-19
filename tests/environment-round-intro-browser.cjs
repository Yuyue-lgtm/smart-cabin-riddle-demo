const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], requests = [];
    let hold = false, release;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('smart-cabin-dify-user-id', `intro-browser-verification-${Date.now()}`));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      requests.push({ operation: body.operation, input });
      const intro = body.operation === 'environment_round_intro';
      if (intro && process.env.LIVE_INTRO === '1') return route.continue();
      if (intro && hold) await new Promise(resolve => { release = resolve; });
      const output = { intent: intro ? 'event' : 'answer_question', ai_reply_text: intro
        ? '窗外换成雪景，这道新题咱们也应个景。' : body.route === 'chat' ? '是的。' : '',
        reply_mode: 'chat_only', game_status: 'playing', is_valid_question: !intro && body.route === 'chat',
        is_correct: false, covered_fact_keys: [], execution: { actions: [] }, decision_trace: { guard_status: 'passed' } };
      try {
        await route.fulfill({ json: { route: body.route === 'situation' ? 'skipped' : body.route,
          operation: intro ? 'environment_round_intro' : 'passenger_chat',
          game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
          event_id: input.event?.id, event_type: input.event?.type, workflow_output: JSON.stringify(output) } });
      } catch (error) { if (!hold) throw error; }
    });
    async function prepareSecondRound() {
      await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'networkidle' });
      await page.locator('#readyStartButton').click();
      await page.evaluate(() => {
        finishTimelineSilently(); clearHostSpeechLock(); state.host.text = '';
        state.host.preferences.invitations = false;
        setEnvironment('风景区雪景白天');
      });
      await page.waitForFunction(() => roundQuestionPreparations.get(state.workflow.gameId + '-round-2')?.riddleIndex === 5);
      await page.evaluate(() => { state.game.status = 'failed'; advanceAfterTimeout(1); });
      await page.waitForFunction(() => state.workflow.environmentRoundIntro?.status === 'generating'
        || state.workflow.environmentRoundIntro?.status === 'shown');
    }
    await prepareSecondRound();
    await page.waitForFunction(() => state.workflow.environmentRoundIntro?.status === 'shown', null, { timeout: 10000 }).catch(async error => {
      console.error(await page.evaluate(() => ({ intro: state.workflow.environmentRoundIntro,
        speech: state.host.text, trace: state.decisionTrace })));
      throw error;
    });
    assert.match(await page.locator('#hostBubble').innerText(), /题|应景/);
    assert.equal(await page.evaluate(() => state.workflow.hostSpeech.source), 'environment_round_intro');
    assert.equal(await page.evaluate(() => state.workflow.hostThinkingActive), false);
    assert.equal(await page.evaluate(() => state.game.questionCount), 0);
    assert.deepEqual(await page.evaluate(() => state.game.coveredFactKeys), []);
    const count = requests.filter(row => row.operation === 'environment_round_intro').length;
    await page.evaluate(() => queueEnvironmentRoundIntro());
    assert.equal(requests.filter(row => row.operation === 'environment_round_intro').length, count);
    assert.equal(requests.some(row => row.input.event?.type === 'round_changed' && row.operation !== 'environment_round_intro'), false);
    fs.mkdirSync('tmp', { recursive: true });
    await page.screenshot({ path: process.env.LIVE_INTRO === '1' ? 'tmp/environment-round-intro-live.png' : 'tmp/environment-round-intro.png' });
    if (process.env.LIVE_INTRO === '1') {
      assert.deepEqual(errors, []);
      console.log('PASS: published Chatflow intro appears through the local BFF and actual frontend at round start, without thinking, extra facts or repeated intro.');
      return;
    }

    hold = true;
    await prepareSecondRound();
    await page.locator('#playerInput').fill('它是人造的吗？');
    await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => state.workflow.environmentRoundIntro?.status === 'cancelled');
    await page.waitForFunction(() => !state.workflow.inFlight && state.game.questionCount === 1);
    release();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => state.host.text), '是的。');
    assert.equal(await page.evaluate(() => state.workflow.deferredHostReplies.some(reply => reply.options.source === 'environment_round_intro')), false);

    await prepareSecondRound();
    await page.locator('[data-event="hard_brake"]').click();
    release();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => state.ui.cabinMode), 'safety_pause');
    assert.equal(await page.evaluate(() => state.host.text), '大家坐稳，游戏先暂停。');
    assert.equal(await page.evaluate(() => state.workflow.hostSpeech.source), 'hard_brake');
    assert.deepEqual(errors, []);
    console.log('PASS: one matching-round intro, no thinking/facts/actions, immediate question preemption and P0 protection against late output.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
