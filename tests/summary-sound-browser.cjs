const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

(async()=>{
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--mute-audio']});
  try {
    const page=await browser.newPage({viewport:{width:2380,height:1120}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/api/health')return route.fulfill({json:{workflow_proxy:{configured:true},host_voice_configured:false}});
      if(path!=='/api/workflow')return route.fulfill({json:{ok:true}});
      const body=route.request().postDataJSON(),input=JSON.parse(body.input_payload);
      const steps=['它是具体的东西吗？','它在日常生活里常见吗？','它和人类活动有关吗？','它可以被人移动吗？']
        .map((text,i)=>({id:`step-${i}`,order:i+1,fact_key:`fact-${i}`,depends_on:[],variants:{default:text}}));
      return route.fulfill({json:{route:body.route,operation:body.operation,game_id:input.game_id,round_id:input.round_id,
        scene_version:input.scene_version,event_id:input.event?.id,event_type:input.event?.type,
        workflow_output:JSON.stringify({preview_status:'ready',round_question_plan:{plan_id:input.round_id,steps}})}});
    });
    await page.goto(process.env.TEST_DEMO_URL||'http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>getGameScreenMode()==='ready',undefined,{timeout:60000});
    await page.mouse.click(5,5);
    await page.waitForFunction(()=>audioContext?.state==='running');
    await page.evaluate(()=>{
      window.chimeCalls=0;window.chimeTimes=[];window.chimeMvpSamples=[];const original=playSummarySound;
      playSummarySound=(entry)=>{
        const group=els.summaryMvp.closest('.summary-mvp-group');
        const animation=group.getAnimations().find(item=>item.animationName==='summary-mvp-emphasis');
        const timing=animation?.effect.getTiming();
        window.chimeMvpSamples.push(animation ? Number(animation.currentTime)-Number(timing.delay)-Number(timing.duration)*0.18 : null);
        window.chimeCalls++;window.chimeTimes.push(performance.now());original(entry);
      };
      cancelGameOpening('summary fixture');clearHostSpeechLock();state.host.text='';
      window.summaryEnteredAt=performance.now();state.game.status='summary';render();render();render();
    });
    assert.equal(await page.evaluate(()=>window.chimeCalls),0);
    await page.waitForFunction(()=>window.chimeCalls===1);
    const delay=await page.evaluate(()=>window.chimeTimes[0]-window.summaryEnteredAt);
    const syncError=await page.evaluate(()=>window.chimeMvpSamples[0]);
    assert.ok(syncError!==null&&syncError>=-1&&syncError<100,`Sound must follow MVP scale start, delta=${syncError}`);
    assert.equal(await page.evaluate(()=>window.chimeCalls),1);
    assert.equal(await page.evaluate(()=>backgroundMusic.enabled),false);
    await page.waitForFunction(()=>hostSprite.source.includes('host-cheer')&&hostSprite.playing,undefined,{timeout:15000});
    await page.evaluate(()=>{toggleTimelinePause();toggleTimelinePause();render();});
    assert.equal(await page.evaluate(()=>window.chimeCalls),1);
    await page.evaluate(()=>{
      state.game.status='idle';state.timeline.status='idle';render();
      state.workflow.gameId=createRuntimeId('summary-cancel');state.game.status='summary';render();
      state.game.status='idle';render();
    });
    await page.waitForTimeout(4000);
    assert.equal(await page.evaluate(()=>window.chimeCalls),1);
    await page.evaluate(()=>{
      state.workflow.gameId=createRuntimeId('summary-next');state.game.status='summary';
      const group=els.summaryMvp.closest('.summary-mvp-group');
      group.style.animationDelay='100ms';group.style.animationDuration='1000ms';render();render();
      toggleTimelinePause();
    });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>window.chimeCalls),1,'Sound waits with the paused MVP animation');
    await page.evaluate(()=>toggleTimelinePause());
    await page.waitForFunction(()=>window.chimeCalls===2);
    assert.equal(await page.evaluate(()=>window.chimeCalls),2);
    const shiftedSyncError=await page.evaluate(()=>window.chimeMvpSamples[1]);
    assert.ok(shiftedSyncError!==null&&shiftedSyncError>=-1&&shiftedSyncError<100,`Changed CSS timing delta=${shiftedSyncError}`);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,chimes_per_summary_entry:1,redraw_and_resume_do_not_replay:true,
      delay_ms:Math.round(delay),mvp_sync_error_ms:Math.round(syncError),changed_timing_sync_error_ms:Math.round(shiftedSyncError),
      cancelled_entry_does_not_play:true,
      music_off:true,existing_celebration_preserved:true,browser_output_muted:true,errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
