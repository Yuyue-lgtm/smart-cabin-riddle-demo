const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const live = process.env.LIVE_VOICE === '1';
  const headerDelayMs = Number(process.env.FIXTURE_HEADER_DELAY_MS || 0);
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    const diagnostics = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/client-diagnostic') {
        const row = request.postDataJSON();
        if (row.type === 'host_voice') diagnostics.push(row);
      }
    });
    await page.addInitScript(({ audio, live, headerDelayMs }) => {
      document.hasFocus = () => true;
      if (live) return;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        if (url !== '/api/tts') return originalFetch(url, options);
        if (headerDelayMs) await new Promise(resolve => setTimeout(resolve, headerDelayMs));
        const bytes = Uint8Array.from(atob(audio), value => value.charCodeAt(0));
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(bytes.slice(0, 16));
          setTimeout(() => { controller.enqueue(bytes.slice(16)); controller.close(); }, 250);
        } }), { headers: { 'Content-Type': 'audio/mpeg' } });
      };
    }, { live, headerDelayMs, audio: fs.readFileSync('assets/host-yes.mp3').toString('base64') });
    await page.route('**/api/health', route => route.fulfill({ json: { host_voice_configured: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/readiness', route => route.fulfill({ json: { ok: true, routes: {} } }));
    await page.route('**/api/workflow', route => route.fulfill({ status: 502, json: { error: 'fixture_no_workflow' } }));
    if (!live) await page.route('**/api/client-diagnostic', route => route.fulfill({ status: 202, json: { ok: true } }));
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    const terminalDiagnostic = page.waitForRequest(request => {
      if (new URL(request.url()).pathname !== '/api/client-diagnostic') return false;
      const row = request.postDataJSON();
      return row.type === 'host_voice' && ['ended', 'failed'].includes(row.stage);
    }, { timeout: 60000 }).catch(() => null);
    await page.evaluate(async () => {
      render = () => {};
      startupLoading.active = false;
      state.game.status = 'playing';
      state.health.hostVoiceConfigured = true;
      backgroundMusic.enabled = true;
      if (simulationRuntime.paused) simulationRuntime.resume();
      publishHostLine('这是一段虚构的语音测试。请听主持人的声音是否连贯。', { priority: 'P0' });
      await startHostVoiceSpeech(state.workflow.hostSpeech.id, state.host.text);
    });
    await page.waitForFunction(() => state.workflow.hostSpeech.voiceFinished, null, { timeout: 45000 });
    await terminalDiagnostic;
    const report = { live, header_delay_ms: headerDelayMs, errors, diagnostics };
    fs.mkdirSync('tmp/voice-streaming', { recursive: true });
    fs.writeFileSync(`tmp/voice-streaming/${live ? 'live' : 'fixture'}.json`, JSON.stringify(report, null, 2));
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.ok(diagnostics.some(row => row.stage === 'playing'), 'audio starts playing');
    assert.ok(diagnostics.some(row => row.stage === 'ended'), 'audio reaches its real end');
    assert.equal(diagnostics.some(row => row.stage === 'failed'), false, JSON.stringify(diagnostics));
    if (headerDelayMs) assert.ok(diagnostics.find(row => row.stage === 'response').elapsed_ms >= headerDelayMs);
    console.log(JSON.stringify({ ok: true, live, stages: diagnostics.map(row => row.stage),
      ended: diagnostics.findLast(row => row.stage === 'ended') }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
