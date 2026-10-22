const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async()=>{
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:2380,height:1120}});
    const requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/health',route=>route.fulfill({json:{ok:true,host_voice_configured:true,workflow_proxy:{configured:true}}}));
    await page.route('**/api/client-diagnostic',route=>route.fulfill({status:202,json:{ok:true}}));
    await page.route('**/api/workflow',route=>route.fulfill({json:{workflow_output:'{}'}}));
    await page.route('**/api/tts',route=>{
      requests.push(route.request().postDataJSON());
      return route.fulfill({contentType:'audio/mpeg',body:fs.readFileSync('assets/host-yes.mp3')});
    });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4179/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>hostSprite.source.includes('host-wave')&&hostSprite.playing);
    assert.equal(await page.locator('.host-bubble').isVisible(),false);
    assert.equal(requests.length,0);
    await page.locator('#backgroundMusicToggle').click();
    await page.waitForFunction(()=>!!hostSprite.audioSource);
    assert.equal(await page.locator('.host-bubble').isVisible(),false);
    await page.screenshot({path:'tmp/ready-wave-before-welcome.png'});
    await page.waitForFunction(()=>state.workflow.hostSpeech.voicePlaying&&hostSprite.source.includes('host-speak'));
    assert.equal(requests.length,1);
    assert.equal(await page.locator('.host-bubble').isVisible(),true);
    assert.equal(await page.evaluate(()=>hostSceneMotion.completed),true);
    assert.equal(await page.evaluate(()=>state.workflow.hostSpeech.source),'ready_welcome');
    assert.ok(await page.evaluate(()=>state.workflow.hostSpeech.expiresAt-simulationRuntime.now()>2500));
    await page.screenshot({path:'tmp/ready-welcome-speaking.png'});
    await page.waitForFunction(()=>state.workflow.hostSpeech.voiceFinished&&hostSprite.source.includes('host-normal'));
    assert.equal(await page.locator('.host-bubble').isVisible(),true);
    const id=await page.evaluate(()=>hostSprite.loadId);
    await page.evaluate(()=>{render();render();});
    assert.equal(await page.evaluate(()=>hostSprite.loadId),id);
    assert.equal(requests.length,1);
    await page.screenshot({path:'tmp/ready-welcome-audio-ended.png'});
    await page.evaluate(()=>{setBackgroundMusicEnabled(false); applyGoldenLineDefaults(); render();});
    await page.waitForFunction(()=>hostSprite.source.includes('host-wave')&&hostSprite.playing);
    assert.equal(await page.locator('.host-bubble').isVisible(),false);
    await page.waitForFunction(()=>hostSceneMotion.completed&&state.workflow.hostSpeech.source==='ready_welcome');
    assert.equal(await page.locator('.host-bubble').isVisible(),true);
    assert.equal(requests.length,1,'muted welcome never requests synthesis');
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'tmp/ready-welcome-mobile.png'});
    await page.setViewportSize({width:2380,height:1120});
    await page.locator('#backgroundMusicToggle').click();
    await page.waitForFunction(()=>state.workflow.hostSpeech.voicePlaying);
    await page.locator('#readyStartButton').click();
    await page.waitForFunction(()=>state.game.status==='playing');
    assert.notEqual(await page.evaluate(()=>state.workflow.hostSpeech.source),'ready_welcome');
    assert.equal(await page.evaluate(()=>state.workflow.hostSpeech.voicePending || state.workflow.hostSpeech.voicePlaying),false);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',checks:['wave before text and TTS','fresh welcome duration','ready speech animation','audio-ended stops motion while text remains','no repeated synthesis','muted fallback','start game during welcome','desktop/mobile'],requests:requests.length,errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
