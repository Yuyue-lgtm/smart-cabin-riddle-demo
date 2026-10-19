const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const calls = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (request.url().endsWith("/api/workflow")) calls.push(request.postDataJSON());
    });
    await page.route("**/api/workflow", async route => {
      const body = route.request().postDataJSON();
      if (body.route !== "preview") return route.continue();
      const input = JSON.parse(body.input_payload);
      await route.fulfill({ json: { route: "preview", game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_type: input.event.type, event_id: input.event.id,
        workflow_output: JSON.stringify({ round_question_plan: null }) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || "http://127.0.0.1:4186/", { waitUntil: "domcontentloaded" });
    await page.locator("#readyStartButton").click();
    await page.waitForFunction(() => state.game.status === "playing");
    await page.evaluate(() => { finishTimelineSilently(); clearHostSpeechLock(); state.host.text = ""; render(); });
    const started = Date.now();
    await page.locator('[data-environment="隧道"]').click();
    await page.waitForFunction(() => state.workflow.hostSpeech.source === "environment", { timeout: 45000 });
    const text = await page.locator("#hostBubble").innerText();
    assert.match(text, /隧道/);
    assert.equal(await page.evaluate(() => state.workflow.hostThinkingActive), false);
    assert.equal(await page.evaluate(() => state.game.status), "playing");
    const eventCalls = calls.filter(body => ["situation", "chat"].includes(body.route));
    assert.equal(eventCalls.length, 2);
    assert.equal(eventCalls[0].route, "situation");
    assert.equal(eventCalls[1].operation, "situation_reply");
    assert.equal(JSON.parse(eventCalls[0].input_payload).event.id, JSON.parse(eventCalls[1].input_payload).event.id);
    assert.ok(await page.evaluate(() => localStorage.getItem(DIFY_CONVERSATION_STORAGE_KEY)));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: "tmp/situation-dialogue-live.png" });
    console.log(JSON.stringify({ passed: true, elapsed_ms: Date.now() - started, speech: text,
      real_published_workflow: true, real_chatflow: true, preview_stubbed: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
