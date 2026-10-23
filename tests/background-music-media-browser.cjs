const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const src = fs.readFileSync('index.html', 'utf8').match(/id="backgroundMusic" src="([^"]+)"/)[1];
    assert.ok(src.startsWith('./assets/'));
    const url = new URL(src, process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/');
    await page.setContent(`<audio src="${url}" loop></audio>`);
    await page.evaluate(async () => { const audio = document.querySelector('audio'); audio.volume = 0.175; await audio.play(); });
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 0.2);
    const result = await page.evaluate(() => {
      const audio = document.querySelector('audio');
      return { duration: audio.duration, currentTime: audio.currentTime, loop: audio.loop,
        volume: audio.volume, error: audio.error?.code || null };
    });
    assert.ok(Number.isFinite(result.duration) && result.duration > 0);
    assert.equal(result.loop, true); assert.equal(result.volume, 0.175); assert.equal(result.error, null);
    console.log(JSON.stringify({ passed: true, ...result, browser_output_muted: true, autoplay_policy_overridden_for_decode_test: true }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
