const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const phase=process.env.IMAGE_QA_PHASE||'after';
const folder=process.env.IMAGE_QA_FOLDER||`tmp/image-optimization-${phase}`;
const manifest=phase==='after'?JSON.parse(fs.readFileSync('docs/IMAGE_OPTIMIZATION.json','utf8')):null;

(async()=>{
  fs.mkdirSync(folder,{recursive:true});
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--mute-audio']});
  try {
    const page=await browser.newPage({viewport:{width:2380,height:1120}});
    const errors=[],assetErrors=[],screens=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{
      if(new URL(response.url()).pathname.startsWith('/assets/')&&response.status()>=400)
        assetErrors.push({url:response.url(),status:response.status()});
    });
    await page.route('**/api/**',route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname==='/api/health')return route.fulfill({json:{workflow_proxy:{configured:true},host_voice_configured:false}});
      if(pathname!=='/api/workflow')return route.fulfill({json:{ok:true}});
      const body=route.request().postDataJSON(),input=JSON.parse(body.input_payload);
      const scope={route:body.route,operation:body.operation,game_id:input.game_id,round_id:input.round_id,
        scene_version:input.scene_version,event_id:input.event?.id,event_type:input.event?.type};
      if(body.operation==='game_opening')return route.fulfill({json:{...scope,workflow_output:JSON.stringify({intent:'event',
        reply_mode:'chat_only',ai_reply_text:'脑洞小队集合，一起开猜啦！',game_status:'opening',is_correct:false,
        covered_fact_keys:[],execution:{actions:[]},decision_trace:{guard_status:'passed'}})}});
      const steps=['它是具体的东西吗？','它在日常生活里常见吗？','它和人类活动有关吗？','它可以被人移动吗？']
        .map((text,index)=>({id:`step-${index}`,order:index+1,fact_key:`fact-${index}`,depends_on:[],variants:{default:text}}));
      return route.fulfill({json:{...scope,workflow_output:JSON.stringify({preview_status:'ready',
        round_question_plan:{plan_id:input.round_id,steps}}),scene_output:{analysis_status:'skipped',request_proactive_speech:false}}});
    });
    const started=Date.now();
    await page.goto(process.env.TEST_DEMO_URL||'http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>getGameScreenMode()==='ready'&&!hostSprite.loading&&hostSprite.playing,undefined,{timeout:60000});
    const readyMs=Date.now()-started;
    await page.mouse.click(5,5);
    const capture=async(name)=>{
      await page.waitForFunction(()=>{
        const scale=Math.min(window.innerWidth/STAGE_WIDTH,window.innerHeight/STAGE_HEIGHT);
        return Math.abs(els.appShell.getBoundingClientRect().width-STAGE_WIDTH*scale)<1;
      });
      await page.waitForFunction(()=>!hostSprite.loading&&!hostSprite.fallback,undefined,{timeout:30000});
      await page.evaluate(async()=>{
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('img')].filter(img=>img.offsetParent!==null)
          .map(img=>img.decode().catch(()=>{})));
        hostSprite.playing=false;
        simulationRuntime.cancelAnimationFrame(hostSprite.animationFrameId);
        hostSprite.animationFrameId=0;drawHostSpriteFrame(0);
        for(const animation of document.getAnimations()){
          try {animation.pause();animation.currentTime=100000;}catch{}
        }
      });
      const row=await page.evaluate(()=>{
        const canvas=els.hostCanvas,context=canvas.getContext('2d');
        const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;
        let visible=0;for(let i=3;i<bytes.length;i+=4)if(bytes[i]>16)visible++;
        const screen=els.gameScreen.getBoundingClientRect();
        return {mode:getGameScreenMode(),visible,source:hostSprite.source.split('?')[0],
          screen:{width:screen.width,height:screen.height},brokenImages:[...document.querySelectorAll('img')]
            .filter(img=>img.offsetParent!==null&&(!img.complete||!img.naturalWidth)).map(img=>img.src)};
      });
      assert.ok(row.visible>1000,name);assert.deepEqual(row.brokenImages,[],name);
      await page.screenshot({path:`${folder}/${name}.png`});
      screens.push({name,...row});
    };
    await capture('ready-desktop');
    await page.evaluate(()=>{
      cancelGameOpening('image QA');clearHostSpeechLock();state.host.text='';
      state.game.status='playing';state.timeline.status='finished';state.ui.showAnswer=false;
      setHostAvatarState('normal',{transient:false});render();
    });
    const environments=await page.locator('#environmentChips [data-environment]').evaluateAll(nodes=>nodes.map(n=>n.dataset.environment));
    for(let index=0;index<environments.length;index++){
      await page.evaluate(environment=>{state.car.environment=environment;state.ui.screenEnvironment=environment;render();},environments[index]);
      await capture(`environment-${index}`);
    }
    for(let index=0;index<5;index++){
      await page.evaluate(index=>{state.scenarioIndex=index;state.passengers.relationship=GOLDEN_TIMELINES[index].relationship;render();},index);
      await capture(`passengers-${index}`);
    }
    await page.evaluate(()=>{
      state.game.status='victory';state.ui.showAnswer=true;state.ui.correctSeat='front';
      state.host.text='答对啦！';setHostAvatarState('excited',{transient:false});render();
    });
    await capture('reveal-desktop');
    await page.evaluate(()=>{clearHostSpeechLock();state.host.text='';state.game.status='summary';
      state.ui.showAnswer=false;setHostAvatarState('normal',{transient:false});render();});
    await capture('summary-desktop');
    await page.setViewportSize({width:390,height:844});await capture('summary-mobile');
    await page.evaluate(()=>{state.game.status='playing';state.ui.showAnswer=false;state.ui.screenEnvironment='雨天';
      state.car.environment='雨天';state.host.text='';render();});
    await capture('playing-mobile');

    const sprites=await page.evaluate(async()=>{
      const results=[],canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      for(const [name,media] of Object.entries(RESOURCE_CONFIG.host)){
        if(media.kind!=='sprite')continue;
        const image=await loadHostSpriteImage(media.src),frames=createHostSpriteFrames(media);
        let blank=0;
        for(const item of frames){
          const frame=item.frame;
          if(frame.x+frame.w>image.width||frame.y+frame.h>image.height)throw new Error(`Invalid frame ${name}`);
          context.clearRect(0,0,160,160);context.drawImage(image,frame.x,frame.y,frame.w,frame.h,0,0,160,160);
          const data=context.getImageData(0,0,160,160).data;
          let visible=0;for(let i=3;i<data.length;i+=4)if(data[i]>16)visible++;
          if(visible<100)blank++;
        }
        results.push({name,frames:frames.length,width:image.width,height:image.height,blank});
      }
      return results;
    });
    assert.equal(sprites.length,9);assert.ok(sprites.every(row=>row.blank===0));
    let decodedImages=[];
    if(manifest){
      decodedImages=await page.evaluate(async({assets,version})=>{
        const decoded=[];
        for(const asset of assets){
          if(asset.profile==='sprite')continue;
          const image=new Image();image.src=`./assets/${asset.target}?v=${version}`;
          await image.decode();
          decoded.push({name:asset.target,width:image.naturalWidth,height:image.naturalHeight});
          image.src='';
        }
        return decoded;
      },manifest);
      assert.equal(decodedImages.length,manifest.assets.filter(asset=>asset.profile!=='sprite').length);
      for(const row of decodedImages){
        const record=manifest.assets.find(asset=>asset.target===row.name);
        if(record.width){assert.equal(row.width,record.width,row.name);assert.equal(row.height,record.height,row.name);}
        assert.ok(row.width>0&&row.height>0,row.name);
      }
    }
    assert.deepEqual(assetErrors,[]);assert.deepEqual(errors,[]);
    const report={passed:true,phase,ready_ms:readyMs,screens,sprites,decodedImages,assetErrors,errors,
      audio_output_muted:true,workflow_and_tts_stubbed:true};
    fs.writeFileSync(`${folder}/report.json`,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:true,phase,ready_ms:readyMs,screens:screens.length,
      sprites:sprites.length,frames:sprites.reduce((sum,s)=>sum+s.frames,0),decoded_images:decodedImages.length,errors,assetErrors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
