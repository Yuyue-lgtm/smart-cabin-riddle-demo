const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

(async()=>{
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--mute-audio']});
  try{
    const results=[];
    for(const viewport of [{width:2380,height:1120},{width:390,height:844}]){
      const page=await browser.newPage({viewport}),errors=[];
      let openingMode='ready';
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/**',async route=>{
        const pathname=new URL(route.request().url()).pathname;
        if(pathname==='/api/health')return route.fulfill({json:{workflow_proxy:{configured:true},host_voice_configured:false}});
        if(pathname!=='/api/workflow')return route.fulfill({json:{ok:true}});
        const body=route.request().postDataJSON(),input=JSON.parse(body.input_payload);
        const scope={route:body.route,operation:body.operation,game_id:input.game_id,round_id:input.round_id,
          scene_version:input.scene_version,event_id:input.event?.id,event_type:input.event?.type};
        if(body.operation==='game_opening'){
          const mode=openingMode;
          if(mode==='failed')return route.fulfill({status:503,json:{error:'fixture_unavailable'}});
          if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,6000));
          try{return await route.fulfill({json:{...scope,workflow_output:JSON.stringify({intent:'event',reply_mode:'chat_only',
            ai_reply_text:'脑洞小队集合，一起开猜啦！',game_status:'opening',is_correct:false,
            covered_fact_keys:[],execution:{actions:[]},decision_trace:{guard_status:'passed'}})}});}catch{return;}
        }
        const steps=Array.from({length:4},(_,index)=>({id:`step-${index}`,order:index+1,fact_key:`fact-${index}`,
          depends_on:[],variants:{default:'它是具体的东西吗？'}}));
        return route.fulfill({json:{...scope,workflow_output:JSON.stringify({preview_status:'ready',
          round_question_plan:{plan_id:input.round_id,steps}}),scene_output:{analysis_status:'skipped',request_proactive_speech:false}}});
      });
      await page.goto(process.env.TEST_DEMO_URL||'http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>getGameScreenMode()==='ready'&&!startupLoading.active,undefined,{timeout:60000});
      await page.evaluate(()=>{
        window.heartStarts=[];const originalLoad=loadHostSprite;
        loadHostSprite=async media=>{if(media===RESOURCE_CONFIG.host.smile)window.heartStarts.push(state.workflow.gameId);return originalLoad(media);};
      });
      const count=viewport.width>500?5:1;
      for(let index=0;index<count;index++){
        if(index){openingMode='ready';await page.evaluate(()=>resetCurrentGoldenLine());}
        openingMode=index%2===0?'slow':'failed';
        await page.locator('#switchScenario').click();
        const gameId=await page.evaluate(()=>state.workflow.gameId);
        await page.locator('#readyStartButton').click();
        await page.waitForFunction(()=>hostSprite.source===RESOURCE_CONFIG.host.smile.src&&hostSprite.playing);
        assert.equal(await page.evaluate(()=>questionClock.active),true);
        assert.equal(await page.evaluate(()=>hostSprite.loop),false);
        await page.waitForTimeout(150);
        assert.ok(await page.evaluate(()=>hostSprite.frameIndex)>0);
        if(index===0)await page.screenshot({path:`tmp/opening-scene-heart-${viewport.width}.png`});
        await page.waitForFunction(()=>gameOpeningMotion.completed,undefined,{timeout:8000});
        await page.waitForFunction(()=>!questionIntro.active);
        await page.evaluate(()=>{render();render();});
        assert.equal(await page.evaluate(()=>getHostPresentation().mediaHostState),'normal');
        assert.equal(await page.evaluate(id=>window.heartStarts.filter(item=>item===id).length,gameId),1);
        if(openingMode==='slow')await page.waitForFunction(()=>gameOpening.status==='cancelled');
        else assert.equal(await page.evaluate(()=>gameOpening.status),'failed');
        assert.equal(await page.evaluate(()=>state.host.text),'');
        assert.ok(await page.evaluate(()=>getQuestionElapsedMs())>=2900);
        results.push({viewport,scene:await page.evaluate(()=>getActiveGoldenLine().name),mode:openingMode,
          heart_once:true,countdown_parallel:true});
      }
      assert.deepEqual(errors,[]);await page.close();
    }
    fs.writeFileSync('tmp/game-opening-scenes-browser.json',JSON.stringify({passed:true,results,muted:true},null,2)+'\n');
    console.log(JSON.stringify({passed:true,results,muted:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
