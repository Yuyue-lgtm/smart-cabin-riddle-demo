const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const feedbackRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/health", route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route("**/api/workflow", async route => {
      const body = route.request().postDataJSON();
      const input = JSON.parse(body.input_payload);
      const scope = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type };
      if (body.route === "preview") {
        await route.fulfill({ json: { route: "preview", ...scope, workflow_output: JSON.stringify({ round_question_plan: null }) } });
      } else if (body.route === "situation" && input.event?.type === "post_result_feedback") {
        feedbackRequests.push(input);
        const response = { ai_reply_text: "副驾累计拿下六题了，今天判断很稳。", strategy: "encourage", target_seat: null,
          decision_trace: { schema_version: 2, guard_status: "passed" }, execution: { actions: [] } };
        const scene = { ...scope, feedback_id: input.host_feedback.id, analysis_status: "ready",
          request_proactive_speech: true, expires_at_ms: Date.now() + 12000 };
        await route.fulfill({ json: { route: "situation", ...scope,
          situation_handoff:"browser-feedback-handoff",
          workflow_output: JSON.stringify({ ...response, ai_reply_text:"", scene_output: scene }), scene_output: scene } });
      } else if (body.route === "chat") {
        await route.fulfill({ json: { route: "chat", operation:body.operation || "passenger_chat", ...scope, workflow_output: JSON.stringify({
          ai_reply_text: body.operation === "situation_reply" ? "副驾累计拿下六题了，今天判断很稳。" : "你刚才那道题判断得很漂亮！",
          intent:body.operation === "situation_reply" ? "event" : "smalltalk",decision_trace:{guard_status:"passed"},
          game_status: "victory", is_correct: false, ui_change: {},
        }) } });
      } else await route.fulfill({ json: { route: "skipped", ...scope } });
    });
    await page.goto(process.env.TEST_DEMO_URL || "http://127.0.0.1:4186/", { waitUntil: "domcontentloaded" });
    assert.ok(await page.locator('script[src*="situation-dialogue-v1"]').count());
    await page.waitForFunction(() => state.workflow.gameId && els.playerInput);
    await page.evaluate(() => {
      finishTimelineSilently(); clearHostSpeechLock(); clearQuestionClock();
      state.game.roundIndex = 6; state.game.status = "playing"; state.timeline.status = "finished";
      state.host.preferences = { praise: true, brief: false, invitations: true, independent: false };
      state.game.performance.results = Array.from({ length: 5 }, (_, index) => ({
        round_id: `${state.workflow.gameId}-round-${index + 1}`, round_index: index + 1, correct_seat: "front", contributors: ["front"],
      }));
      const input = buildWorkflowInput("chat", null, getCurrentRiddle().answer);
      applyWorkflowOutput(localDecision(input), input, "local"); render();
    });
    await page.waitForFunction(() => state.workflow.hostSpeech.source === "victory");
    await page.waitForFunction(() => state.workflow.hostSpeech.source === "post_result_feedback", { timeout: 12000 });
    assert.equal(feedbackRequests.length, 1);
    assert.deepEqual(feedbackRequests[0].host_feedback.candidate_ids, ["HK12", "HK10"]);
    assert.equal(await page.locator("#hostBubble").innerText(), "副驾累计拿下六题了，今天判断很稳。");
    assert.equal(await page.evaluate(() => state.game.roundIndex), 6);
    assert.equal(await page.evaluate(() => getSummarySolvedCount()), 6);
    await page.screenshot({ path: "tmp/host-experiences-feedback.png" });

    await page.evaluate(() => {
      clearResultFeedback(); clearHostSpeechLock(); state.host.text = "";
      state.game.status = "playing"; state.game.roundIndex = 7;
      const input = buildWorkflowInput("chat", null, getCurrentRiddle().answer);
      applyWorkflowOutput(localDecision(input), input, "local"); render();
    });
    await page.locator("#playerInput").fill("夸一下我");
    await page.locator("#sendQuestion").click();
    await page.waitForFunction(() => state.host.text === "你刚才那道题判断得很漂亮！", { timeout: 12000 });
    assert.equal(await page.evaluate(() => state.game.roundIndex), 7);
    assert.equal(await page.evaluate(() => state.workflow.hostThinkingActive), false);
    assert.equal(await page.locator("#hostBubble").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log("PASS Chrome: v4 served, actual six-question stats, model achievement bubble after P0, explicit praise before next round, no page errors.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
