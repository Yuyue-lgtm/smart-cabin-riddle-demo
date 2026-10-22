const assert = require("node:assert/strict");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1940, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { document.hasFocus = () => true; });
    await page.route("**/api/**", route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: false } } }));
    await page.goto(process.env.TEST_DEMO_URL || "http://127.0.0.1:4175/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      startupLoading.active = false;
      finishTimelineSilently(); clearQuestionClock(); clearHostSpeechLock();
      state.game.status = "playing";
      state.timeline.status = "running";
      state.host.text = "上一条正在播放的回复";
      // Hold synthesis open to reproduce the queue without producing audio.
      state.workflow.hostSpeech.voicePending = true;
      window.submissionBubbleCount = 0;
      const original = showPassengerBubble;
      showPassengerBubble = (...args) => { window.submissionBubbleCount++; return original(...args); };
      render();
    });
    const answer = await page.evaluate(() => getCurrentRiddle().answer);
    await page.locator("#playerInput").fill(answer);
    const started = Date.now();
    await page.locator("#sendQuestion").click();
    await page.waitForFunction(() => state.game.status === "victory", { timeout: 2000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `correct answer waited ${elapsed}ms`);
    const result = await page.evaluate(() => ({
      status: state.game.status, correctSeat: state.ui.correctSeat,
      source: state.workflow.hostSpeech.source, pending: state.workflow.pendingChats.length,
      bubbles: window.submissionBubbleCount,
      deferredSources: state.workflow.deferredHostReplies.map(reply => reply.options.source),
    }));
    assert.equal(result.correctSeat, "front");
    assert.equal(result.source, "victory");
    assert.equal(result.pending, 0);
    assert.equal(result.bubbles, 1);
    assert.equal(result.deferredSources.includes("queued_question"), false);
    assert.equal(await page.locator(".host-bubble").isVisible(), true);
    await page.screenshot({ path: "tmp/player-submission-chrome.png" });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, elapsed_ms: elapsed, ...result }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
