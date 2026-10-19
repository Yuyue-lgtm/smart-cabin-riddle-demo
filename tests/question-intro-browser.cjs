const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/health", route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route("**/api/workflow", route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const hit = body.route === "chat" && input.player_input === input.game.current_answer;
      const output = body.route === "preview" ? { round_question_plan: null } : {
        intent: hit ? "guess" : "event", ai_reply_text: hit ? "答对了。" : "",
        game_status: hit ? "victory" : input.game.status, is_correct: hit,
        covered_fact_keys: [], execution: { actions: [] }, decision_trace: { guard_status: "passed" },
      };
      return route.fulfill({ json: {
        route: body.route === "situation" ? "skipped" : body.route,
        game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type, workflow_output: JSON.stringify(output),
      } });
    });
    await page.goto(process.env.TEST_DEMO_URL || "http://127.0.0.1:4187/", { waitUntil: "networkidle" });
    fs.mkdirSync("tmp", { recursive: true });

    async function assertIntro(round) {
      await page.waitForFunction(index => questionIntro.active && state.game.roundIndex === index, round);
      const started = Date.now();
      assert.equal(await page.locator("#riddleTitle").innerText(), `第 ${round} 题`, "round number must render as soon as the intro starts");
      assert.equal(await page.locator("#riddleTitle").evaluate(el => el.classList.contains("question-intro")), true);
      assert.equal(await page.locator("#questionTimer").isVisible(), false);
      assert.equal(await page.locator(".remaining-questions").isVisible(), false);
      await page.waitForTimeout(600);
      assert.equal(await page.locator("#riddleTitle").evaluate(el => getComputedStyle(el).animationName), "question-number-pop");
      await page.locator(".riddle-panel").screenshot({ path: `tmp/question-intro-round-${round}.png` });
      await page.waitForFunction(() => !questionIntro.active);
      assert.ok(Date.now() - started >= 2600, "intro must stay visible for about 3 seconds");
      assert.equal(await page.locator("#riddleTitle").innerText(), await page.evaluate(() => getCurrentRiddle().hint));
      assert.equal(await page.locator("#questionTimer").isVisible(), true);
      assert.equal(await page.locator(".remaining-questions").isVisible(), true);
    }

    await page.locator("#readyStartButton").click();
    await assertIntro(1);

    await page.locator("#playerInput").fill(await page.evaluate(() => getCurrentRiddle().answer));
    await page.locator("#sendQuestion").click();
    await page.waitForFunction(() => state.game.status === "victory" && !state.workflow.inFlight);
    await page.evaluate(() => {
      clearNextRoundTimer(); clearResultFeedback(); clearHostSpeechLock(); state.host.text = "";
      advanceAfterVictory(1);
    });
    await assertIntro(2);

    await page.evaluate(() => jumpToQuestionSeconds(1));
    await page.waitForFunction(() => state.game.status === "failed");
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => { clearNextRoundTimer(); advanceAfterTimeout(2); });
    await assertIntro(3);
    assert.deepEqual(errors, []);
    console.log("PASS: first round, correct-answer handoff and timeout handoff render the animated round number for 3 seconds, hide timer/count during it, then restore the hint and controls.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
