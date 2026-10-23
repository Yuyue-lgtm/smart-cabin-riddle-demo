const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const origin=process.env.TEST_DEMO_URL||'https://cabinplay.xyz/';
const folder=process.env.RELEASE_QA_FOLDER||'tmp/release-qa-20261023';
fs.mkdirSync(folder,{recursive:true});
const steps=[
  ['resources','tests/image-optimization-browser.cjs'],
  ['loading','tests/startup-loading-browser.cjs'],
  ['passengers','tests/golden-passengers-browser.cjs'],
  ['cabin-badges','tests/cabin-badges-browser.cjs'],
  ['ready-host-onboarding','tests/ready-host-browser.cjs'],
  ['opening-motion','tests/game-opening-scenes-browser.cjs'],
  ['background-music','tests/background-music-media-browser.cjs'],
  ['sprite-audio','tests/media-refinement-browser.cjs'],
  ['summary-sound','tests/summary-sound-browser.cjs'],
  ['game-controls','tests/game-control-browser.cjs'],
  ['simulation-freeze','tests/simulation-freeze-browser.cjs'],
  ['cabin-safety','tests/cabin-policy-browser.cjs'],
  ['event-order','tests/multi-event-queue-browser.cjs'],
  ['five-games-thirty-rounds','tests/riddle-allocation-browser.cjs'],
  ['reload-fullscreen-reset','tests/release-stability-browser.cjs'],
  ['delayed-voice-response','tests/voice-streaming-browser.cjs',{FIXTURE_HEADER_DELAY_MS:'9500'}],
  ['live-three-routes','deploy/alibaba-cloud/verify-live.cjs',{},[origin]],
  ['live-answer-fastpath','tests/answer-fastpath-browser.cjs',{ANSWER_TEST_FOLDER:`${folder}/answer-fastpath`}],
  ['live-game-opening','tests/game-opening-live.cjs'],
  ['live-preview-bank','tests/riddle-allocation-live.cjs'],
  ['live-voice','tests/voice-streaming-browser.cjs',{LIVE_VOICE:'1'}],
];
const reportFile=path.join(folder,'report.json');
const report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):
  {origin,started_at:new Date().toISOString(),steps:[]};
if(report.origin!==origin)throw Error('Cannot reuse a report for a different origin');
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
const start=process.env.QA_START_AT?steps.findIndex(([id])=>id===process.env.QA_START_AT):0;
if(start<0)throw Error('Unknown QA_START_AT');
const stop=process.env.QA_STOP_AFTER?steps.findIndex(([id])=>id===process.env.QA_STOP_AFTER):steps.length-1;
for(let index=start;index<=stop;index++){
  const [id,file,extra={},args=[]]=steps[index];
  console.log(`START ${index+1}/${steps.length} ${id}`);
  const began=Date.now();
  const result=spawnSync(process.execPath,[file,...args],{encoding:'utf8',timeout:300000,maxBuffer:4*1024*1024,
    env:{...process.env,TEST_DEMO_URL:origin,NODE_OPTIONS:`--require ${path.resolve('tests/helpers/muted-browser.cjs')}`,
      IMAGE_QA_FOLDER:`${folder}/images`,...extra}});
  fs.writeFileSync(path.join(folder,`${id}.log`),(result.stdout||'')+(result.stderr||''));
  const row={id,index:index+1,passed:result.status===0,exit_code:result.status,elapsed_ms:Date.now()-began,
    ...(result.error?{error:result.error.message}:{}),log:`${folder}/${id}.log`};
  report.steps=report.steps.filter(step=>step.id!==id);report.steps.push(row);save();
  console.log(`${row.passed?'PASS':'FAIL'} ${id} ${row.elapsed_ms}ms`);
  if(!row.passed){console.log((result.stderr||result.stdout||'').slice(-3000));process.exitCode=1;break;}
}
report.passed=steps.every(([id])=>report.steps.some(step=>step.id===id&&step.passed));
report.updated_at=new Date().toISOString();save();
console.log(JSON.stringify({passed:report.passed,completed:report.steps.filter(step=>step.passed).length,total:steps.length,report:reportFile}));
