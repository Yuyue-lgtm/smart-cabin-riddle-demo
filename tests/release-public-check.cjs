const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const origin=process.env.TEST_DEMO_URL||'https://cabinplay.xyz/';
const manifest=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
(async()=>{
  const records=[];
  for(const row of manifest.files.filter(row=>row.path==='index.html'||row.path==='client-app.js'||row.path==='styles.css'||row.path==='release-info.json'||row.path.startsWith('assets/'))){
    const url=new URL(row.path==='index.html'?'/':`/${row.path}`,origin);
    url.searchParams.set('qa_release',manifest.release_id);
    const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200,row.path);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length,row.bytes,row.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,row.path);
    records.push({path:row.path,bytes:bytes.length,verified:true});
  }
  const health=await fetch(new URL('/api/health',origin)).then(r=>r.json());
  assert.equal(health.release,'V1.4.2-competition-candidate');assert.equal(health.runtime,'production');
  assert.equal(health.workflow_proxy.configured,true);assert.equal(health.host_voice_configured,true);
  const readiness=await fetch(new URL('/api/readiness',origin),{signal:AbortSignal.timeout(30000)}).then(r=>r.json());
  assert.equal(readiness.ok,true);
  const privatePaths=[];
  for(const pathname of ['/.env.local','/.git/config','/api/dify-bff.js','/dev-server.cjs','/deployment-manifest.json','/tools/dify-workflow-mcp/.env.ecs']){
    const response=await fetch(new URL(pathname,origin),{signal:AbortSignal.timeout(10000)});
    privatePaths.push({pathname,status:response.status});assert.equal(response.status,404,pathname);
  }
  const range=await fetch(new URL('/assets/background-music.mp3',origin),{headers:{Range:'bytes=0-99'}});
  assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);
  const redirect=await fetch('http://cabinplay.xyz/',{redirect:'manual'});assert.equal(redirect.status,308);
  const www=await fetch('https://www.cabinplay.xyz/',{signal:AbortSignal.timeout(15000)});assert.equal(www.status,200);
  fs.mkdirSync('tmp/release-qa-20261023',{recursive:true});
  fs.writeFileSync('tmp/release-qa-20261023/public-check.json',JSON.stringify({passed:true,release:manifest.release_id,
    source_commit:manifest.source_commit,records,health,readiness,privatePaths,range:true,https:true},null,2));
  console.log(JSON.stringify({passed:true,public_files:records.length,release:health.release,ready:readiness.ok,private_paths:privatePaths.length,range:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});
