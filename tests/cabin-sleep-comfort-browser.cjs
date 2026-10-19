const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  let releaseHost;
  const hostArrived = new Promise((resolve) => { releaseHost = { arrived: resolve }; });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route("**/api/workflow", async (route) => {
      const body = route.request().postDataJSON();
      const input = JSON.parse(body.input_payload);
      const scope = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type };
      if (body.route === "preview") return route.fulfill({ json: { route: "preview", ...scope, workflow_output: "{}" } });
      if (body.route === "situation") {
        const scene = { ...scope, analysis_status: "ready", request_proactive_speech: false,
          request_host_decision: true, host_decision_seat: input.event.seat,
          generated_at_ms: Date.now(), expires_at_ms: Date.now() + 60000 };
        return route.fulfill({ json: { route: "situation", ...scope, scene_output: scene,
          situation_handoff: "comfort-browser-handoff", workflow_output: JSON.stringify({ ai_reply_text: "", scene_output: scene }) } });
      }
      const waking = input.event.type === "passenger_wake";
      if (!waking) {
        const arrived = releaseHost.arrived;
        await new Promise((resolve) => { releaseHost = resolve; arrived(); });
      }
      return route.fulfill({ json: { route: "chat", operation: "situation_reply", ...scope,
        workflow_output: JSON.stringify({ ai_reply_text: waking ? "你醒啦，我来恢复这边的灯光、空调和分区音量。" : "我来为休息的朋友关灯、降低分区音量，空调恢复记忆设置。", intent: "event",
          decision_trace: { guard_status: "passed" }, execution: { actions: [{ type: waking ? "cabin.restore_sleep_comfort" : "cabin.apply_sleep_comfort", seat: "rearRight" }] } }) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || "http://127.0.0.1:4186/", { waitUntil: "domcontentloaded" });
    await page.locator("#readyStartButton").click();
    await page.evaluate(() => { finishTimelineSilently(); clearHostSpeechLock(); state.host.text = ""; render(); });
    await page.locator('[data-event="passenger_sleep"]').click();
    await Promise.race([hostArrived, new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Sleep event did not reach the host dialogue route.")), 15000).unref();
    })]);
    assert.equal(await page.locator(".cabin-sleep-shade:not([hidden])").count(), 0);
    assert.equal(await page.locator(".cabin-zone-comfort:not([hidden])").count(), 0);
    await page.evaluate(() => {
      publishHostLine("这条优先提醒还没有说完。", { priority: "P1", source: "speed_overspeed", durationMs: 2000 });
      render();
    });
    releaseHost();
    await page.waitForFunction(() => state.workflow.deferredHostReplies.some((entry) => entry.options.startActions));
    assert.equal(await page.locator(".cabin-sleep-shade:not([hidden])").count(), 0);
    assert.equal(await page.locator("#hostBubble").innerText(), "这条优先提醒还没有说完。");
    await page.waitForFunction(() => state.ui.sleepComfortSeats.includes("rearRight"));
    assert.equal(await page.locator(".cabin-sleep-shade:not([hidden])").count(), 1);
    assert.equal(await page.locator(".cabin-zone-comfort:not([hidden])").count(), 1);
    assert.match(await page.locator("#hostBubble").innerText(), /关灯/);
    assert.match(await page.locator('[data-comfort-zone="rearRight"]').innerText(), /用户记忆值/);
    fs.mkdirSync("tmp", { recursive: true });
    await page.locator(".cabin-region").screenshot({ path: "tmp/cabin-sleep-comfort-single.png" });
    await page.evaluate(() => {
      applyImmediatePassengerWake("rearRight");
      void dispatchWorkflow("event", { id: "browser-wake", type: "passenger_wake", seat: "rearRight", priority: "P3" });
    });
    assert.equal(await page.locator(".cabin-sleep-shade:not([hidden])").count(), 1);
    await page.waitForFunction(() => state.workflow.deferredHostReplies.some((entry) => entry.options.startActions?.actions[0].type === "cabin.restore_sleep_comfort"));
    assert.equal(await page.locator(".cabin-sleep-shade:not([hidden])").count(), 1);
    await page.waitForFunction(() => !state.ui.sleepComfortSeats.includes("rearRight"));
    assert.equal(await page.locator(".cabin-sleep-shade:not([hidden])").count(), 0);
    assert.match(await page.locator("#hostBubble").innerText(), /恢复.*灯光、空调和分区音量/);
    await page.evaluate(() => {
      for (const seat of Object.keys(SEATS)) {
        applyImmediatePassengerSleep(seat);
        const input = { ...buildRealtimeChatInput(buildFullWorkflowInput("event", {
          id: `visual-${seat}`, type: "passenger_sleep", seat, priority: "P2",
        }, "")), trigger_type: "event", dialogue_request: { kind: "situation_event" } };
        applyWorkflowActions([{ type: "cabin.apply_sleep_comfort", seat }], input);
      }
      setEnvironment("风景区傍晚");
      render();
    });
    assert.equal(await page.locator(".cabin-zone-comfort:not([hidden])").count(), 4);
    const geometry = await page.locator(".cabin-zone-comfort").evaluateAll((zones) => zones.map((zone) => {
      const style = getComputedStyle(zone);
      return [zone.dataset.comfortZone, style.left, style.top, style.width, style.height];
    }));
    assert.deepEqual(geometry, [
      ["rearLeft", "170px", "635px", "147px", "44px"],
      ["rearRight", "484px", "635px", "147px", "44px"],
      ["front", "151px", "968px", "147px", "44px"],
      ["driver", "509px", "968px", "147px", "44px"],
    ]);
    const assets = await page.locator(".cabin-sleep-shade, .cabin-zone-setting img").evaluateAll((images) =>
      images.map((image) => image.complete && image.naturalWidth > 0));
    assert.ok(assets.every(Boolean));
    await page.locator(".cabin-region").screenshot({ path: "tmp/cabin-sleep-comfort-all.png" });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator(".cabin-region").screenshot({ path: "tmp/cabin-sleep-comfort-small.png" });
    await page.evaluate(() => resetCurrentGoldenLine());
    assert.equal(await page.locator(".cabin-sleep-shade:not([hidden])").count(), 0);
    assert.equal(await page.locator(".cabin-zone-comfort:not([hidden])").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: host-gated sleep comfort, four independent zones, Figma geometry, local assets, wake/reset, environment persistence and two viewport sizes.");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
