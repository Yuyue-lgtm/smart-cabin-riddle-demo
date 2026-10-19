const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], previews = [], chats = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const scope = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type };
      let output;
      if (body.route === 'preview') {
        previews.push(input);
        output = { round_question_plan: { plan_id: input.round_id, steps: [
          { id: 'category', fact_key: 'category', variants: { default: input.game.current_answer === '雪人'
            ? '它是用雪做的吗？' : input.game.current_answer === '雨伞' ? '它可以挡雨吗？' : '它是人造的吗？' } },
          { id: 'location', fact_key: 'location', depends_on: ['category'], variants: { default: '它常见于室内吗？' } },
        ] } };
      } else if (body.route === 'chat') {
        chats.push(input);
        const hit = input.player_input === input.game.current_answer;
        output = { intent: hit ? 'guess_answer' : 'answer_question', reply_mode: 'answer_only',
          ai_reply_text: hit ? '答对了。' : '是的。', game_status: hit ? 'victory' : 'playing',
          is_correct: hit, is_valid_question: true, answer: input.game.current_answer,
          decision_trace: { guard_status: 'passed' }, covered_fact_keys: hit ? [] : ['category'] };
      } else {
        return route.fulfill({ json: { route: 'skipped', ...scope, workflow_output: JSON.stringify({ ai_reply_text: '' }) } });
      }
      return route.fulfill({ json: { route: body.route, ...scope, workflow_output: JSON.stringify(output) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'networkidle' });
    await page.locator('#readyStartButton').click();
    await page.waitForFunction(() => state.game.status === 'playing' && !state.workflow.inFlight);
    const first = await page.evaluate(() => ({ index: state.game.currentRiddleIndex, ...getCurrentRiddle() }));
    assert.equal(first.answer, '安全带');
    await page.locator('#playerInput').fill('它是人造的吗？');
    await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => !state.workflow.inFlight && state.game.questionCount === 1);
    const progress = await page.evaluate(() => ({ questionCount: state.game.questionCount, facts: state.game.coveredFactKeys }));
    const previewCount = previews.length;
    await page.locator('[data-environment="城区雨天白天"]').click();
    await page.waitForTimeout(120);
    await page.locator('[data-environment="风景区雪景白天"]').click();
    await page.waitForFunction(() => roundQuestionPreparations.get(state.workflow.gameId + '-round-2')?.riddleIndex === 5);
    assert.equal(previews.length, previewCount + 1, 'rapid changes request only the latest snow puzzle');
    assert.equal(previews.at(-1).game.current_answer, '雪人');
    assert.deepEqual(await page.evaluate(() => ({ index: state.game.currentRiddleIndex, ...getCurrentRiddle() })), first);
    assert.deepEqual(await page.evaluate(() => ({ questionCount: state.game.questionCount, facts: state.game.coveredFactKeys })), progress);
    assert.equal(await page.locator('#gameScreen').innerText().then(text => text.includes('雪人')), false, 'future answer is not exposed');

    await page.locator('#playerInput').fill(first.answer);
    await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => state.game.status === 'victory' && !state.workflow.inFlight);
    await page.evaluate(() => {
      clearNextRoundTimer(); clearResultFeedback(); clearHostSpeechLock(); state.host.text = '';
      advanceAfterVictory(1);
    });
    await page.waitForFunction(() => state.game.status === 'playing' && state.game.roundIndex === 2 && !!state.game.roundQuestionPlan);
    assert.equal(await page.evaluate(() => getCurrentRiddle().answer), '雪人');
    assert.equal(await page.evaluate(() => state.game.roundQuestionPlan.steps[0].variants.default), '它是用雪做的吗？');
    await page.locator('#playerInput').fill('它是用雪做的吗？');
    await page.locator('#sendQuestion').click();
    await page.waitForFunction(() => !state.workflow.inFlight && state.game.questionCount === 1);
    assert.equal(chats.at(-1).game.current_answer, '雪人');
    await page.waitForFunction(() => !questionIntro.active);
    assert.equal(await page.locator('#riddleTitle').innerText(), await page.evaluate(() => getCurrentRiddle().hint));
    fs.mkdirSync('tmp', { recursive: true });
    await page.screenshot({ path: 'tmp/environment-riddle-snow.png' });

    await page.locator('[data-environment="城区雨天白天"]').click();
    await page.waitForFunction(() => roundQuestionPreparations.get(state.workflow.gameId + '-round-3')?.riddleIndex === 0);
    assert.equal(await page.evaluate(() => getCurrentRiddle().answer), '雪人');
    await page.evaluate(() => jumpToQuestionSeconds(1));
    await page.waitForFunction(() => state.game.status === 'failed');
    await page.evaluate(() => { clearNextRoundTimer(); advanceAfterTimeout(2); });
    await page.waitForFunction(() => state.game.status === 'playing' && state.game.roundIndex === 3 && !!state.game.roundQuestionPlan);
    assert.equal(await page.evaluate(() => getCurrentRiddle().answer), '雨伞');
    assert.equal(await page.evaluate(() => state.game.roundQuestionPlan.steps[0].variants.default), '它可以挡雨吗？');
    await page.locator('[data-environment="风景区雪景白天"]').click();
    await page.waitForFunction(() => roundQuestionPreparations.get(state.workflow.gameId + '-round-4')?.riddleIndex === 9);
    assert.equal(previews.at(-1).game.current_answer, '草原', 'snow already played, so prefer the unused scenic puzzle');
    assert.deepEqual(await page.evaluate(() => state.game.playedRiddleIndices), [1, 5, 0]);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForFunction(() => !questionIntro.active);
    await page.screenshot({ path: 'tmp/environment-riddle-rain-small.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: real controls debounce, active facts stay intact, victory/timeout lock new puzzles, previews and Chatflow snapshots agree, no repeats or future-answer leak.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
