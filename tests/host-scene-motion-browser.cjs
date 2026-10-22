const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true });
  const evidence = [];
  try {
    const page = await browser.newPage({ viewport:{ width:2380, height:1120 } });
    const errors = [], tts = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/client-diagnostic', route => route.fulfill({ status:202, json:{ok:true} }));
    await page.route('**/api/health', route => route.fulfill({ json:{ ok:true, workflow_proxy:{configured:true}, host_voice_configured:true } }));
    await page.route('**/api/workflow', route => route.fulfill({ json:{ workflow_output:'{}' } }));
    await page.route('**/api/tts', route => { tts.push(route.request().url()); return route.fulfill({contentType:'audio/mpeg',body:fs.readFileSync('assets/host-yes.mp3')}); });
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4179/', { waitUntil:'domcontentloaded' });
    const sample = () => page.evaluate(() => {
      const pixels = els.hostCanvas.getContext('2d').getImageData(0,0,564,572).data;
      let visible=0, checksum=0;
      for(let i=0;i<pixels.length;i+=4) { if(pixels[i+3]>16) visible++; checksum=(checksum+pixels[i]+pixels[i+1]*3+pixels[i+2]*7)%1000000007; }
      return { source:hostSprite.source, frame:hostSprite.frameIndex, visible, checksum, audio:!!hostSprite.audioSource };
    });
    await page.waitForFunction(() => hostSprite.source.includes('host-wave') && hostSprite.playing);
    const first = await sample(); await page.waitForTimeout(350); const next = await sample();
    assert.ok(first.visible>1000 && next.visible>1000); assert.notEqual(first.checksum,next.checksum);
    assert.equal(first.audio,false);
    await page.screenshot({ path:'tmp/host-wave-ready-desktop.png' });
    await page.locator('#backgroundMusicToggle').click();
    await page.waitForFunction(() => !!hostSprite.audioSource);
    assert.equal(await page.evaluate(() => hostSprite.source.split('?')[0]), './assets/host-wave.webp');
    await page.locator('#backgroundMusicToggle').click();
    assert.equal(await page.evaluate(() => hostSprite.audioSource), null);
    await page.locator('#backgroundMusicToggle').click();
    await page.waitForFunction(() => !!hostSprite.audioSource);
    await page.evaluate(() => { state.game.status='playing'; state.timeline.status='idle'; state.host.text=''; render(); });
    assert.equal(await page.evaluate(() => hostSprite.audioSource), null);
    await page.evaluate(() => { state.game.status='summary'; state.host.text=''; render(); });
    await page.waitForFunction(() => hostSprite.source.includes('host-cheer') && hostSprite.playing && !!hostSprite.audioSource);
    const cheer = await sample(); await page.waitForTimeout(350); const cheerNext = await sample();
    assert.ok(cheer.visible>1000); assert.notEqual(cheer.checksum,cheerNext.checksum);
    await page.evaluate(() => showImportantEvent('舱内出现笑声'));
    assert.equal(await page.locator('#importantEvent').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(255, 255, 255, 0.3)');
    await page.waitForTimeout(350);
    await page.screenshot({ path:'tmp/host-cheer-summary-desktop.png' });
    await page.evaluate(() => toggleTimelinePause());
    const paused = await sample(); await page.waitForTimeout(350);
    assert.deepEqual(await sample(), paused);
    assert.equal(await page.evaluate(() => audioContext.state), 'suspended');
    await page.evaluate(() => toggleTimelinePause());
    await page.waitForFunction(() => hostSceneMotion.completed && hostSprite.source.includes('host-normal'), undefined, {timeout:10000});
    const load = await page.evaluate(() => hostSprite.loadId);
    await page.evaluate(() => { render(); render(); });
    assert.equal(await page.evaluate(() => hostSprite.loadId), load);
    await page.evaluate(() => { publishHostLine('虚构结算串词',{priority:'P0',source:'game_summary'}); render(); });
    await page.waitForFunction(() => hostSprite.source.includes('host-speak'));
    await page.waitForFunction(() => state.workflow.hostSpeech.voiceFinished && hostSprite.source.includes('host-normal'));
    // Inspect every declared frame, including the two trailing transparent wave cells.
    evidence.push(...await page.evaluate(async () => {
      const results=[];
      for(const name of ['host-wave','host-cheer']) {
        const meta=await(await fetch(`./assets/${name}.json`)).json();
        const image=await loadHostSpriteImage(`./assets/${name}.webp`);
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=72;
        const ctx=canvas.getContext('2d',{willReadFrequently:true}); let blank=0;
        for(const {frame} of Object.values(meta.frames)) {
          if(frame.x+frame.w>image.width || frame.y+frame.h>image.height) throw Error('out of bounds');
          ctx.clearRect(0,0,72,72);ctx.drawImage(image,frame.x,frame.y,frame.w,frame.h,0,0,72,72);
          const pixels=ctx.getImageData(0,0,72,72).data; let alpha=0;
          for(let i=3;i<pixels.length;i+=4) if(pixels[i]>16)alpha++;
          if(!alpha)blank++;
        }
        results.push({name,frames:Object.keys(meta.frames).length,blank,width:image.width,height:image.height});
      }
      return results;
    }));
    assert.ok(evidence.every(item=>item.blank===0));
    for(const [mode,name] of [['ready','wave'],['summary','cheer']]) {
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(mode => { clearHostSpeechLock();state.host.text='';state.game.status=mode==='ready'?'idle':'summary';state.timeline.status='idle'; render(); },mode);
      await page.waitForFunction(name=>hostSprite.source.includes(`host-${name}`) && hostSprite.playing,name);
      assert.ok((await sample()).visible>1000);
      await page.screenshot({path:`tmp/host-${name}-${mode}-mobile.png`});
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',evidence,ttsRequests:tts.length,checks:['moving nonblank canvases','shared mute','switch cancellation','pause/resume','once per entry','summary speech transition','desktop/mobile'],errors}));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
