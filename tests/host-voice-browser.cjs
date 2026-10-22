const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const audio = fs.readFileSync('assets/host-yes.mp3');
    const requests = [], errors = [];
    let failVoice = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/client-diagnostic', route => route.fulfill({ status:202, json:{ok:true} }));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true,
      host_voice_configured: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      return route.fulfill({ json: { route: body.route, game_id: input.game_id, round_id: input.round_id,
        scene_version: input.scene_version, event_id: input.event?.id, event_type: input.event?.type, workflow_output: '{}' } });
    });
    await page.route('**/api/tts', async route => {
      requests.push(route.request().postDataJSON());
      if (failVoice) return route.fulfill({ status: 502, json: { error: 'TTS_UPSTREAM_FAILED' } });
      return route.fulfill({ contentType: 'audio/mpeg', body: audio });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4179/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => state.health.hostVoiceConfigured);
    assert.equal(requests.length, 0, 'hidden ready-page bubble does not synthesize');
    await page.locator('#backgroundMusicToggle').click();
    assert.equal(requests.length, 0, 'enabling sound on the ready page does not speak hidden text');
    await page.locator('#readyStartButton').click();
    await page.evaluate(() => {
      finishTimelineSilently(); clearQuestionClock(); clearHostSpeechLock();
      clearResultFeedback(); clearNextRoundTimer(); state.host.text = ''; render();
    });
    for (const source of ['victory', 'question_timeout', 'game_summary', 'hard_brake']) {
      const previous = requests.length;
      await page.evaluate(source => {
        publishHostLine(`虚构测试：${source}`, { priority: 'P0', source }); render();
      }, source);
      await page.waitForFunction(() => state.workflow.hostSpeech.voicePlaying);
      assert.equal(requests.length, previous + 1, source);
      await page.evaluate(() => { render(); render(); });
      assert.equal(requests.length, previous + 1, 'repaint does not repeat synthesis');
      assert.equal(await page.locator('.host-bubble').isVisible(), true);
      if (source === 'hard_brake') {
        await page.evaluate(() => toggleTimelinePause());
        assert.equal(await page.evaluate(() => hostVoicePlayback.audio.paused), true);
        const position = await page.evaluate(() => hostVoicePlayback.audio.currentTime);
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => hostVoicePlayback.audio.currentTime), position);
        await page.evaluate(() => toggleTimelinePause());
      }
      await page.waitForFunction(() => !state.workflow.hostSpeech.voicePlaying && !state.workflow.hostSpeech.voicePending);
    }
    await page.evaluate(() => {
      publishHostLine('虚构测试：播放时关闭声音', { priority: 'P0', source: 'hard_brake' }); render();
    });
    await page.waitForFunction(() => state.workflow.hostSpeech.voicePlaying);
    await page.locator('#backgroundMusicToggleGame').click();
    assert.equal(await page.evaluate(() => state.workflow.hostSpeech.voicePlaying || state.workflow.hostSpeech.voicePending), false);
    assert.equal(await page.evaluate(() => hostVoicePlayback.audio), null);
    const mutedCount = requests.length;
    await page.evaluate(() => {
      publishHostLine('虚构测试：静音只保留文字', { priority: 'P0', source: 'hard_brake' }); render(); render();
    });
    assert.equal(requests.length, mutedCount, 'muted lines do not call TTS');
    assert.equal(await page.locator('.host-bubble').isVisible(), true);
    await page.locator('#backgroundMusicToggleGame').click();
    await page.evaluate(() => render());
    assert.equal(requests.length, mutedCount, 'enabling sound does not replay old text');
    failVoice = true;
    await page.evaluate(() => {
      publishHostLine('虚构测试：失败保留文字', { priority: 'P0', source: 'hard_brake' }); render();
    });
    await page.waitForFunction(() => state.workflow.hostSpeech.voiceRequested && !state.workflow.hostSpeech.voicePending);
    assert.equal(await page.locator('.host-bubble').isVisible(), true);
    assert.equal(await page.evaluate(() => state.workflow.hostSpeech.voicePlaying), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', local_sources: 4, checks: ['actual MP3 playback', 'once per speech',
      'pause/resume', 'text fallback', 'ready-page silence', 'shared sound toggle', 'muted lines skip TTS'], errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
