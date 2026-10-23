const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

(async () => {
  const origin = process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/';
  const readiness = await fetch(new URL('/api/readiness', origin), { signal: AbortSignal.timeout(10000) }).then(r => r.json());
  if (!readiness.ok) throw new Error(`Dify is not ready: ${JSON.stringify(readiness.routes)}`);
  const context = vm.createContext({ structuredClone, console, crypto: webcrypto, AbortController,
    setTimeout, clearTimeout, window: { setTimeout, clearTimeout },
    fetch: (url, options) => fetch(new URL(url, origin), options),
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(fs.readFileSync('client-app.js', 'utf8')
    .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, '\n'), context);
  const run = code => vm.runInContext(code, context);
  run('render=()=>{};');
  const results = [];
  for (const [answer, environment] of [
    ['围巾', '风景区雪景白天'], ['地铁口', '雨天'], ['霓虹灯', '城区晴天白天'],
    ['广告', '城区夜晚'], ['游客', '风景区晴天白天'], ['散步', '风景区傍晚'],
    ['猫头鹰', '风景区晴天深夜'], ['时间', '车库'], ['闪电', '雨天'], ['云', '风景区晴天白天'],
  ]) {
    const start = Date.now();
    run(`state.car.environment=${JSON.stringify(environment)};`);
    const preparation = run(`ensureRoundPreparation({gameId:createRuntimeId('allocation-live'), roundIndex:1,
      riddleIndex:RIDDLES.findIndex(r=>r.answer===${JSON.stringify(answer)})})`);
    await preparation.promise;
    const row = { answer, environment, status: preparation.status, steps: preparation.plan?.steps.length || 0,
      elapsed_ms: Date.now() - start, diagnostics: preparation.diagnostics, error: preparation.error || '' };
    results.push(row);
    console.log(JSON.stringify(row));
    fs.writeFileSync('tmp/riddle-allocation-live.json', JSON.stringify({ readiness, results }, null, 2) + '\n');
    run(`cancelPreviewWorkflow();`);
  }
  const passed = results.every(row => row.status === 'ready' && row.steps >= 4);
  console.log(JSON.stringify({ passed, cases: results.length, real_dify_preview: true, tts_called: false }));
  if (!passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
