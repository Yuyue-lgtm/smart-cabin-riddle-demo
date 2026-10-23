const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const demoUrl = process.env.TEST_DEMO_URL || "http://127.0.0.1:4186/";

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const previews = [];
    const chats = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route("**/api/workflow", async (route) => {
      const body = route.request().postDataJSON();
      const input = JSON.parse(body.input_payload);
      const request = { route, body, input };
      if (body.route === "preview") previews.push(request);
      else if (body.route === "chat") chats.push(request);
      else await route.fulfill({ json: { route: "skipped", event_type: input.event?.type } });
    });

    const releasePreview = async ({ route, input }) => {
      await route.fulfill({ json: {
        route: "preview", game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_type: input.event.type, event_id: input.event.id,
        workflow_output: JSON.stringify({ round_question_plan: { plan_id: input.round_id, steps: [
          { id: "category", fact_key: "category", variants: { default: "它是人造的吗？" } },
          { id: "location", fact_key: "location", depends_on: ["category"], variants: { default: "它在室内常见吗？" } },
        ] } }),
      } });
    };

    await page.goto(demoUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => state.workflow.previewPending);
    assert.equal(previews.length, 1);
    const first = previews[0];
    assert.equal(first.input.game.round_index, 1);
    assert.equal(await page.locator("#readyStartButton").isEnabled(), true);
    await page.evaluate(() => savePersistentDifyConversationId("browser-global-session"));

    await page.locator("#readyStartButton").click();
    await page.waitForFunction(() => state.game.status === "playing" && questionClock.active);
    await page.waitForFunction(() => roundQuestionPreparations.size === 2);
    assert.equal(previews.length, 2);
    const second = previews[1];
    assert.equal(second.input.game.round_index, 2);
    assert.equal(await page.evaluate(() => state.workflow.hostThinkingActive), false);
    await page.evaluate(async () => {
      finishTimelineSilently();
      await runRandomTimelinePassengerQuestion();
    });
    assert.equal(await page.evaluate(() => state.game.questionCount), 0);
    assert.equal(chats.length, 0);

    await page.locator("#playerInput").fill("它是工具吗？");
    await page.locator("#sendQuestion").click();
    await page.waitForFunction(() => state.workflow.hostThinkingActive && hostSprite.playing);
    assert.equal(chats.length, 1);
    assert.equal(chats[0].body.conversation_id, "browser-global-session");
    assert.equal(await page.evaluate(() => hostSprite.source.split('?')[0]), "./assets/host-thinking.webp");
    const thinkingCycle = await page.evaluate(() => state.workflow.hostThinkingCycleId);
    await page.screenshot({ path: "tmp/preview-chat-thinking.png" });
    const chat = chats[0];
    await chat.route.fulfill({ json: {
      route: "chat", game_id: chat.input.game_id, round_id: chat.input.round_id,
      scene_version: chat.input.scene_version, conversation_id: "browser-global-session",
      workflow_output: JSON.stringify({ ai_reply_text: "不是，它不算工具。", game_status: "playing", covered_fact_keys: ["user-fact"] }),
    } });
    await page.waitForFunction(() => !state.workflow.inFlight);
    assert.equal(await page.evaluate(() => state.workflow.hostAwaitingReply), false);
    await page.evaluate(() => render());
    assert.equal(await page.evaluate(() => getHostPresentation().mediaHostState), "thinking");
    assert.equal(await page.evaluate(() => hostSprite.playing), true);
    assert.equal(await page.locator("#hostBubble").isVisible(), true);
    await page.waitForFunction(() => !state.workflow.hostThinkingActive && hostSprite.source !== RESOURCE_CONFIG.host.thinking.src);
    const idleChecks = await page.evaluate(async () => {
      const checks = [];
      for (let i = 0; i < 70; i += 1) {
        render();
        checks.push({ state: getHostPresentation().mediaHostState, cycle: state.workflow.hostThinkingCycleId });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return checks;
    });
    assert.ok(idleChecks.every((check) => check.state !== "thinking" && check.cycle === thinkingCycle));
    assert.equal(idleChecks.at(-1).state, "normal");
    await releasePreview(second);
    await page.waitForFunction((id) => roundQuestionPreparations.get(id).status === "ready", second.input.round_id);
    assert.equal(await page.evaluate(() => state.game.roundQuestionPlan), null);
    await releasePreview(first);
    await page.waitForFunction((id) => state.game.roundQuestionPlan?.id === id, first.input.round_id);
    assert.deepEqual(await page.evaluate(() => state.game.coveredFactKeys), ["user-fact"]);

    await page.evaluate(() => {
      invalidateAsyncHostResults();
      state.game.status = "victory";
      advanceAfterVictory(1);
    });
    await page.waitForFunction((id) => state.game.roundIndex === 2 && state.game.roundQuestionPlan?.id === id && questionClock.active, second.input.round_id);
    await page.waitForFunction(() => [...roundQuestionPreparations.values()].some((entry) => entry.roundIndex === 3));
    assert.equal(previews.length, 3);
    assert.equal(previews[2].input.game.round_index, 3);
    assert.equal(previews[2].input.game.current_answer, await page.evaluate(() => RIDDLES[(state.game.currentRiddleIndex + 1) % RIDDLES.length].answer));

    await page.evaluate(() => finishGameSeries());
    await page.waitForFunction(() => nextGamePreparation?.status === "pending");
    const nextGame = previews.at(-1);
    assert.equal(nextGame.input.game.round_index, 1);
    assert.notEqual(nextGame.input.game_id, first.input.game_id);
    assert.equal(await page.evaluate(() => state.workflow.hostThinkingActive), false);
    const countBeforeContinue = previews.length;
    await page.locator("#summaryContinue").dispatchEvent("click");
    await page.waitForFunction((id) => state.game.status === "idle" && state.workflow.gameId === id, nextGame.input.game_id);
    assert.equal(previews.length, countBeforeContinue);
    await releasePreview(nextGame);
    await page.waitForFunction(() => !state.workflow.previewPending);
    assert.equal(await page.evaluate(() => state.game.roundQuestionPlan), null);
    await page.locator("#readyStartButton").click();
    await page.waitForFunction((id) => state.game.status === "playing" && state.game.roundQuestionPlan?.id === id, nextGame.input.round_id);
    await page.waitForFunction(() => [...roundQuestionPreparations.values()].some((entry) => entry.roundIndex === 2));
    assert.equal(previews.length, countBeforeContinue + 1);
    assert.equal(await page.evaluate(() => getPersistentDifyConversationId()), "browser-global-session");

    await page.evaluate(() => { state.game.roundIndex = 5; persistDifyRoundScope(); });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => state.workflow.previewPending);
    assert.equal(await page.evaluate(() => state.game.roundIndex), 1);
    assert.equal(await page.evaluate(() => getPersistentDifyConversationId()), "browser-global-session");
    const readyPreview = previews.at(-1);
    await page.evaluate(() => setEnvironment("城区晴天白天"));
    await page.waitForFunction(() => [...roundQuestionPreparations.values()][0].input.game.current_answer === "红绿灯");
    assert.equal(await page.evaluate(() => state.game.currentRiddleIndex), 6);
    assert.equal(previews.at(-1).input.round_id, readyPreview.input.round_id);
    assert.notEqual(previews.at(-1).input.game.current_answer, readyPreview.input.game.current_answer);
    await page.screenshot({ path: "tmp/preview-ready.png" });
    assert.deepEqual(errors, []);
    console.log("PASS Chrome: thinking plays once across the answer bubble and never restarts after expiry; preview/start/round/session checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
