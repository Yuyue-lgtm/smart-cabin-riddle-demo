const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/';

function previewResponse(input) {
  return { route: 'preview', game_id: input.game_id, round_id: input.round_id,
    scene_version: input.scene_version, event_type: input.event.type, event_id: input.event.id,
    workflow_output: JSON.stringify({ preview_status: 'ready', round_question_plan: {
      plan_id: input.round_id, steps: Array.from({ length: 4 }, (_, i) => ({
        id: `step_${i}`, fact_key: `fact_${i}`, variants: { default: `虚构测试问题${i}？` },
      })),
    } }) };
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  fs.mkdirSync('tmp/game-loading', { recursive: true });
  const reports = [];
  async function fixture({ failed = false, viewport = { width: 2380, height: 1120 } } = {}) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const requests = [], errors = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { document.hasFocus = () => true; });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/health') return route.fulfill({ json: { workflow_proxy: { configured: true } } });
      if (url.pathname === '/api/readiness') return route.fulfill({ json: { ok: true, routes: {} } });
      if (url.pathname !== '/api/workflow') return route.fulfill({ json: { ok: true } });
      const input = JSON.parse(route.request().postDataJSON().input_payload);
      requests.push(input);
      if (requests.length === 1) {
        if (failed) return route.fulfill({ status: 502, json: { message: 'fixture_failure' } });
        await gate;
      }
      await route.fulfill({ json: previewResponse(input) }).catch(() => {});
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    return { page, context, requests, errors, release };
  }
  try {
    const normal = await fixture();
    const { page } = normal;
    await page.waitForFunction(() => startupLoading.tasks.length && startupLoading.tasks
      .filter(task => task.id !== 'first-preview').every(task => task.status === 'ready'));
    assert.equal(normal.requests.length, 1);
    assert.equal(await page.evaluate(() => getGameScreenMode()), 'loading');
    assert.equal(await page.locator('#switchScenario').isDisabled(), true);
    assert.equal(await page.locator('#loadingActions').isVisible(), false);
    const geometry = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.loading-content'));
      const icon = document.querySelector('.loading-icon');
      return { x: style.left, y: style.top, width: style.width,
        iconWidth: getComputedStyle(icon).width, iconHeight: getComputedStyle(icon).height,
        iconLoaded: icon.complete && icon.naturalWidth > 0,
        track: getComputedStyle(document.querySelector('.loading-track')).height };
    });
    assert.deepEqual(geometry, { x: '441px', y: '301px', width: '558px', iconWidth: '130px',
      iconHeight: '130px', iconLoaded: true, track: '12px' });
    await page.locator('#gameScreen').screenshot({ path: 'tmp/game-loading/desktop.png' });
    normal.release();
    await page.waitForFunction(() => getGameScreenMode() === 'ready');
    assert.equal(await page.locator('#soundOnboarding').isVisible(), false);
    await page.waitForFunction(() => scenarioFirstRoundPreparations.size === 6
      && [...scenarioFirstRoundPreparations.values()].every(entry => entry.status === 'ready'));
    assert.equal(normal.requests.length, 6);
    await page.locator('#switchScenario').click();
    await page.waitForFunction(() => roundQuestionPreparations.get(getDifyRoundScopeKey()).status === 'ready');
    assert.equal(normal.requests.length, 6);
    await page.waitForFunction(() => !els.soundOnboarding.hidden, undefined, { timeout: 6000 });
    assert.equal(await page.evaluate(() => getComputedStyle(els.hostBubble).display), 'none');
    assert.deepEqual(normal.errors, []);
    reports.push({ case: 'default gate, geometry, six cached scenes, fresh scopes, onboarding', requests: normal.requests.length });
    await normal.context.close();

    const failure = await fixture({ failed: true });
    await failure.page.waitForFunction(() => startupLoading.tasks.some(task => task.status === 'failed'));
    await failure.page.waitForFunction(() => startupLoading.tasks.filter(task => task.id !== 'first-preview').every(task => task.status === 'ready'));
    assert.equal(await failure.page.locator('#loadingActions').isVisible(), true);
    await failure.page.locator('#loadingRetry').click();
    await failure.page.waitForFunction(() => getGameScreenMode() === 'ready');
    assert.equal(await failure.page.evaluate(() => startupLoading.tasks.filter(task => task.id !== 'first-preview').every(task => task.attempts === 1)), true);
    assert.deepEqual(failure.errors, []);
    reports.push({ case: 'retry failed preview only; keep successful assets' });
    await failure.context.close();

    const timeout = await fixture({ viewport: { width: 390, height: 844 } });
    await timeout.page.waitForFunction(() => startupLoading.tasks.length > 0);
    await timeout.page.locator('#loadingContinue').waitFor({ state: 'visible', timeout: 25000 });
    assert.equal(timeout.requests.length, 1);
    assert.equal(await timeout.page.locator('#loadingRetry').isDisabled(), true);
    const scroll = await timeout.page.evaluate(() => ({
      content: document.querySelector('.loading-content').scrollWidth,
      width: document.querySelector('.loading-content').clientWidth,
    }));
    assert.equal(scroll.content, scroll.width);
    await timeout.page.locator('#gameScreen').screenshot({ path: 'tmp/game-loading/mobile-timeout.png' });
    await timeout.page.locator('#loadingContinue').click();
    await timeout.page.waitForFunction(() => getGameScreenMode() === 'ready');
    timeout.release();
    assert.deepEqual(timeout.errors, []);
    reports.push({ case: 'real 20-second timeout, no duplicate pending request, mobile, continue' });
    await timeout.context.close();
    console.log(JSON.stringify({ ok: true, reports }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
