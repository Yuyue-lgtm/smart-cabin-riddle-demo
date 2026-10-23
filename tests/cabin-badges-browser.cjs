const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], checks = [], readyScenes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/health') return route.fulfill({ json: { workflow_proxy: { configured: true } } });
      if (url.pathname !== '/api/workflow') return route.fulfill({ json: { ok: true } });
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      return route.fulfill({ json: { route: body.route, game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_id: input.event?.id, event_type: input.event?.type,
        workflow_output: JSON.stringify({ preview_status: 'ready', round_question_plan: {
          plan_id: input.round_id, steps: Array.from({ length: 4 }, (_, i) => ({ id: `step-${i}`,
            order: i + 1, fact_key: `fact-${i}`, depends_on: [], variants: { default: `测试问题${i}？` } })),
        } }) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !startupLoading.active && getGameScreenMode() === 'ready', undefined, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const previews = [
      ['城市白天', 'city-day', '车库'], ['城市夜晚', 'city-night', '城区夜晚'],
      ['雪景', 'snow-day', '风景区雪景白天'], ['傍晚', 'scenic-sunset', '风景区傍晚'],
      ['风景区', 'scenic-day', '风景区晴天白天'], ['城市白天', 'city-day', '车库'],
    ];
    for (const [index, [label, image, actual]] of previews.entries()) {
      if (index) await page.locator('#switchScenario').click();
      await page.waitForFunction(image => {
        const img = document.querySelector('.environment-backdrop-image');
        return img.complete && img.naturalWidth > 0 && img.getAttribute('src').includes(`cabin-env-${image}.webp`);
      }, image);
      assert.equal(await page.locator('#environmentLabel').textContent(), `车外环境：${label}`);
      assert.equal(await page.evaluate(() => state.car.environment), actual);
      assert.equal(await page.evaluate(() => getGameScreenMode()), 'ready');
      readyScenes.push({ label, image, actual });
    }
    await page.screenshot({ path: 'tmp/cabin-ready-environment.png' });
    await page.evaluate(() => { state.game.status = 'playing'; render(); });
    await page.waitForFunction(() => document.querySelector('.environment-backdrop-image').getAttribute('src').includes('cabin-env-garage.webp'));
    assert.equal(await page.locator('#environmentLabel').textContent(), '车外环境：车库');
    for (const viewport of [{ width: 2380, height: 1120 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const results = await page.evaluate(() => {
        const cases = [];
        for (const environment of [...document.querySelectorAll('#environmentChips [data-environment]')].map(el => el.dataset.environment)) {
          for (const destination of ['公司', '草原', '迪士尼', '观星营地', '重庆南山观星营地']) {
            for (const speed of [80, 120, 121, 130, 80]) {
              state.car.environment = environment; state.car.destination = destination; state.car.speed = speed; render();
              const read = selector => {
                const el = document.querySelector(selector), style = getComputedStyle(el);
                const text = el.querySelector('b') || el;
                const bounds = el.getBoundingClientRect(), parent = document.querySelector('.scene-badges').getBoundingClientRect();
                return { left: (bounds.left - parent.left) * 810 / parent.width,
                  top: (bounds.top - parent.top) * 810 / parent.width, width: bounds.width * 810 / parent.width,
                  height: bounds.height * 810 / parent.width, clipped: text.scrollWidth > text.clientWidth + 1,
                  hidden: el.hidden, display: style.display, text: text.textContent,
                  textOverflow: getComputedStyle(text).textOverflow };
              };
              cases.push({ environment, destination, kmh: speed,
                environmentBadge: read('.environment-badge'), destinationBadge: read('.destination-badge'), speed: read('.speed-badge') });
            }
          }
        }
        return cases;
      });
      for (const row of results) {
        assert.ok(Math.abs(row.environmentBadge.left - 43) < 0.1);
        assert.ok(Math.abs(row.destinationBadge.left + row.destinationBadge.width - 765) < 0.1);
        assert.equal(row.speed.hidden, row.kmh <= 120);
        assert.equal(row.speed.text, `${row.kmh} km/h`);
        if (row.kmh > 120) {
          assert.equal(row.speed.display, 'flex');
          assert.ok(Math.abs(row.destinationBadge.left - row.speed.left - row.speed.width - 20) < 0.1);
          assert.ok(Math.abs(row.speed.top - row.destinationBadge.top) < 0.1);
          assert.ok(row.environmentBadge.left + row.environmentBadge.width < row.speed.left);
          assert.equal(row.speed.clipped, false);
        } else {
          assert.equal(row.speed.display, 'none');
          assert.equal(row.speed.width, 0);
        }
        assert.notEqual(row.destinationBadge.textOverflow, 'ellipsis');
        for (const badge of [row.environmentBadge, row.destinationBadge]) {
          assert.ok(Math.abs(badge.top - 62) < 0.1); assert.ok(Math.abs(badge.height - 46) < 0.1); assert.equal(badge.clipped, false);
        }
        assert.ok(row.environmentBadge.left + row.environmentBadge.width < row.destinationBadge.left);
      }
      assert.ok(new Set(results.map(row => row.environmentBadge.width)).size > 1);
      assert.ok(new Set(results.map(row => row.destinationBadge.width)).size > 1);
      await page.evaluate(() => { state.car.environment = '风景区晴天白天'; state.car.destination = '观星营地'; render(); });
      await page.screenshot({ path: `tmp/cabin-badges-${viewport.width}.png` });
      await page.evaluate(() => { state.car.speed = 130; render(); });
      await page.screenshot({ path: `tmp/cabin-badges-overspeed-${viewport.width}.png` });
      checks.push({ viewport, cases: results.length, no_clipping_or_overlap: true });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync('tmp/cabin-badges-browser.json', JSON.stringify({ passed: true, readyScenes, checks, errors }, null, 2) + '\n');
    console.log(JSON.stringify({ passed: true, readyScenes, checks, errors, audio_output_muted: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
