const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], requests = [], pendingScenes = [], pendingReplies = [];
    let silent = false, holdReplies = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/health", route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route("**/api/workflow", async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      requests.push({ body, input });
      const scope = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type };
      if (body.route === "preview") return route.fulfill({ json: { route: "preview", ...scope, workflow_output: JSON.stringify({ round_question_plan: null }) } });
      if (body.route === "situation") {
        const shouldSpeak = !silent && input.event.priority !== "P0";
        if (shouldSpeak) await new Promise(resolve => pendingScenes.push(resolve));
        const scene = { ...scope, analysis_status: "ready", request_proactive_speech: shouldSpeak,
          expires_at_ms: Date.now() + 60000, host_response: null };
        return route.fulfill({ json: { route: "situation", ...scope, scene_output: scene,
          situation_handoff: shouldSpeak ? "browser-test-handoff" : null,
          workflow_output: JSON.stringify({ scene_output: scene, ai_reply_text: "", decision_trace: { guard_status: "passed" } }) } });
      }
      if (holdReplies) await new Promise(resolve => pendingReplies.push(resolve));
      return route.fulfill({ json: { route: "chat", operation: "situation_reply", ...scope, conversation_id: "browser-global-conversation",
        workflow_output: JSON.stringify({ ai_reply_text: input.car.environment === "隧道" ? "我们进入隧道啦。" : "我们来到车库啦。",
          intent: "event", decision_trace: { guard_status: "passed" }, execution: { actions: [] } }) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || "http://127.0.0.1:4186/", { waitUntil: "domcontentloaded" });
    await page.locator("#readyStartButton").click();
    await page.waitForFunction(() => state.game.status === "playing");
    await page.evaluate(() => {
      finishTimelineSilently(); clearHostSpeechLock(); state.host.text = "";
      publishHostLine("这是还没说完的乘客回答。", { source: "chat" }); render();
    });
    const firstVisibleAt = await page.evaluate(() => state.workflow.hostSpeech.visibleAt);
    await page.locator('[data-environment="隧道"]').click();
    await page.waitForFunction(() => state.workflow.situationInFlight);
    await page.waitForTimeout(150);
    assert.equal(requests.filter(row => row.body.operation === "situation_reply").length, 0);
    assert.equal(await page.locator("#hostBubble").innerText(), "这是还没说完的乘客回答。");
    pendingScenes.shift()();
    await page.waitForFunction(() => state.workflow.hostSpeech.source === "environment");
    const elapsed = await page.evaluate(start => Date.now() - start, firstVisibleAt);
    assert.ok(elapsed >= 1500, `Bubble minimum ${elapsed}ms`);
    assert.equal(await page.locator("#hostBubble").innerText(), "我们进入隧道啦。");
    assert.equal(await page.evaluate(() => state.workflow.hostThinkingActive), false);
    assert.equal(requests.filter(row => row.body.operation === "situation_reply").length, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem(DIFY_CONVERSATION_STORAGE_KEY)), "browser-global-conversation");
    await page.screenshot({ path: "tmp/situation-dialogue-environment.png" });
    await page.waitForFunction(() => state.workflow.hostSpeech.source === "chat");
    assert.equal(await page.locator("#hostBubble").innerText(), "这是还没说完的乘客回答。");

    await page.evaluate(() => { clearHostSpeechLock(); state.host.text = ""; render(); });
    holdReplies = true;
    await page.locator('[data-environment="车库"]').click();
    await page.waitForFunction(() => state.workflow.situationInFlight);
    await page.waitForTimeout(100); pendingScenes.shift()();
    await page.waitForFunction(() => state.workflow.inFlight);
    await page.locator('[data-event="hard_brake"]').click();
    await page.waitForFunction(() => state.game.status === "paused");
    assert.equal(await page.locator("#hostBubble").innerText(), "大家坐稳，游戏先暂停。");
    pendingReplies.shift()();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => state.game.status), "paused");
    assert.equal(await page.locator("#hostBubble").innerText(), "大家坐稳，游戏先暂停。");
    await page.waitForFunction(() => state.game.status === "playing", { timeout: 6000 });

    silent = true; holdReplies = false;
    const types = await page.locator('.event-button').evaluateAll(buttons => buttons.map(button => button.dataset.event));
    assert.equal(types.length, 9);
    for (const type of types.filter(type => type !== "hard_brake")) {
      const before = requests.filter(row => row.body.route === "situation" && row.input.event.type === type).length;
      await page.locator(`[data-event="${type}"]`).click();
      await page.waitForFunction(() => !state.workflow.situationInFlight);
      assert.ok(requests.filter(row => row.body.route === "situation" && row.input.event.type === type).length > before, type);
    }
    await page.screenshot({ path: "tmp/situation-dialogue-controls.png" });
    assert.deepEqual(errors, []);
    console.log("PASS Chrome: sequential analysis/Chatflow, minimum bubble time, shared conversation, no event thinking, P0 protection, nine event buttons and no page errors.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
