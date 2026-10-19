const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2380, height: 1120 } });
    const errors = [], snapshots = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, workflow_proxy: { configured: true } } }));
    await page.route('**/api/workflow', async route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const scope = { game_id: input.game_id, round_id: input.round_id, scene_version: input.scene_version,
        event_id: input.event?.id, event_type: input.event?.type };
      if (body.route === 'preview') return route.fulfill({ json: { route: 'preview', ...scope, workflow_output: '{}' } });
      const sleep = input.event.type === 'passenger_sleep';
      if (body.route === 'situation') {
        const scene = { ...scope, generated_at_ms: Date.now(), expires_at_ms: Date.now() + 60000,
          analysis_status: 'ready', request_proactive_speech: !sleep, request_host_decision: sleep,
          host_decision_seat: sleep ? input.event.seat : null };
        return route.fulfill({ json: { route: 'situation', ...scope, scene_output: scene,
          situation_handoff: 'browser-test-ticket', workflow_output: JSON.stringify({ ai_reply_text: '', scene_output: scene }) } });
      }
      snapshots.push(input);
      const label = input.event.seat === 'rearLeft' ? '左后' : '右后';
      const text = sleep ? `${label}关灯、分区音量0、空调调至用户记忆值。` : '我们进入隧道啦。';
      return route.fulfill({ json: { route: 'chat', operation: 'situation_reply', ...scope,
        workflow_output: JSON.stringify({ intent: 'event', ai_reply_text: text,
          decision_trace: { guard_status: 'passed' },
          execution: { actions: sleep ? [{ type: 'cabin.apply_sleep_comfort', seat: input.event.seat }] : [] } }) } });
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4186/', { waitUntil: 'domcontentloaded' });
    await page.locator('#readyStartButton').click();
    await page.evaluate(() => {
      finishTimelineSilently(); clearHostSpeechLock(); state.host.text = '';
      globalThis.shownLines = [];
      const originalRender = render;
      render = () => {
        originalRender();
        if (state.host.text && shownLines.at(-1) !== state.host.text) shownLines.push(state.host.text);
      };
      publishHostLine('当前这句话先说完。', { source: 'chat', durationMs: 1500 }); render();
      applyImmediatePassengerSleep('rearLeft');
      void dispatchWorkflow('event', { id: 'browser-left', type: 'passenger_sleep', seat: 'rearLeft' });
      applyImmediatePassengerSleep('rearRight');
      void dispatchWorkflow('event', { id: 'browser-right', type: 'passenger_sleep', seat: 'rearRight' });
      setEnvironment('隧道');
      void dispatchWorkflow('event', { id: 'browser-env', type: 'environment_change', value: '隧道', previous_value: '车库' });
    });
    await page.waitForFunction(() => state.ui.sleepComfortSeats.length === 2, null, { timeout: 30000 }).catch(async error => {
      console.error(await page.evaluate(() => ({ shown: shownLines, events: state.workflow.situationEvents,
        pending: state.workflow.pendingSituationReplies, deferred: state.workflow.deferredHostReplies,
        inFlight: state.workflow.inFlight, speech: state.workflow.hostSpeech, game: state.game.status })));
      console.error({ requests: snapshots.map(input => [input.event.type, input.event.seat]), errors });
      throw error;
    });
    const shown = await page.evaluate(() => shownLines);
    assert.deepEqual(shown, ['当前这句话先说完。', '我们进入隧道啦。',
      '左后关灯、分区音量0、空调调至用户记忆值。', '右后关灯、分区音量0、空调调至用户记忆值。']);
    const records = await page.evaluate(() => state.workflow.situationEvents.map(row => ({
      id: row.event.id, status: row.status, actions: row.executedActions,
    })));
    assert.deepEqual(records.filter(row => row.id.startsWith('browser-') && row.id !== 'browser-env').map(row => row.actions.length), [1, 1]);
    assert.equal(snapshots[0].event.type, 'environment_change');
    assert.equal(snapshots.filter(input => input.event.type === 'passenger_sleep').length, 2);
    assert.deepEqual(errors, []);
    fs.mkdirSync('tmp', { recursive: true });
    await page.screenshot({ path: 'tmp/multi-event-queue.png' });
    console.log('PASS: current speech completes, P1 environment goes next, two P2 seat events follow FIFO, and both actions execute exactly once.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
