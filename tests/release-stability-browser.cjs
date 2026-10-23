const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

(async()=>{
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--mute-audio']});
  try{
    const page=await browser.newPage({viewport:{width:2380,height:1120}}),errors=[],records=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/assets/')&&response.status()>=400)errors.push(response.url());});
    await page.addInitScript(()=>{
      document.hasFocus=()=>true;
      const original=window.fetch.bind(window);
      window.fetch=async(url,options)=>{
        const pathname=new URL(typeof url==='string'?url:url.url,location.href).pathname;
        if(pathname==='/api/health')return Response.json({workflow_proxy:{configured:true},host_voice_configured:false});
        if(pathname==='/api/client-diagnostic')return Response.json({ok:true},{status:202});
        if(pathname!=='/api/workflow')return original(url,options);
        const body=JSON.parse(options.body),input=JSON.parse(body.input_payload);
        const scope={route:body.route,operation:body.operation,game_id:input.game_id,round_id:input.round_id,
          scene_version:input.scene_version,event_id:input.event?.id,event_type:input.event?.type};
        if(body.route==='preview')return Response.json({...scope,workflow_output:JSON.stringify({preview_status:'ready',
          round_question_plan:{plan_id:input.round_id,steps:['它是人造的吗？','它在户外常见吗？','它有把手吗？','它可以折叠吗？']
            .map((text,i)=>({id:`stability-${i}`,order:i+1,fact_key:`stability-${i}`,depends_on:[],variants:{default:text}}))}})});
        if(body.operation==='game_opening')return Response.json({...scope,workflow_output:JSON.stringify({
          ai_reply_text:'脑洞小队集合，出发开猜啦！',intent:'event',reply_mode:'chat_only',is_correct:false,
          game_status:'opening',execution:{actions:[]},decision_trace:{guard_status:'passed'}})});
        return Response.json({...scope,scene_output:{analysis_status:'skipped',request_proactive_speech:false},workflow_output:'{}'});
      };
    });
    const origin=process.env.TEST_DEMO_URL||'http://127.0.0.1:4175/';
    const inspect=async()=>{
      await page.waitForFunction(()=>!startupLoading.active&&getGameScreenMode()==='ready'&&hostSprite.playing,undefined,{timeout:60000});
      const row=await page.evaluate(()=>{
        const bounds=els.appShell.getBoundingClientRect(),scale=Math.min(innerWidth/STAGE_WIDTH,innerHeight/STAGE_HEIGHT);
        const pixels=els.hostCanvas.getContext('2d').getImageData(0,0,els.hostCanvas.width,els.hostCanvas.height).data;
        let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)visible++;
        return {width:innerWidth,stageWidth:bounds.width,expectedWidth:STAGE_WIDTH*scale,visible,
          music:backgroundMusic.enabled,broken:[...document.images].filter(el=>el.offsetParent!==null&&el.complete&&!el.naturalWidth).map(el=>el.src)};
      });
      assert.ok(row.stageWidth>0&&Math.abs(row.stageWidth-row.expectedWidth)<2);
      assert.ok(row.visible>1000);assert.deepEqual(row.broken,[]);assert.equal(row.music,false);records.push(row);
    };
    for(const width of [2380,390]){
      await page.setViewportSize({width,height:width===2380?1120:844});
      await page.goto(origin,{waitUntil:'domcontentloaded'});await inspect();
      for(let i=0;i<4;i++){await page.reload({waitUntil:'domcontentloaded'});await inspect();}
    }
    await page.setViewportSize({width:2380,height:1120});
    await page.locator('#readyStartButton').click();
    await page.waitForFunction(()=>state.game.status==='playing');
    assert.equal(await page.locator('#playerInputGuide').isVisible(),true);
    await page.locator('#playerInput').click();assert.equal(await page.locator('#playerInputGuide').isVisible(),false);
    await page.locator('#gameFullscreenButton').click();
    assert.equal(await page.locator('#appShell').evaluate(el=>el.classList.contains('game-display-expanded')),true);
    assert.equal(await page.locator('#fullscreenHint').isVisible(),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#appShell').evaluate(el=>el.classList.contains('game-display-expanded')),false);
    await page.locator('#pauseTimeline').click();
    assert.equal(await page.locator('#gameFullscreenButton').isVisible(),false);
    assert.equal(await page.locator('#resetScenario').isEnabled(),true);
    const before=await page.evaluate(()=>getQuestionElapsedMs());await page.waitForTimeout(700);
    assert.equal(await page.evaluate(()=>getQuestionElapsedMs()),before);
    await page.locator('#resetScenario').click();await inspect();
    for(let i=0;i<10;i++)await page.locator('#switchScenario').click();
    assert.equal(await page.evaluate(()=>state.scenarioIndex),0);
    await page.locator('#gameScreen').screenshot({path:'tmp/release-stability-ready.png'});
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tmp/release-stability-browser.json',JSON.stringify({passed:true,records,errors,
      reloads:8,scenario_switches:10,fullscreen:true,paused_reset:true,muted:true,models_mocked:true},null,2));
    console.log(JSON.stringify({passed:true,reloads:8,scenario_switches:10,fullscreen:true,paused_reset:true,errors,muted:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
