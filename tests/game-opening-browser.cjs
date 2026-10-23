const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--mute-audio'] });
  try {
    const results=[];
    for(const viewport of [{width:2380,height:1120},{width:390,height:844}]) {
      const page=await browser.newPage({viewport});
      const errors=[],openings=[],tts=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        window.mediaStarts=[];
        const play=HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play=function(){
          const entry={src:this.src,status:'pending'}; window.mediaStarts.push(entry);
          return play.call(this).then(value=>{entry.status='playing';return value;},error=>{entry.status=error.name;throw error;});
        };
      });
      await page.route('**/api/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path==='/api/health') return route.fulfill({json:{workflow_proxy:{configured:true},host_voice_configured:true}});
        if(path==='/api/tts') { tts.push(route.request().postDataJSON());
          return route.fulfill({contentType:'audio/mpeg',body:fs.readFileSync('assets/hi-audio.mp3')}); }
        if(path!=='/api/workflow') return route.fulfill({json:{ok:true}});
        const body=route.request().postDataJSON(),input=JSON.parse(body.input_payload);
        const scope={route:body.route,operation:body.operation,game_id:input.game_id,round_id:input.round_id,
          scene_version:input.scene_version,event_id:input.event?.id,event_type:input.event?.type};
        if(body.operation==='game_opening') {
          openings.push(input);
          return route.fulfill({json:{...scope,workflow_output:JSON.stringify({intent:'event',reply_mode:'chat_only',
            ai_reply_text:'脑洞小队集合，一起开猜啦！',game_status:'opening',is_correct:false,
            covered_fact_keys:[],execution:{actions:[]},decision_trace:{guard_status:'passed'}})}});
        }
        if(body.route==='preview') {
          const steps=['它是具体的东西吗？','它在日常生活里常见吗？','它和人类活动有关吗？','它可以被人移动吗？']
            .map((text,i)=>({id:`step-${i}`,order:i+1,fact_key:`fact-${i}`,depends_on:[],variants:{default:text}}));
          return route.fulfill({json:{...scope,workflow_output:JSON.stringify({preview_status:'ready',round_question_plan:{plan_id:input.round_id,steps}})}});
        }
        return route.fulfill({json:{...scope,scene_output:{analysis_status:'skipped',request_proactive_speech:false},workflow_output:'{}'}});
      });
      await page.goto(process.env.TEST_DEMO_URL||'http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>getGameScreenMode()==='ready'&&hostSprite.playing&&gameOpening?.status==='ready',undefined,{timeout:60000});
      assert.equal(await page.evaluate(()=>backgroundMusic.enabled),false);
      await page.mouse.click(5,5);
      await page.waitForFunction(()=>hostSprite.audioElement&&!hostSprite.audioElement.paused||Boolean(hostSprite.audioSource),undefined,{timeout:5000});
      assert.equal(await page.evaluate(()=>backgroundMusic.enabled),false,'Animation sound does not enable music/TTS');
      assert.equal(openings.length,1);
      assert.equal(tts.length,0);
      await page.evaluate(()=>{
        window.roundPanelSamples=[];const originalRender=render;
        render=()=>{originalRender();if(getGameScreenMode()==='playing'){
          const title=els.riddleTitle.textContent;
          if(window.roundPanelSamples.at(-1)!==title)window.roundPanelSamples.push(title);
        }};
      });
      await page.locator('#readyStartButton').click();
      await page.waitForFunction(()=>state.workflow.hostSpeech.source==='game_opening');
      await page.waitForFunction(()=>hostSprite.source===RESOURCE_CONFIG.host.smile.src&&hostSprite.playing);
      const heartLoadId=await page.evaluate(()=>hostSprite.loadId);
      assert.equal(await page.evaluate(()=>questionClock.active&&questionIntro.active),true);
      assert.deepEqual(await page.evaluate(()=>window.roundPanelSamples),['第 1 题']);
      assert.match(await page.locator('#hostBubble').innerText(),/脑洞小队/);
      const canvas=await page.evaluate(()=>{
        const data=els.hostCanvas.getContext('2d').getImageData(0,0,els.hostCanvas.width,els.hostCanvas.height).data;
        return data.some((value,index)=>index%4===3&&value>16);
      });
      assert.equal(canvas,true);
      await page.waitForTimeout(250);
      assert.ok(await page.evaluate(()=>hostSprite.frameIndex>0));
      await page.screenshot({path:`tmp/game-opening-${viewport.width}.png`});
      await page.waitForFunction(()=>!questionIntro.active);
      assert.deepEqual(await page.evaluate(()=>window.roundPanelSamples),['第 1 题',await page.evaluate(()=>getCurrentRiddle().hint)]);
      assert.ok(await page.evaluate(()=>getQuestionElapsedMs()>=2900));
      await page.waitForFunction(()=>gameOpening.status==='completed',undefined,{timeout:15000});
      assert.equal(await page.evaluate(()=>gameOpening.heartCompleted),true);
      assert.ok(await page.evaluate(loadId=>hostSprite.loadId>loadId,heartLoadId));
      assert.equal(tts.length,0);
      assert.equal(await page.evaluate(()=>gameOpening.status),'completed');
      assert.equal(openings[0].perception.current_observation,'游戏即将开始');
      assert.equal(await page.evaluate(()=>backgroundMusic.volume),0.175);
      await page.evaluate(()=>{resetCurrentGoldenLine();render();render();});
      await page.waitForFunction(()=>gameOpening?.status==='ready');
      assert.equal(openings.length,2,'A new game generates exactly one new opening');
      await page.locator('#backgroundMusicToggle').click();
      assert.equal(await page.evaluate(()=>els.backgroundMusic.volume),0.175);
      await page.locator('#readyStartButton').click();
      await page.waitForFunction(()=>state.workflow.hostSpeech.source==='game_opening'&&state.workflow.hostSpeech.voicePlaying,undefined,{timeout:15000});
      assert.equal(tts.length,1);
      assert.match(tts[0].text,/脑洞小队/);
      assert.equal(await page.evaluate(()=>questionClock.active),true);
      await page.waitForFunction(()=>!questionIntro.active);
      await page.waitForFunction(()=>gameOpening.heartCompleted&&hostSprite.source===RESOURCE_CONFIG.host.speak.src);
      assert.equal(await page.evaluate(()=>state.workflow.hostSpeech.voicePlaying),true,'The clue is shown and time passes while opening audio is still playing');
      assert.ok(await page.evaluate(()=>getQuestionElapsedMs()>=2900));
      assert.equal(await page.locator('#riddleTitle').innerText(),await page.evaluate(()=>getCurrentRiddle().hint));
      await page.waitForFunction(()=>gameOpening.status==='completed',undefined,{timeout:20000});
      assert.deepEqual(errors,[]);
      results.push({viewport,openings:openings.length,tts:tts.length,animation_audio_with_music_off:true,errors});
      await page.close();
    }
    const report={passed:true,browser_output_muted:true,results};
    fs.writeFileSync('tmp/game-opening-browser.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
