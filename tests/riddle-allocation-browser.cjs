const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], previews = [], games = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/health') return route.fulfill({ json: { workflow_proxy: { configured: true } } });
      if (url.pathname !== '/api/workflow') return route.fulfill({ json: { ok: true } });
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const scope = { route: body.route, game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_id: input.event?.id, event_type: input.event?.type };
      if (body.route === 'preview') {
        previews.push(input);
        const steps = ['它是具体的东西吗？', '它在日常生活里常见吗？', '它和人类活动有关吗？', '它可以被人移动吗？']
          .map((text, i) => ({ id: `step-${i}`, order: i + 1, fact_key: `fact-${i}`, depends_on: [], variants: { default: text } }));
        return route.fulfill({ json: { ...scope, workflow_output: JSON.stringify({ preview_status: 'ready',
          round_question_plan: { plan_id: input.round_id, steps } }) } });
      }
      if (body.route === 'chat') {
        const correct = input.player_input === input.game.current_answer;
        return route.fulfill({ json: { ...scope, operation: body.operation, workflow_output: JSON.stringify({
          intent: correct ? 'guess' : 'event', reply_mode: 'answer_only', ai_reply_text: correct ? '答对啦！' : body.operation === 'environment_round_intro' ? '窗外换了景色，这道题咱们也应个景。' : '',
          is_correct: correct, game_status: correct ? 'victory' : 'playing', covered_fact_keys: [],
          decision_trace: { guard_status: 'passed' }, ui_change: { show_answer: correct },
        }) } });
      }
      return route.fulfill({ json: { ...scope, scene_output: { analysis_status: 'skipped', request_proactive_speech: false }, workflow_output: '{}' } });
    });
    const origin = process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/';
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !startupLoading.active && getGameScreenMode() === 'ready', undefined, { timeout: 60000 });
    assert.equal(await page.evaluate(() => RIDDLES.length), 91);
    assert.equal(await page.evaluate(() => recentRiddleIds.length), 0, 'Preloading is not an exposure');
    // Keep automatic cabin events out of this selection test; manual changes are exercised below.
    await page.evaluate(() => { runGoldenExperienceStep = async () => {}; });
    for (let scenario = 0; scenario < 5; scenario++) {
      if (scenario) await page.evaluate(index => {
        finishTimelineSilently(); clearHostSpeechLock(); applyGoldenLineDefaults(GOLDEN_TIMELINES[index]); render();
      }, scenario);
      await page.locator('#readyStartButton').click();
      const rounds = [];
      for (let round = 1; round <= 6; round++) {
        await page.waitForFunction(round => state.game.roundIndex === round && state.game.status === 'playing', round);
        await page.waitForFunction(() => Boolean(state.game.roundQuestionPlan));
        const row = await page.evaluate(() => ({ id: getCurrentRiddle().id, answer: getCurrentRiddle().answer,
          difficulty: getCurrentRiddle().difficulty, round: state.game.roundIndex }));
        rounds.push(row);
        if (scenario === 0 && round === 1) {
          const before = await page.evaluate(() => [state.game.currentRiddleIndex, getCurrentRiddle().hint, state.game.questionCount]);
          await page.evaluate(() => { setEnvironment('雨天'); setEnvironment('风景区雪景白天'); });
          await page.waitForTimeout(900);
          assert.deepEqual(await page.evaluate(() => [state.game.currentRiddleIndex, getCurrentRiddle().hint, state.game.questionCount]), before);
          const calls = previews.length;
          const selected = await page.evaluate(() => { for(let i=0;i<10;i++) refreshFollowingRoundPreparation();
            return roundQuestionPreparations.get(state.workflow.gameId+'-round-2').riddleIndex; });
          await page.waitForTimeout(150);
          assert.equal(previews.length, calls, 'No duplicate requests for identical selections');
          assert.equal(await page.evaluate(index => RIDDLES[index].environmentTags.includes('雪景'), selected), true);
        }
        if (scenario === 0 && round === 2) {
          await page.waitForFunction(() => !questionIntro.active);
          await page.screenshot({ path: 'tmp/riddle-allocation-snow-desktop.png' });
        }
        if (round % 2) {
          await page.locator('#playerInput').fill(row.answer);
          await page.locator('#sendQuestion').click();
          await page.waitForFunction(() => state.game.status === 'victory');
        }
        await page.evaluate(({ round, victory }) => {
          clearNextRoundTimer(); clearResultFeedback(); clearHostSpeechLock(); state.host.text = '';
          state.workflow.pendingChats = []; state.workflow.deferredHostReplies = [];
          if (victory) advanceAfterVictory(round);
          else { state.game.status = 'failed'; advanceAfterTimeout(round); }
        }, { round, victory: round % 2 === 1 });
      }
      await page.waitForFunction(() => state.game.status === 'summary');
      assert.equal(new Set(rounds.map(row => row.id)).size, 6);
      assert.deepEqual(rounds.slice(0, 4).map(row => row.difficulty), ['easy','easy','medium','medium']);
      if ([0,2,3].includes(scenario)) assert.equal(rounds[4].difficulty, 'medium');
      assert.ok(['easy','medium'].includes(rounds[5].difficulty));
      games.push({ scenario, rounds });
    }
    assert.equal(await page.evaluate(() => recentRiddleIds.length), 12);
    const history = await page.evaluate(() => [...recentRiddleIds]);
    const clippedHints = await page.evaluate(async () => {
      clearHostSpeechLock(); clearQuestionIntro(); state.host.text = ''; state.ui.showAnswer = false;
      state.game.status = 'playing'; const clipped = [];
      for (let index = 0; index < RIDDLES.length; index++) {
        state.game.currentRiddleIndex = index; render();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (els.riddleTitle.scrollHeight > els.riddleTitle.clientHeight + 1) clipped.push(RIDDLES[index].id);
      }
      return clipped;
    });
    assert.deepEqual(clippedHints, []);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !startupLoading.active && getGameScreenMode() === 'ready', undefined, { timeout: 60000 });
    assert.deepEqual(await page.evaluate(() => recentRiddleIds), history);
    assert.equal(history.includes(await page.evaluate(() => getCurrentRiddle().id)), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'tmp/riddle-allocation-ready-mobile.png' });
    assert.deepEqual(errors, []);
    const report = { passed: true, games, preview_requests: previews.length, recent_history: history,
      models_stubbed: true, tts_called: false, hints_checked: 91, clippedHints, errors };
    fs.writeFileSync('tmp/riddle-allocation-browser.json', JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify({ passed: true, games: games.length, rounds: 30, preview_requests: previews.length, errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
