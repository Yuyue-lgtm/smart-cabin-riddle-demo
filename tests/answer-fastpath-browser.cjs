const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const folder = process.env.ANSWER_TEST_FOLDER || 'tmp/dify-ecs/answer-fastpath';
  fs.mkdirSync(folder,{recursive:true});
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], reports = [];
    page.on('pageerror', error => errors.push(error.message));
    // Isolate preloading and timeline events; answer confirmations use the real BFF and Dify.
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON();
      if (body.route === 'chat') return route.continue();
      const input = JSON.parse(body.input_payload);
      return route.fulfill({ json: { route: body.route, game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_id: input.event?.id || '', event_type: input.event?.type || '',
        workflow_output: '{}', scene_output: { analysis_status: 'skipped', request_proactive_speech: false } } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });
    const health=await page.evaluate(()=>fetch('/api/health').then(r=>r.json()));
    await page.waitForFunction(() => typeof dispatchAnswerConfirmation === 'function' && Boolean(els.playerInput));
    await page.evaluate(() => {
      enterPreparedGame();
      finishTimelineSilently();
      invalidateAsyncHostResults();
      clearHostSpeechLock();
      setBackgroundMusicEnabled(false);
      state.game.currentRiddleIndex = RIDDLES.findIndex(riddle => riddle.answer === '雨伞');
      state.game.status = 'playing'; state.timeline.status = 'running'; state.host.text = '';
      render();
    });
    for (const query of ['是雨伞吗', '不是雨伞', '我猜是雨伞']) {
      if (query.startsWith('不是')) {
        await page.evaluate(() => {
          clearNextRoundTimer(); invalidateAsyncHostResults(); clearHostSpeechLock(); clearConfetti();
          state.game.roundIndex += 1; state.game.status = 'playing'; state.timeline.status = 'running';
          state.ui.showAnswer = false; state.ui.correctSeat = null; state.host.text = ''; render();
        });
      }
      const before = await page.evaluate(() => state.game.questionCount);
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/workflow')
        && response.request().postDataJSON()?.query === query);
      await page.locator('#playerInput').fill(query);
      const start = Date.now();
      await page.locator('#sendQuestion').click();
      const response = await responsePromise;
      const body = await response.json();
      const output = JSON.parse(body.workflow_output);
      assert.equal(response.status(), 200);
      assert.equal(body.app_id, health.workflow_proxy.chatflow_app_id);
      assert.deepEqual(body.diagnostic.model_nodes, []);
      if (!query.startsWith('不是')) {
        assert.equal(output.is_correct, true);
        await page.waitForFunction(() => state.game.status === 'victory' && state.ui.showAnswer);
      } else {
        assert.equal(output.is_correct, false);
        await page.waitForFunction(() => state.workflow.answerConfirmation === null);
        assert.equal(await page.evaluate(() => state.game.status), 'playing');
        assert.equal(await page.evaluate(() => state.ui.showAnswer), false);
        assert.equal(await page.evaluate(() => state.game.questionCount), before);
      }
      reports.push({ query, elapsed_ms: Date.now() - start, is_correct: output.is_correct,
        rule: output.decision_trace.matched_rule, model_nodes: body.diagnostic.model_nodes, run_id: body.workflow_run_id });
      await page.screenshot({ path: `${folder}/chrome-${reports.length}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${folder}/browser-verification.json`, JSON.stringify({ passed: true, errors, reports,
      preloading_and_events_stubbed: true, chat_real: true, audio_disabled: true }, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ passed: true, reports, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
