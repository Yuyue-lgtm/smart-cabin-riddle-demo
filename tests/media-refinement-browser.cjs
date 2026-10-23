const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const report=JSON.parse(fs.readFileSync('docs/IMAGE_OPTIMIZATION.json','utf8'));
const candidates=process.env.MEDIA_QA_CANDIDATES==='1';
if(candidates)report.audio_refinement={records:JSON.parse(fs.readFileSync(path.join(report.backup_directory,'media-refinement.json'),'utf8')).audio};

(async()=>{
  const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
  try{
    const page=await browser.newPage();
    if(candidates)await page.route('**/assets/**',route=>{
      const name=path.basename(new URL(route.request().url()).pathname);
      if(!report.audio_refinement.records.some(row=>row.name===name))return route.continue();
      return route.fulfill({contentType:'audio/mpeg',body:fs.readFileSync(path.join(report.backup_directory,'candidates',name))});
    });
    await page.route('**/api/**',route=>route.fulfill({json:{ok:true,workflow_proxy:{configured:false}}}));
    await page.goto(process.env.TEST_DEMO_URL||'http://127.0.0.1:4175/',{waitUntil:'domcontentloaded'});
    const results=[];
    for(const row of report.audio_refinement.records){
      const original=fs.readFileSync(path.join(report.backup_directory,'original/assets',row.name));
      const result=await page.evaluate(async({name,original,version})=>{
        const context=new OfflineAudioContext(1,1,44100);
        const before=await context.decodeAudioData(Uint8Array.from(atob(original),c=>c.charCodeAt(0)).buffer);
        const response=await fetch(`/assets/${name}?v=${version}`);
        if(!response.ok)throw new Error(`Audio HTTP ${response.status}`);
        const after=await context.decodeAudioData(await response.arrayBuffer());
        const frames=Math.min(before.length,after.length);
        let dot=0,a2=0,b2=0,peak=0;
        for(let i=0;i<frames;i++){
          let a=0;for(let channel=0;channel<before.numberOfChannels;channel++)a+=before.getChannelData(channel)[i]/before.numberOfChannels;
          const b=after.getChannelData(0)[i];dot+=a*b;a2+=a*a;b2+=b*b;peak=Math.max(peak,Math.abs(b));
        }
        return {name,before_seconds:before.duration,after_seconds:after.duration,frames:after.length,
          correlation:dot/Math.sqrt(a2*b2),rms_ratio:Math.sqrt(b2/a2),peak,channels:after.numberOfChannels};
      },{name:row.name,original:original.toString('base64'),version:report.version});
      assert.ok(Math.abs(result.before_seconds-result.after_seconds)<0.01,JSON.stringify(result));
      assert.ok(result.correlation>0.95,JSON.stringify(result));
      assert.ok(result.rms_ratio>0.85&&result.rms_ratio<1.15,JSON.stringify(result));
      assert.equal(result.channels,1);results.push(result);
    }
    const playback=await page.evaluate(async({records,version})=>Promise.all(records.map(record=>new Promise((resolve,reject)=>{
      const audio=new Audio(`/assets/${record.name}?v=${version}`);audio.muted=true;
      const timer=setTimeout(()=>{audio.pause();reject(new Error(`Audio playback timeout: ${record.name}`));},15000);
      audio.onerror=()=>{clearTimeout(timer);reject(new Error(`Audio decode failed: ${record.name}`));};
      audio.onended=()=>{clearTimeout(timer);resolve({name:record.name,ended:true,current_time:audio.currentTime,duration:audio.duration});};
      audio.play().catch(error=>{clearTimeout(timer);reject(error);});
    }))),{records:report.audio_refinement.records,version:report.version});
    assert.ok(playback.every(row=>row.ended));
    fs.writeFileSync(`tmp/media-refinement-audio${candidates?'-candidates':''}.json`,JSON.stringify({passed:true,results,playback,muted:true},null,2)+'\n');
    console.log(JSON.stringify({passed:true,results,playback,muted:true}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
