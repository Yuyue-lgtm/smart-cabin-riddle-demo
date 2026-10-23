const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true, args:['--mute-audio']});
  try {
    const records = [], errors = [];
    const page = await browser.newPage({viewport:{width:2380,height:1120}});
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/assets/') && response.status() >= 400) errors.push(response.url());
    });
    await page.route('**/api/client-diagnostic', route => route.fulfill({status:202,json:{ok:true}}));
    await page.route('**/api/health', route => route.fulfill({json:{ok:true,
      workflow_proxy:{configured:true},host_voice_configured:false}}));
    await page.route('**/api/workflow', route => {
      const body = route.request().postDataJSON(), input = JSON.parse(body.input_payload);
      const steps = ['它是人造的吗？','它通常在户外使用吗？','它有把手吗？','它能折叠吗？'].map((text,i) => ({
        id:`step-${i}`,order:i+1,fact_key:`fact-${i}`,depends_on:[],expected_answer:'是',variants:{default:text}}));
      return route.fulfill({json:{route:body.route,game_id:input.game_id,round_id:input.round_id,
        scene_version:input.scene_version,event_id:input.event?.id || '',event_type:input.event?.type || '',
        workflow_output:JSON.stringify({round_question_plan:{plan_id:input.round_id,steps},preview_status:'ready'}),
        scene_output:{analysis_status:'skipped',request_proactive_speech:false}}});
    });
    await page.route('**/api/tts', route => route.fulfill({status:503,json:{error:'Muted test'}}));
    await page.goto(process.env.TEST_DEMO_URL || 'http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => getGameScreenMode()==='ready' && hostSprite.playing,undefined,{timeout:60000});
    const expected = [
      ['dad','mom','boy','girl'],['maleYoung','femaleYoung2','empty','femaleYoung'],
      ['dad','femaleYoung','grandpa','grandma'],['dad','mom','empty','baby'],
      ['dad','mom','maleYoung','femaleYoung'],
    ];
    const seats = ['driver','front','rearLeft','rearRight'];
    for (const width of [2380,390]) {
      await page.setViewportSize({width,height:width===2380?1120:844});
      for (let index=0; index<5; index++) {
        await page.waitForFunction(i => state.scenarioIndex===i,index);
        for (let i=0;i<seats.length;i++) {
          const seat = page.locator(`[data-seat="${seats[i]}"]`);
          if (expected[index][i]==='empty') {
            assert.equal(await seat.isVisible(),false);
            assert.equal(await seat.evaluate(el => getComputedStyle(el).display),'none');
          } else {
            assert.equal(await seat.isVisible(),true);
            const image = seat.locator('[data-avatar]');
            await image.evaluate(async el => {await el.decode();});
            const dimensions = await image.evaluate(el => [el.naturalWidth,el.naturalHeight]);
            const expectedSource = await page.evaluate(persona => RESOURCE_CONFIG.passengers[persona].normal, expected[index][i]);
            assert.equal(await image.getAttribute('src'),expectedSource);
            assert.ok([286,287].includes(dimensions[0]));
            assert.equal(dimensions[1],328);
          }
        }
        if (index===1) {
          for (const [mood,suffix] of [['普通','normal'],['疲惫','tired'],['大笑','laugh'],['睡着','sleep']]) {
            await page.evaluate(value => {state.passengers.seats.front.mood=value;render();},mood);
            const img = page.locator('[data-seat="front"] [data-avatar]');
            await img.evaluate(async el => {await el.decode();});
            assert.ok((await img.getAttribute('src')).includes(`female-young2-${suffix}.webp`));
            const transparency = await img.evaluate(el => {
              const canvas=document.createElement('canvas');
              canvas.width=el.naturalWidth;canvas.height=el.naturalHeight;
              const context=canvas.getContext('2d');context.drawImage(el,0,0);
              const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
              let clear=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]===0)clear++;
              return {cornerAlpha:pixels[3],clear};
            });
            assert.equal(transparency.cornerAlpha,0);
            assert.ok(transparency.clear>30000);
            await page.locator('.cabin-region').screenshot({path:`tmp/golden-friends-${suffix}-${width}.png`});
          }
          await page.evaluate(() => {state.passengers.seats.front.mood='普通';render();});
        }
        if (index===3) {
          const result = await page.evaluate(async () => {
            const before=state.passengers.seats.rearRight.bubble;
            const direct=showPassengerBubble('rearRight','婴儿不应发言');
            const action=applyPassengerAction({seat:'rearRight',text:'婴儿不应提问'});
            await runScriptedQuestion('rearRight','婴儿不应提问');
            render();
            return {direct,action,before,after:state.passengers.seats.rearRight.bubble};
          });
          assert.deepEqual(result,{direct:false,action:false,before:'',after:''});
        }
        await page.locator('.cabin-region').screenshot({path:`tmp/golden-passengers-${index}-${width}.png`});
        records.push({width,scene:index,occupants:expected[index],passed:true});
        if ([1,3,4].includes(index)) {
          await page.locator('#readyStartButton').click();
          await page.waitForFunction(() => getGameScreenMode()==='playing',undefined,{timeout:10000});
          const emptySeat=[1,3].includes(index)?'rearLeft':null;
          if (emptySeat) assert.equal(await page.locator(`[data-seat="${emptySeat}"]`).isVisible(),false);
          await page.locator('.cabin-region').screenshot({path:`tmp/golden-passengers-playing-${index}-${width}.png`});
          await page.locator('#resetScenario').click();
          await page.waitForFunction(() => getGameScreenMode()==='ready');
          if (emptySeat) assert.equal(await page.locator(`[data-seat="${emptySeat}"]`).isVisible(),false);
        }
        await page.locator('#switchScenario').click();
      }
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tmp/golden-passengers-browser.json',JSON.stringify({passed:true,records,errors,muted:true,mocked:true},null,2));
    console.log(JSON.stringify({passed:true,scenarios:records.length,errors,muted:true,mocked:true}));
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
