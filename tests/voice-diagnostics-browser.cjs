const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    const page = await browser.newPage();
    const diagnostics=[], responses=[];
    await page.route('**/api/workflow',route=>route.fulfill({json:{route:'wrong-route',diagnostic_id:'26b4a21e-4e19-4a63-958a-f1345dd127df'}}));
    await page.route('**/api/tts',route=>route.fulfill({contentType:'audio/mpeg',body:fs.readFileSync('assets/host-yes.mp3')}));
    page.on('request',request=>{if(request.url().endsWith('/api/client-diagnostic'))diagnostics.push(request.postDataJSON());});
    page.on('response',response=>{if(response.url().endsWith('/api/client-diagnostic'))responses.push(response.status());});
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4179/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>state.health.hostVoiceConfigured);
    await page.locator('#backgroundMusicToggle').click();
    await page.evaluate(()=>{
      state.game.status='playing';state.timeline.status='idle';state.host.text='';render();
      const original=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){
        if(this.hidden && this.tagName==='AUDIO')return Promise.reject(new DOMException('blocked test','NotAllowedError'));
        return original.call(this);
      };
      publishHostLine('私密测试话术，不应进入日志',{priority:'P0',source:'hard_brake'});render();
    });
    await page.waitForFunction(()=>state.workflow.hostSpeech.voiceRequested && !state.workflow.hostSpeech.voicePending);
    await page.evaluate(async()=>{
      try {await requestWorkflow(buildWorkflowInput('chat',null,'私密测试提问，不应进入日志'));}catch{}
    });
    await page.waitForTimeout(500);
    assert.ok(diagnostics.some(row=>row.type==='host_voice' && row.reason==='browser_blocked'));
    assert.ok(diagnostics.some(row=>row.type==='workflow_failure' && row.reason==='route_mismatch'));
    assert.doesNotMatch(JSON.stringify(diagnostics),/私密|blocked test/);
    assert.ok(responses.length>0 && responses.every(status=>status===202));
    console.log(JSON.stringify({status:'passed',session:diagnostics[0].session_id,checks:['browser rejection recorded','frontend validation failure recorded','no spoken or question text','production intake accepts typed logs'],accepted:responses.length}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
