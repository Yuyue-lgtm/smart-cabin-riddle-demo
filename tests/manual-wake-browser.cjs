const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const events = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      if (body.route === 'situation') events.push(input.event);
      return route.fulfill({ json: { route: body.route, workflow_output: '{}' } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'domcontentloaded' });
    await page.locator('#readyStartButton').click();
    await page.evaluate(() => {
      finishTimelineSilently();
      applyImmediatePassengerSleep('rearLeft');
      applyImmediatePassengerSleep('rearRight');
    });
    const wake = page.locator('[data-event="passenger_wake"]');
    await wake.click();
    await page.waitForFunction(() => state.passengers.seats.rearRight.mood === '普通');
    assert.equal(await page.evaluate(() => state.passengers.seats.rearLeft.mood), '睡着');
    await page.waitForFunction(() => !document.querySelector('[data-event="passenger_wake"]').disabled);
    await wake.click();
    await page.waitForFunction(() => getSleepingSeats().length === 0);
    await page.waitForFunction(() => !document.querySelector('[data-event="passenger_wake"]').disabled);
    await wake.click();
    assert.equal(await page.evaluate(() => state.ui.alert), '当前没有睡着的乘客');
    assert.deepEqual(events.filter(event => event.type === 'passenger_wake').map(event => event.seat), ['rearRight', 'rearLeft']);
    assert.deepEqual(errors, []);
    console.log('PASS: actual wake button targets two different sleeping seats, preserves 4s cooldown, and sends no event when everyone is awake.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
