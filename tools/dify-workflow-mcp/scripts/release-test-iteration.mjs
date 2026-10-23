import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createEcsConsole,profilesPath,projectRoot} from '../src/ecs-console.mjs';
import {appKinds,assertSeparateProfiles,readApp,readKnowledge,cloneKnowledge,workflowContent,
  fingerprint,describeDiff,saveSnapshot,remapKnowledge,saveDraft,publishChecked} from '../src/ecs-release.mjs';
import {runDraftRegression} from '../src/ecs-regression.mjs';
import {renderKnowhowUpload} from './sync-host-knowhow.mjs';

async function main() {
  const [mode, suppliedFolder] = process.argv.slice(2);
  assert.ok(['prepare','apply','verify','publish'].includes(mode));
  const folder=path.resolve(suppliedFolder || path.join(projectRoot,'tmp/dify-ecs',`${new Date().toISOString().replace(/[:.]/g,'-')}-test-iteration`));
  assert.ok(folder.startsWith(path.join(projectRoot,'tmp/dify-ecs')+path.sep));
  if(mode!=='prepare')assert.ok(suppliedFolder,'Supply the prepared folder');
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const save=(name,value)=>fs.writeFileSync(path.join(folder,`${name}.json`),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  const load=name=>JSON.parse(fs.readFileSync(path.join(folder,`${name}.json`),'utf8'));
  const profiles=JSON.parse(fs.readFileSync(profilesPath,'utf8'));
  const testing=profiles.environments['alibaba-test'], production=profiles.environments.alibaba;
  assertSeparateProfiles(production,testing);
  const request=createEcsConsole();
  const rows=fs.readFileSync(path.join(projectRoot,'docs/主持经验库-v1.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
  renderKnowhowUpload(rows);
  assert.equal(rows.length,28);
  if(mode==='prepare') {
    assert.equal(fs.existsSync(path.join(folder,'before.json')),false,'Prepared folder already exists');
    const before={testing,production,apps:{testing:{},production:{}},source_fingerprint:fingerprint(rows)};
    for(const [name,profile] of [['production',production],['testing',testing]])for(const kind of appKinds){
      before.apps[name][kind]=await readApp(request,profile.apps[kind]);
      saveSnapshot(folder,`${name}-${kind}`,before.apps[name][kind]);
    }
    before.knowledge=await readKnowledge(request,testing.knowledge.dataset_id);
    save('before',before);
    const summary={folder,changed_knowledge:before.knowledge.fingerprint!==fingerprint(rows),
      changed_records:rows.filter(row=>fingerprint(row)!==fingerprint(before.knowledge.rows.find(old=>old.knowhow_id===row.knowhow_id))).map(row=>row.knowhow_id),
      process_rule:before.knowledge.process_rule,testing_draft_diffs:Object.fromEntries(appKinds.map(kind=>[kind,
        describeDiff(before.apps.testing[kind].content,before.apps.testing[kind].draft_content)]))};
    save('plan',summary);console.log(JSON.stringify(summary,null,2));return;
  }
  const before=load('before');
  assert.equal(fingerprint(testing.apps),fingerprint(before.testing.apps));
  assert.equal(fingerprint(production.apps),fingerprint(before.production.apps));
  assert.equal(fingerprint(rows),before.source_fingerprint,'Local experience source changed; prepare again');
  const formalUnchanged=async()=>{
    for(const kind of appKinds)for(const version of ['draft','publish']){
      const current=await request(`/apps/${production.apps[kind]}/workflows/${version}`);
      const original=version==='draft'?before.apps.production[kind].draft:before.apps.production[kind].published;
      assert.equal(fingerprint(workflowContent(current)),fingerprint(workflowContent(original)),`Production ${kind} ${version} changed`);
    }
  };
  await formalUnchanged();
  if(mode==='apply') {
    assert.equal(fs.existsSync(path.join(folder,'applied.json')),false,'Already applied; do not create duplicate knowledge');
    for(const kind of appKinds){
      const current=await request(`/apps/${testing.apps[kind]}/workflows/draft`);
      assert.equal(current.hash,before.apps.testing[kind].draft.hash,`Concurrent test ${kind} change`);
    }
    const candidate={...before.knowledge,rows,fingerprint:fingerprint(rows),revision:fingerprint({rows,
      processRule:before.knowledge.process_rule,retrievalModel:before.knowledge.retrieval_model})};
    const knowledge=candidate.revision===before.knowledge.revision?before.knowledge:
      await cloneKnowledge(request,candidate,`测试 · 主持经验 ${new Date().toISOString().slice(0,16)}`,info=>save('created-knowledge',info));
    const applied={knowledge,apps:{}};save('applied',applied);
    for(const kind of appKinds){
      const next=remapKnowledge(before.apps.testing[kind].draft, before.knowledge.dataset_id,knowledge.dataset_id).workflow;
      applied.apps[kind]=await saveDraft(request,testing.apps[kind],next,before.apps.testing[kind].draft);
      save('applied',applied);
    }
    await formalUnchanged();
    console.log(JSON.stringify({applied:true,folder,dataset:knowledge.dataset_id,records:knowledge.rows.length,production_unchanged:true}));return;
  }
  const applied=load('applied');
  const knowledge=await readKnowledge(request,applied.knowledge.dataset_id);
  assert.equal(knowledge.revision,applied.knowledge.revision,'Test knowledge changed since apply');
  for(const kind of appKinds){
    const current=await request(`/apps/${testing.apps[kind]}/workflows/draft`);
    assert.equal(current.hash,applied.apps[kind].hash,`Test ${kind} draft changed`);
  }
  if(mode==='verify'){
    try{
      const result=await runDraftRegression(request,testing.apps,label=>console.log(`测试草稿回归：${label}`),knowledge.dataset_id);
      save('verification',{...result,draft_fingerprints:Object.fromEntries(appKinds.map(kind=>[kind,fingerprint(workflowContent(applied.apps[kind]))]))});
      await formalUnchanged();console.log(JSON.stringify({verified:true,checks:result.report.length,knowledge:result.direct_knowledge_check}));
    }catch(error){save('verification',{ok:false,...error.regression_report,error:error.message});throw error;}
    return;
  }
  const verification=load('verification');assert.equal(verification.ok,true,'Verify before publishing');
  const published={};
  for(const kind of appKinds){
    assert.equal(verification.draft_fingerprints[kind],fingerprint(workflowContent(applied.apps[kind])));
    const live=await request(`/apps/${testing.apps[kind]}/workflows/publish`);
    assert.equal(fingerprint(workflowContent(live)),fingerprint(before.apps.testing[kind].content),`Test ${kind} publication changed`);
    published[kind]=await publishChecked(request,testing.apps[kind],applied.apps[kind],'赛前候选20261023');
    save('published',{apps:published,completed:false});
  }
  await formalUnchanged();
  const currentProfiles=JSON.parse(fs.readFileSync(profilesPath,'utf8'));
  assert.equal(fingerprint(currentProfiles),fingerprint(profiles),'Environment profiles changed concurrently');
  testing.knowledge={...testing.knowledge,dataset_id:knowledge.dataset_id,document_id:knowledge.document_id};
  fs.writeFileSync(profilesPath,JSON.stringify(profiles,null,2)+'\n');
  save('published',{apps:published,completed:true,knowledge_id:knowledge.dataset_id,production_unchanged:true});
  console.log(JSON.stringify({published:true,environment:'alibaba-test',production_unchanged:true,knowledge_id:knowledge.dataset_id}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
