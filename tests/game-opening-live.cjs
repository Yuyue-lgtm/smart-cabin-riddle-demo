const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');

(async()=>{
  const origin=process.env.TEST_DEMO_URL||'http://127.0.0.1:4175/';
  const context=vm.createContext({structuredClone,console,crypto:webcrypto,AbortController,
    setTimeout,clearTimeout,window:{setTimeout,clearTimeout},
    fetch:(url,options)=>fetch(new URL(url,origin),options),localStorage:{getItem:()=>null,setItem(){}}});
  vm.runInContext(fs.readFileSync('client-app.js','utf8')
    .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/,'\n'),context);
  const run=code=>vm.runInContext(code,context);
  run('render=()=>{}; startupLoading.active=false;');
  const results=[];
  for(const index of [0,1,2]) {
    run(`cancelGameOpening('live test next scene'); state.workflow.gameId=createRuntimeId('opening-live');
      state.scenarioIndex=${index}; constScene=GOLDEN_TIMELINES[${index}]; state.timeline.id=constScene.id; state.timeline.name=constScene.name;
      state.car.environment=constScene.environment; state.car.destination=constScene.destination;
      state.passengers.relationship=constScene.relationship; ensureGameOpening();`);
    const started=Date.now();
    await run('gameOpening.promise');
    const row=JSON.parse(run('JSON.stringify({scenario:getActiveGoldenLine().name,status:gameOpening.status,text:gameOpening.text})'));
    row.elapsed_ms=Date.now()-started;
    results.push(row); console.log(JSON.stringify(row));
    assert.equal(row.status,'ready'); assert.ok(row.text);
  }
  const report={passed:true,real_dify:true,tts_called:false,results};
  fs.writeFileSync('tmp/game-opening-live.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,cases:results.length,tts_called:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
