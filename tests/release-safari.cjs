const assert=require('node:assert/strict');
const fs=require('node:fs');
const endpoint=process.env.SAFARI_DRIVER_URL||'http://127.0.0.1:4481';
const origin=process.env.TEST_DEMO_URL||'https://cabinplay.xyz/';
let session;
async function command(method,route,body){
  const response=await fetch(endpoint+route,{method,headers:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok||result.value?.error)throw Error(result.value?.message||`WebDriver HTTP ${response.status}`);
  return result.value;
}
const wd=(method,route,body)=>command(method,`/session/${session}/${route}`,body);
const execute=script=>wd('POST','execute/sync',{script,args:[]});
function install(){
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){this.muted=true;return play.call(this);};
  document.querySelectorAll('audio,video').forEach(el=>{el.muted=true;});
  if(window.AudioNode){const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination,...args){if(destination===this.context.destination){
      const silent=this.context.createGain();silent.gain.value=0;connect.call(this,silent);return connect.call(silent,destination,...args);
    }return connect.call(this,destination,...args);};}
  const original=window.fetch.bind(window);
  window.fetch=async(url,options)=>{
    const pathname=new URL(typeof url==='string'?url:url.url,location.href).pathname;
    if(pathname==='/api/client-diagnostic')return Response.json({ok:true},{status:202});
    if(pathname!=='/api/workflow')return original(url,options);
    const body=JSON.parse(options.body),input=JSON.parse(body.input_payload);
    const scope={route:body.route,operation:body.operation,game_id:input.game_id,round_id:input.round_id,
      scene_version:input.scene_version,event_id:input.event?.id,event_type:input.event?.type};
    if(body.route!=='preview')return Response.json({...scope,scene_output:{analysis_status:'skipped',request_proactive_speech:false},workflow_output:'{}'});
    return Response.json({...scope,workflow_output:JSON.stringify({preview_status:'ready',round_question_plan:{plan_id:input.round_id,
      steps:['它是人造的吗？','它常在户外使用吗？','它有把手吗？','它可以折叠吗？'].map((text,i)=>({
        id:`safari-${i}`,order:i+1,fact_key:`safari-${i}`,depends_on:[],variants:{default:text}}))}})});
  };
  window.qaSafariErrors=[];addEventListener('error',event=>qaSafariErrors.push(String(event.message||'resource error')));
  return true;
}
function foregroundFixture(){
  Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
  window.dispatchEvent(new Event('focus'));
}
async function wait(script,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){
  try{if(await execute(`return Boolean(${script});`))return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,250));
}throw Error(`Safari wait timed out: ${script}`);}
async function click(selector){
  if(process.env.SAFARI_DOM_CLICK==='1'){
    return execute(`const element=document.querySelector(${JSON.stringify(selector)});
      if(!element||element.disabled)throw Error('Missing or disabled test control');element.click();return true;`);
  }
  const el=await wd('POST','element',{using:'css selector',value:selector});
  await wd('POST',`element/${el['element-6066-11e4-a52e-4f735466cecf']}/click`,{});}
(async()=>{
  const created=await command('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari',pageLoadStrategy:'eager'}}});
  session=created.sessionId;assert.ok(session);
  console.log(JSON.stringify({phase:'session',session}));
  const records=[];
  for(let i=0;i<3;i++){
    await wd('POST','url',{url:new URL(`/?qa_safari=${i}`,origin).href});
    await execute(`return (${install.toString()})();`);
    if(process.env.SAFARI_FOREGROUND_FIXTURE==='1')await execute(`return (${foregroundFixture.toString()})();`);
    console.log(JSON.stringify({phase:'navigation',index:i}));
    await wait("typeof startupLoading!=='undefined'&&!startupLoading.active&&getGameScreenMode()==='ready'&&hostSprite.playing");
    const row=await execute(`const rect=els.appShell.getBoundingClientRect();
      const pixels=els.hostCanvas.getContext('2d').getImageData(0,0,els.hostCanvas.width,els.hostCanvas.height).data;
      let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)visible++;
      return {width:rect.width,expectedWidth:STAGE_WIDTH*Math.min(innerWidth/STAGE_WIDTH,innerHeight/STAGE_HEIGHT),
        visible,frame:hostSprite.frameIndex,errors:qaSafariErrors};`);
    assert.ok(row.visible>1000);assert.ok(Math.abs(row.width-row.expectedWidth)<2);assert.deepEqual(row.errors,[]);records.push(row);
  }
  for(let i=0;i<5;i++){await click('#switchScenario');await wait(`state.scenarioIndex===${(i+1)%5}`);}
  await click('#readyStartButton');await wait("getGameScreenMode()==='playing'");
  await click('#pauseTimeline');assert.equal(await execute('return simulationRuntime.paused;'),true);
  await click('#resetScenario');await wait("getGameScreenMode()==='ready'&&!simulationRuntime.paused");
  fs.mkdirSync('tmp/release-qa-20261023',{recursive:true});
  const screenshot=await wd('GET','screenshot');fs.writeFileSync('tmp/release-qa-20261023/safari-ready.png',Buffer.from(screenshot,'base64'));
  const report={passed:true,browser:created.capabilities?.browserVersion||'Safari',records,navigations:3,
    scene_switches:5,paused_reset:true,models_mocked_after_initial_navigation:true,audio_muted_after_dom_ready:true,
    foreground_fixture:process.env.SAFARI_FOREGROUND_FIXTURE==='1',dom_click_fixture:process.env.SAFARI_DOM_CLICK==='1'};
  fs.writeFileSync('tmp/release-qa-20261023/safari.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(async error=>{
  fs.mkdirSync('tmp/release-qa-20261023',{recursive:true});
  let state;
  if(session){
    state=await execute(`return {url:location.href,title:document.title,ready:document.readyState,
      focused:document.hasFocus(),visibility:document.visibilityState,
      loading:typeof startupLoading==='undefined'?null:startupLoading,
      screen:typeof getGameScreenMode==='function'?getGameScreenMode():null,
      sprite:typeof hostSprite==='undefined'?null:{playing:hostSprite.playing,frameIndex:hostSprite.frameIndex},
      errors:window.qaSafariErrors||[],body:document.body.innerText.slice(0,1500)};`).catch(e=>({webdriver_error:e.message}));
    const screenshot=await wd('GET','screenshot').catch(()=>null);
    if(screenshot)fs.writeFileSync('tmp/release-qa-20261023/safari-failure.png',Buffer.from(screenshot,'base64'));
  }
  const report={passed:false,error:error.message,state};
  fs.writeFileSync('tmp/release-qa-20261023/safari.json',JSON.stringify(report,null,2));
  console.error(JSON.stringify(report));process.exitCode=1;
}).finally(async()=>{
  if(session)await command('DELETE',`/session/${session}`).catch(()=>{});
});
