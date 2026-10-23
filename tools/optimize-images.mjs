import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || 'sharp');
sharp.concurrency(2);
sharp.cache({memory:48, files:0, items:16});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = path.join(root, 'assets');
const imagePattern = /\.(png|webp|svg)$/;
const hash = data => createHash('sha256').update(data).digest('hex');
const exists = file => fs.access(file).then(()=>true,()=>false);
const samples = ['cabin-env-garage.png','cabin-env-rain.png','screen-default.png',
  'passenger-mom-normal.png','hi.webp','figma-ready-button.png','game-icon-loading.png'];
const version = '20261022-images-v1';

function profile(name) {
  if(name.endsWith('.svg')) return {kind:'svg', retained:true, reason:'tiny_vector_preserved'};
  if(name==='game-icon-loading.png') return {kind:'png', lossless:true};
  if(name.startsWith('cabin-env-')) return {kind:'cabin', quality:28, minimumPsnr:0};
  if(name.endsWith('.webp')) return {kind:'sprite', quality:88, minimumPsnr:36.5};
  if(name.startsWith('screen-')) return {kind:'background', quality:85, minimumPsnr:33};
  if(name.startsWith('passenger-') || name.startsWith('host-') || name==='cabin-interior.png') {
    return {kind:'portrait', quality:90, minimumPsnr:36.5};
  }
  return {kind:'ui', lossless:true};
}

async function pixels(file, frame=null) {
  let input=sharp(file);
  if(frame) input=input.extract({left:frame.x,top:frame.y,width:frame.w,height:frame.h})
    .resize(564,572,{fit:'fill'});
  else input=input.resize({width:900,height:900,fit:'inside',withoutEnlargement:true});
  return input.ensureAlpha().raw().toBuffer();
}

function comparePixels(before,after) {
  if(before.length!==after.length) throw new Error('Different decoded sizes');
  let squared=0, visible=0, exact=true;
  for(let i=0;i<before.length;i+=4) {
    const alpha=before[i+3]/255;
    if(alpha>0) visible++;
    for(let channel=0;channel<3;channel++) {
      const delta=(before[i+channel]-after[i+channel])*alpha;
      squared+=delta*delta;
      if(delta!==0) exact=false;
    }
  }
  const mse=squared/Math.max(1,visible*3);
  return {psnr:mse===0?null:10*Math.log10(255**2/mse), exact};
}

async function alphaEqual(before,after) {
  const a=await sharp(before).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const b=await sharp(after).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  return a.equals(b);
}

async function visiblePixelsEqual(before,after) {
  const a=await sharp(before).ensureAlpha().raw().toBuffer();
  const b=await sharp(after).ensureAlpha().raw().toBuffer();
  if(a.length!==b.length) return false;
  for(let i=0;i<a.length;i+=4) {
    if(a[i+3]!==b[i+3]) return false;
    if(a[i+3] && (a[i]!==b[i] || a[i+1]!==b[i+1] || a[i+2]!==b[i+2])) return false;
  }
  return true;
}

async function metrics(before,after,name) {
  const result=comparePixels(await pixels(before),await pixels(after));
  const metadataPath=before.replace(/\.webp$/,'.json');
  if(name.endsWith('.webp') && await exists(metadataPath)) {
    const metadata=JSON.parse(await fs.readFile(metadataPath,'utf8'));
    const frames=Object.values(metadata.frames || {});
    result.frame_samples=[];
    for(const index of [...new Set([0,Math.floor(frames.length/2),frames.length-1])]) {
      const frame=frames[index].frame;
      result.frame_samples.push({index,...comparePixels(await pixels(before,frame),await pixels(after,frame))});
    }
  }
  result.alpha_exact=await alphaEqual(before,after);
  return result;
}

async function comparisonImage(before,after,name,directory) {
  const sources=[];
  if(name.endsWith('.webp')) {
    const metadata=JSON.parse(await fs.readFile(before.replace(/\.webp$/,'.json'),'utf8'));
    const frames=Object.values(metadata.frames);
    for(const index of [0,Math.floor(frames.length/2),frames.length-1]) {
      for(const file of [before,after]) {
        const f=frames[index].frame;
        sources.push(await sharp(file).extract({left:f.x,top:f.y,width:f.w,height:f.h})
          .resize(480,480).png().toBuffer());
      }
    }
  } else {
    for(const file of [before,after]) sources.push(await sharp(file)
      .resize(600,520,{fit:'contain',background:'#e7e7e7'}).png().toBuffer());
  }
  const width=name.endsWith('.webp')?480:600, height=name.endsWith('.webp')?480:520;
  await sharp({create:{width:width*2,height:height*sources.length/2,channels:4,background:'#e7e7e7'}})
    .composite(sources.map((input,index)=>({input,left:index%2*width,top:Math.floor(index/2)*height})))
    .png().toFile(path.join(directory,`${name}.before-after.png`));
}

async function createRun() {
  if(await exists(path.join(root,'docs/IMAGE_OPTIMIZATION.json'))) {
    throw new Error('Images already have an applied batch. Do not recompress its outputs; use the original batch backup.');
  }
  const directory=path.join(root,'tmp/image-optimization',new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(path.join(directory,'original'),{recursive:true});
  await fs.cp(assetDir,path.join(directory,'original/assets'),{recursive:true});
  await fs.mkdir(path.join(directory,'candidates'),{recursive:true});
  await fs.mkdir(path.join(directory,'comparisons'),{recursive:true});
  const inventory=[];
  for(const name of (await fs.readdir(assetDir)).filter(name=>!name.startsWith('.')).sort()) {
    const data=await fs.readFile(path.join(assetDir,name));
    inventory.push({name,bytes:data.length,sha256:hash(data)});
  }
  const report={schema_version:1,version,created_at:new Date().toISOString(),
    backup_directory:path.relative(root,directory),inventory,assets:[]};
  await save(directory,report);
  return {directory,report};
}

async function save(directory,report) {
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
}

async function encode(directory,report,name,override={}) {
  const policy={...profile(name),...override},original=path.join(directory,'original/assets',name);
  const baseline=report.inventory.find(item=>item.name===name);
  if(policy.retained) return {source:name,target:name,profile:policy.kind,status:'retained',reason:policy.reason,
    original_bytes:baseline.bytes,bytes:baseline.bytes,original_sha256:baseline.sha256,sha256:baseline.sha256};
  const metadata=await sharp(original).metadata();
  let target=policy.kind==='png'?name:name.replace(/\.(png|webp)$/,'.webp');
  if(name.endsWith('.png') && report.inventory.some(r=>r.name===target) && target!==name) {
    target=name.replace(/\.png$/,'-static.webp');
  }
  const output=path.join(directory,'candidates',target);
  let quality=policy.quality,comparison;
  for(;;) {
    let pipeline=sharp(original).keepIccProfile();
    pipeline=policy.kind==='png' ? pipeline.png({compressionLevel:9,adaptiveFiltering:true})
      : pipeline.webp({quality,lossless:policy.lossless,alphaQuality:100,effort:6,smartSubsample:true});
    await pipeline.toFile(output);
    const afterMetadata=await sharp(output).metadata();
    if(metadata.width!==afterMetadata.width || metadata.height!==afterMetadata.height) throw new Error(`${name}: dimensions changed`);
    comparison=await metrics(original,output,name);
    const measures=[comparison,...comparison.frame_samples || []];
    if(policy.lossless) comparison.visible_pixels_exact=await visiblePixelsEqual(original,output);
    const acceptable=comparison.alpha_exact && (policy.lossless ? comparison.visible_pixels_exact
      : measures.every(m=>m.exact || m.psnr===null || m.psnr>=policy.minimumPsnr));
    if(acceptable) break;
    if(!policy.lossless && quality<96) {quality=Math.min(96,quality+4);continue;}
    if(!policy.lossless) {policy.lossless=true;quality=undefined;continue;}
    throw new Error(`${name}: lossless quality/alpha validation failed`);
  }
  const data=await fs.readFile(output);
  const improved=data.length<baseline.bytes*0.98;
  const record={source:name,target:improved?target:name,profile:policy.kind,
    status:improved?'optimized':'retained',reason:improved?'smaller_and_validated':'less_than_2_percent_saving',
    width:metadata.width,height:metadata.height,original_bytes:baseline.bytes,bytes:improved?data.length:baseline.bytes,
    original_sha256:baseline.sha256,sha256:improved?hash(data):baseline.sha256,
    encoding:policy.kind==='png'?'png':policy.lossless?'webp_lossless':`webp_q${quality}`,quality,...comparison};
  if(samples.includes(name)) await comparisonImage(original,improved?output:original,name,path.join(directory,'comparisons'));
  return record;
}

function totals(report) {
  return {count:report.assets.length,original_bytes:report.assets.reduce((sum,r)=>sum+r.original_bytes,0),
    bytes:report.assets.reduce((sum,r)=>sum+r.bytes,0),optimized:report.assets.filter(r=>r.status==='optimized').length};
}

function markdown(report) {
  const mib=value=>(value/1048576).toFixed(2);
  const saved=(100*(1-report.totals.bytes/report.totals.original_bytes)).toFixed(1);
  const sprites=report.assets.filter(row=>row.profile==='sprite');
  const spriteBefore=sprites.reduce((sum,row)=>sum+row.original_bytes,0),spriteAfter=sprites.reduce((sum,row)=>sum+row.bytes,0);
  const previousSpriteBytes=report.stage_history?.find(stage=>stage.sprite_bytes)?.sprite_bytes;
  const lines=['# 图片压缩报告','',
    `本地批次：\`${report.version}\`。共检查${report.assets.length}张图片，${report.totals.optimized}张缩小，`+
      `总计${mib(report.totals.original_bytes)} MiB → ${mib(report.totals.bytes)} MiB，减少${saved}%。`,'',
    `主持人9张图集：${mib(spriteBefore)} MiB → ${mib(spriteAfter)} MiB，累计减少${(100*(1-spriteAfter/spriteBefore)).toFixed(1)}%。`+
      (previousSpriteBytes?`图集第一轮为${mib(previousSpriteBytes)} MiB，当前比图集第一轮减少${(100*(1-spriteAfter/previousSpriteBytes)).toFixed(1)}%。`:''),'',
    '## 处理规则','',
    '- `cabin-env-*`：WebP质量28，允许较明显细节损失，由实际玻璃叠层下的页面对比验收。',
    '- 中控背景：高质量WebP；人物：较高质量WebP；未列入追加压缩的文字及装饰切片：无损WebP。',
    ...(report.ui_refinement ? [`- 首轮UI追加压缩为${report.ui_refinement.records.length}张：装饰质量32起、文字质量58起。该阶段合计${(report.ui_refinement.before_bytes/1024).toFixed(1)} KiB → ${(report.ui_refinement.bytes/1024).toFixed(1)} KiB，减少${(100*(1-report.ui_refinement.bytes/report.ui_refinement.before_bytes)).toFixed(1)}%；后续追加以当前文件明细为准。`] : []),
    `- 主持人图集：WebP质量${report.refined_quality||88}起，逐帧采样检查后决定最终质量；从原始备份编码，9张图集均不缩放、不裁剪、不改帧坐标、帧数或时长。`,
    ...(report.sprite_restoration ? [`- 主持人最新恢复：按用户要求，从\`${report.sprite_restoration.from_version}\`备份逐字节还原9张质量78图集，合计${mib(report.sprite_restoration.bytes)} MiB；未重新编码，其他媒体维持追加压缩结果。`] : []),
    report.media_refinement ? '- 准备页panel-mosaic降为128像素宽，约2.5 KB，页面显示尺寸不变；stage-beam简化纹理并重建平滑渐变，保持480×480输出，低于25 KB。图集和人物兜底图保持逐像素透明通道。大于100 KB的中控背景再次压缩，所有中控背景低于120000字节。'
      : '- 所有被替换的位图逐像素验证透明通道；静态fallback加`-static`后缀，不能覆盖同名动画图集。',
    report.media_refinement ? '- 图标维持130×130 PNG，使用128色调色板压缩；12个SVG保持原字节。'
      : '- 图标维持130×130 PNG并无损优化；12个SVG合计很小，保持原字节。',
    report.audio_refinement ? `- hi-audio、host-cheer、host-yes使用原始备份转码为64 kbps单声道MP3，保留LAME时长与编码延迟标记；合计${(report.audio_refinement.before_bytes/1024).toFixed(1)} KiB → ${(report.audio_refinement.bytes/1024).toFixed(1)} KiB。未更改播放速度、音量、动画时序或JSON。`
      : '- 不改变音频。',
    '- 仅调整媒体资源及缓存版本；不改变加载策略、游戏逻辑或Dify。','',
    '## 备份与校验','',
    `原资源及被修改的源文件备份：\`${report.backup_directory}/original/\`（本地忽略目录，不随网页发布）。`,
    '每个文件的原始/压缩SHA-256、尺寸、质量档位、透明度和抽帧指标见同目录的`IMAGE_OPTIMIZATION.json`。',
    '只从本批次原始备份编码，不重复压缩已经优化的输出。若需回退，先核对工作区后续修改，不直接覆盖其他人的更新。','',
    ...(report.verification ? ['## 验收结果','',...report.verification.map(line=>`- ${line}`),''] : []),
    '## 文件明细','',
    '| 原文件 | 运行文件 | 原体积 KiB | 新体积 KiB | 编码 |',
    '| --- | --- | ---: | ---: | --- |'];
  for(const row of [...report.assets].sort((a,b)=>a.source.localeCompare(b.source))) {
    lines.push(`| ${row.source} | ${row.target} | ${(row.original_bytes/1024).toFixed(1)} | ${(row.bytes/1024).toFixed(1)} | ${row.encoding||row.reason} |`);
  }
  return lines.join('\n')+'\n';
}

function normalizeReferences(text,replacements) {
  for(const row of replacements) if(row.target!==row.source) text=text.replaceAll(row.target,row.source);
  return text.replace(/(\.\/assets\/[\w.-]+\.(?:png|webp|svg))\?[^\s"'`)]+/g,'$1')
    .replace(/(\.\/client-app\.js|\.\/styles\.css)\?[^"']+/g,'$1');
}

async function prepare(directory,sampleOnly) {
  const run=directory ? {directory:path.resolve(directory),report:JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'))} : await createRun();
  const names=run.report.inventory.map(r=>r.name).filter(n=>imagePattern.test(n)&&(!sampleOnly||samples.includes(n)));
  for(const name of names) {
    if(run.report.assets.some(r=>r.source===name)) continue;
    const record=await encode(run.directory,run.report,name);
    run.report.assets.push(record);
    await save(run.directory,run.report);
    console.log(JSON.stringify({name,status:record.status,encoding:record.encoding,before:record.original_bytes,
      after:record.bytes,psnr:record.psnr,alpha_exact:record.alpha_exact}));
  }
  run.report.totals=totals(run.report);
  await save(run.directory,run.report);
  console.log(JSON.stringify({directory:run.directory,...run.report.totals}));
}

async function apply(directory) {
  directory=path.resolve(directory);
  const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
  if(report.applied_at) throw new Error('This batch was already applied; do not recompress it');
  const images=report.inventory.filter(r=>imagePattern.test(r.name));
  if(images.length!==report.assets.length) throw new Error('Finish all candidates before applying');
  for(const original of report.inventory) {
    if(hash(await fs.readFile(path.join(assetDir,original.name)))!==original.sha256) throw new Error(`${original.name} changed after backup`);
  }
  const replacements=report.assets.filter(r=>r.status==='optimized');
  for(const r of replacements) {
    if(hash(await fs.readFile(path.join(directory,'candidates',r.target)))!==r.sha256) throw new Error(`Candidate mismatch: ${r.target}`);
    if(r.target!==r.source && await exists(path.join(assetDir,r.target))) throw new Error(`Target exists: ${r.target}`);
  }
  const files=['index.html','styles.css','client-app.js','docs/ASSET_CONFIG.md','docs/ASSET_MANIFEST.md','docs/GAME_LOADING.md',
    ...(await fs.readdir(path.join(root,'tests'))).filter(n=>/\.(cjs|mjs)$/.test(n)).map(n=>'tests/'+n)];
  const edits=[];
  for(const relative of files) {
    const file=path.join(root,relative),before=await fs.readFile(file,'utf8');
    let after=before;
    for(const r of replacements) if(r.target!==r.source) after=after.replaceAll(r.source,r.target);
    // Invalidate every runtime image URL, including unchanged filenames for sprite sheets.
    if(['index.html','styles.css','client-app.js'].includes(relative)) {
      after=after.replace(/(\.\/assets\/[\w.-]+\.(?:png|webp|svg))\?[^\s"'`)]+/g,`$1?v=${version}`)
        .replace(/(\.\/assets\/[\w.-]+\.(?:png|webp|svg))(?![\w.?])/g,`$1?v=${version}`);
      if(relative==='index.html') after=after.replace(/(\.\/client-app\.js|\.\/styles\.css)\?[^"']+/g,`$1?v=${version}`);
      if(normalizeReferences(before,replacements)!==normalizeReferences(after,replacements)) {
        throw new Error(`Non-resource runtime edit detected: ${relative}`);
      }
    }
    if(before!==after) edits.push({relative,before,after});
  }
  await fs.mkdir(path.join(directory,'original/source'),{recursive:true});
  for(const edit of edits) {
    const backup=path.join(directory,'original/source',edit.relative);
    await fs.mkdir(path.dirname(backup),{recursive:true});await fs.writeFile(backup,edit.before);
  }
  for(const r of replacements) {
    const target=path.join(assetDir,r.target),temporary=target+'.optimizing';
    await fs.copyFile(path.join(directory,'candidates',r.target),temporary);await fs.rename(temporary,target);
  }
  for(const edit of edits) {
    const target=path.join(root,edit.relative),temporary=target+'.optimizing';
    await fs.writeFile(temporary,edit.after);await fs.rename(temporary,target);
  }
  for(const r of replacements) if(r.target!==r.source) await fs.unlink(path.join(assetDir,r.source));
  report.applied_at=new Date().toISOString();report.totals=totals(report);
  report.runtime_only_resource_references_changed=true;
  report.source_edits=edits.map(e=>({file:e.relative,before_sha256:hash(e.before),after_sha256:hash(e.after)}));
  await save(directory,report);
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.md'),markdown(report));
  console.log(JSON.stringify({applied:true,directory,source_files:edits.length,...report.totals}));
}

async function refineSprites(directory,quality,sampleOnly) {
  directory=path.resolve(directory);quality=Number(quality);
  if(!Number.isInteger(quality)||quality<60||quality>95) throw new Error('Sprite quality must be between 60 and 95');
  const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));
  if(!report.applied_at || report.refined_quality===quality) throw new Error('Refinement requires an applied batch and a new quality');
  const sprites=report.assets.filter(row=>row.profile==='sprite');
  for(const row of report.assets) {
    if(hash(await fs.readFile(path.join(assetDir,row.target)))!==row.sha256) throw new Error(`Asset changed after last application: ${row.target}`);
  }
  const progressFile=path.join(directory,`refinement-q${quality}.json`);
  const progress=await exists(progressFile) ? JSON.parse(await fs.readFile(progressFile,'utf8'))
    : {quality,baseline_version:report.version,records:[]};
  if(progress.baseline_version!==report.version) throw new Error('Refinement baseline changed');
  const selected=sampleOnly ? sprites.filter(row=>['hi.webp','host-speak.webp'].includes(row.source)) : sprites;
  for(const row of selected) {
    if(progress.records.some(record=>record.source===row.source)) continue;
    let record=await encode(directory,report,row.source,{quality});
    if(record.bytes>=row.bytes*0.98) {
      record=row;
      await fs.copyFile(path.join(assetDir,row.target),path.join(directory,'candidates',row.target));
    }
    progress.records.push(record);
    await fs.writeFile(progressFile,JSON.stringify(progress,null,2)+'\n');
    await comparisonImage(path.join(directory,'original/assets',row.source),path.join(directory,'candidates',record.target),
      row.source,path.join(directory,'comparisons'));
    console.log(JSON.stringify({name:row.source,encoding:record.encoding,original_bytes:row.original_bytes,
      previous_bytes:row.bytes,bytes:record.bytes,psnr:record.psnr,frame_psnr:record.frame_samples.map(frame=>frame.psnr),alpha_exact:record.alpha_exact}));
  }
  if(sampleOnly) {console.log(JSON.stringify({samples_ready:true,quality,directory}));return;}
  if(progress.records.length!==sprites.length) throw new Error('Incomplete sprite refinement');
  const stage=path.join(directory,'stages',report.version);
  await fs.mkdir(stage,{recursive:true});
  await fs.writeFile(path.join(stage,'report.json'),JSON.stringify(report,null,2)+'\n');
  for(const row of sprites) {
    const current=await fs.readFile(path.join(assetDir,row.target));
    if(hash(current)!==row.sha256)throw new Error(`Sprite changed during refinement: ${row.target}`);
    await fs.writeFile(path.join(stage,row.target),current);
  }
  const nextVersion=report.version.replace(/-v(\d+)$/,(_,number)=>`-v${Number(number)+1}`);
  const edits=[];
  for(const name of ['client-app.js','styles.css','index.html']) {
    const before=await fs.readFile(path.join(root,name),'utf8');
    const after=before.replaceAll(`?v=${report.version}`,`?v=${nextVersion}`);
    if(normalizeReferences(before,[])!==normalizeReferences(after,[]))throw new Error(`Non-resource refinement edit: ${name}`);
    edits.push({name,after});
  }
  for(const record of progress.records) {
    const target=path.join(assetDir,record.target),temporary=target+'.optimizing';
    const candidate=path.join(directory,'candidates',record.target);
    if(hash(await fs.readFile(candidate))!==record.sha256)throw new Error(`Candidate changed: ${record.target}`);
    await fs.copyFile(candidate,temporary);await fs.rename(temporary,target);
    report.assets[report.assets.findIndex(row=>row.source===record.source)]=record;
  }
  for(const edit of edits) {
    const target=path.join(root,edit.name),temporary=target+'.optimizing';
    await fs.writeFile(temporary,edit.after);await fs.rename(temporary,target);
    const original=report.source_edits.find(row=>row.file===edit.name);
    if(original)original.after_sha256=hash(edit.after);
  }
  report.stage_history=[...(report.stage_history||[]),{version:report.version,totals:report.totals,
    sprite_bytes:sprites.reduce((sum,row)=>sum+row.bytes,0)}];
  report.version=nextVersion;report.refined_quality=quality;report.refined_at=new Date().toISOString();
  report.totals=totals(report);await save(directory,report);
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.md'),markdown(report));
  console.log(JSON.stringify({refined:true,quality,version:nextVersion,sprite_bytes:progress.records.reduce((sum,row)=>sum+row.bytes,0),...report.totals}));
}

const uiTargets = ['figma-summary-mosaic','figma-ready-panel-mosaic','figma-ready-ring-mosaic',
  'figma-ready-logo','figma-summary-title','figma-summary-bright-light','stage-beam','figma-ready-button',
  'figma-summary-light-ring','cabin-correct-light','figma-summary-mvp'];

async function refineUi(directory,applyChanges) {
  directory=path.resolve(directory);
  const report=JSON.parse(await fs.readFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),'utf8'));
  if(path.resolve(root,report.backup_directory)!==directory) throw new Error('Original backup directory mismatch');
  const rows=report.assets.filter(row=>uiTargets.includes(row.target.replace(/\.webp$/,'')));
  if(rows.length!==uiTargets.length || report.ui_refinement) throw new Error('Expected exactly 11 not-yet-refined UI assets');
  for(const row of report.assets) {
    if(hash(await fs.readFile(path.join(assetDir,row.target)))!==row.sha256) throw new Error(`Asset changed: ${row.target}`);
  }
  const progressFile=path.join(directory,'ui-refinement.json');
  const progress=await exists(progressFile) ? JSON.parse(await fs.readFile(progressFile,'utf8'))
    : {baseline_version:report.version,records:[]};
  if(progress.baseline_version!==report.version) throw new Error('UI refinement baseline changed');
  for(const row of rows) {
    if(progress.records.some(record=>record.source===row.source)) continue;
    const original=path.join(directory,'original/assets',row.source);
    if(hash(await fs.readFile(original))!==row.original_sha256) throw new Error(`Original backup changed: ${row.source}`);
    const text=/^figma-(ready-logo|summary-title|ready-button|summary-mvp)\./.test(row.target);
    const minimumPsnr=text?32:26;
    const record=await encode(directory,report,row.source,{quality:text?58:32,minimumPsnr,lossless:false});
    if(record.target!==row.target || record.bytes>=row.bytes*0.98 || !record.alpha_exact) {
      throw new Error(`UI candidate did not improve safely: ${row.target}`);
    }
    record.refinement_minimum_psnr=minimumPsnr;
    progress.records.push(record);
    await fs.writeFile(progressFile,JSON.stringify(progress,null,2)+'\n');
    await comparisonImage(original,path.join(directory,'candidates',record.target),row.source,path.join(directory,'comparisons'));
    console.log(JSON.stringify({name:row.target,before:row.bytes,after:record.bytes,encoding:record.encoding,psnr:record.psnr,alpha_exact:record.alpha_exact}));
  }
  if(!applyChanges) {console.log(JSON.stringify({candidates_ready:true,count:progress.records.length}));return;}
  const stage=path.join(directory,'stages',report.version);
  if(await exists(stage)) throw new Error('Stage backup already exists');
  await fs.mkdir(stage,{recursive:true});
  await fs.writeFile(path.join(stage,'report.json'),JSON.stringify(report,null,2)+'\n');
  const edits=[];
  const nextVersion=report.version.replace(/-v(\d+)$/,(_,number)=>`-v${Number(number)+1}`);
  for(const name of ['client-app.js','styles.css','index.html']) {
    const before=await fs.readFile(path.join(root,name),'utf8');
    const after=before.replaceAll(`?v=${report.version}`,`?v=${nextVersion}`);
    if(normalizeReferences(before,[])!==normalizeReferences(after,[])) throw new Error(`Non-resource UI edit: ${name}`);
    await fs.writeFile(path.join(stage,name),before);
    edits.push({name,before,after});
  }
  for(const row of rows) {
    const current=await fs.readFile(path.join(assetDir,row.target));
    if(hash(current)!==row.sha256) throw new Error(`UI changed during refinement: ${row.target}`);
    await fs.writeFile(path.join(stage,row.target),current);
  }
  for(const record of progress.records) {
    const candidate=await fs.readFile(path.join(directory,'candidates',record.target));
    if(hash(candidate)!==record.sha256) throw new Error(`UI candidate changed: ${record.target}`);
  }
  for(const edit of edits) {
    if(await fs.readFile(path.join(root,edit.name),'utf8')!==edit.before) throw new Error(`Source changed: ${edit.name}`);
  }
  for(const record of progress.records) {
    const target=path.join(assetDir,record.target),temporary=target+'.optimizing';
    await fs.copyFile(path.join(directory,'candidates',record.target),temporary);await fs.rename(temporary,target);
    report.assets[report.assets.findIndex(row=>row.source===record.source)]=record;
  }
  for(const edit of edits) {
    const target=path.join(root,edit.name),temporary=target+'.optimizing';
    await fs.writeFile(temporary,edit.after);await fs.rename(temporary,target);
  }
  report.stage_history=[...(report.stage_history||[]),{version:report.version,totals:report.totals,
    sprite_bytes:report.assets.filter(row=>row.profile==='sprite').reduce((sum,row)=>sum+row.bytes,0)}];
  report.ui_refinement={applied_at:new Date().toISOString(),baseline_version:report.version,
    before_bytes:rows.reduce((sum,row)=>sum+row.bytes,0),bytes:progress.records.reduce((sum,row)=>sum+row.bytes,0),
    records:progress.records.map(row=>({target:row.target,previous_bytes:rows.find(old=>old.target===row.target).bytes,
      bytes:row.bytes,quality:row.quality,minimum_psnr:row.refinement_minimum_psnr}))};
  report.version=nextVersion;report.totals=totals(report);
  report.verification=['追加压缩候选已核对尺寸与透明通道；页面及自动回归验收待完成。',
    '仅更新本地资源，未部署线上；旧标签页需强制刷新。'];
  await save(directory,report);
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.md'),markdown(report));
  console.log(JSON.stringify({applied:true,version:nextVersion,...report.ui_refinement}));
}

async function refineMedia(directory,applyChanges) {
  directory=path.resolve(directory);
  const report=JSON.parse(await fs.readFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),'utf8'));
  if(path.resolve(root,report.backup_directory)!==directory || report.media_refinement) throw new Error('Unexpected media baseline');
  const extra=['figma-ready-panel-mosaic.webp','stage-beam.webp','figma-summary-ribbon.webp',
    'host-cheer-static.webp','host-yes-static.webp','host-heart-static.webp','host-normal-static.webp','game-icon-loading.png'];
  const rows=report.assets.filter(row=>row.profile==='sprite'||extra.includes(row.target)
    || row.target.startsWith('screen-')&&row.bytes>100000);
  for(const row of report.assets) {
    if(hash(await fs.readFile(path.join(assetDir,row.target)))!==row.sha256) throw new Error(`Asset changed: ${row.target}`);
  }
  const progressFile=path.join(directory,'media-refinement.json');
  const progress=await exists(progressFile)?JSON.parse(await fs.readFile(progressFile,'utf8'))
    :{baseline_version:report.version,records:[],audio:[]};
  if(progress.baseline_version!==report.version)throw new Error('Media baseline changed');
  for(const row of rows) {
    if(progress.records.some(record=>record.source===row.source))continue;
    const original=path.join(directory,'original/assets',row.source);
    if(hash(await fs.readFile(original))!==row.original_sha256)throw new Error(`Original changed: ${row.source}`);
    const output=path.join(directory,'candidates',row.target);
    let record;
    if(['figma-ready-panel-mosaic.webp','stage-beam.webp','game-icon-loading.png'].includes(row.target)) {
      const icon=row.target.endsWith('.png'),panel=row.target==='figma-ready-panel-mosaic.webp';
      const pipeline=sharp(original).keepIccProfile();
      if(panel)pipeline.resize({width:128});
      await (icon?pipeline.png({palette:true,colours:128,quality:80,dither:0,effort:10})
        :pipeline.webp({quality:24,alphaQuality:panel?100:60,effort:6})).toFile(output);
      const data=await fs.readFile(output),metadata=await sharp(output).metadata();
      const comparison=panel?comparePixels(
        await sharp(original).resize(metadata.width,metadata.height).ensureAlpha().raw().toBuffer(),
        await sharp(output).ensureAlpha().raw().toBuffer()):await metrics(original,output,row.source);
      if((!panel&&(metadata.width!==row.width||metadata.height!==row.height))||data.length>=row.bytes*0.98)throw new Error(`Special candidate invalid: ${row.target}`);
      if(panel&&data.length>8000||!panel&&!icon&&data.length>16000)throw new Error(`Decoration budget exceeded: ${row.target}`);
      let alpha=sharp(original);
      if(panel)alpha=alpha.resize(metadata.width,metadata.height);
      const a=await alpha.ensureAlpha().extractChannel('alpha').raw().toBuffer();
      const b=await sharp(output).ensureAlpha().extractChannel('alpha').raw().toBuffer();
      let square=0,max=0;
      for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);square+=delta*delta;max=Math.max(max,delta);}
      const alphaRmse=Math.sqrt(square/a.length);
      if(icon&&(comparison.psnr<30||alphaRmse>3))throw new Error('Icon lost too much detail');
      record={...row,...comparison,width:metadata.width,height:metadata.height,
        ...(panel?{original_width:row.width,original_height:row.height,alpha_exact:false,resized:true}:{}),
        bytes:data.length,sha256:hash(data),visible_pixels_exact:false,
        encoding:icon?'png_palette_128':'webp_q24',quality:icon?80:24,
        alpha_quantized:true,alpha_rmse:alphaRmse,alpha_max_error:max,refinement_minimum_psnr:icon?30:0};
    }else{
      const sprite=row.profile==='sprite',background=row.target.startsWith('screen-');
      record=await encode(directory,report,row.source,{quality:sprite?60:background?68:64,
        minimumPsnr:sprite?35:background?31:33,lossless:false});
      record.refinement_minimum_psnr=sprite?35:background?31:33;
      if(background&&record.bytes>=120000)throw new Error(`Screen background exceeds 120 KB: ${row.target}`);
      if(record.target!==row.target||record.bytes>=row.bytes*0.98)throw new Error(`No further saving: ${row.target}`);
    }
    progress.records.push(record);
    await fs.writeFile(progressFile,JSON.stringify(progress,null,2)+'\n');
    await comparisonImage(original,output,row.source,path.join(directory,'comparisons'));
    console.log(JSON.stringify({name:row.target,before:row.bytes,after:record.bytes,encoding:record.encoding,psnr:record.psnr,alpha_exact:record.alpha_exact}));
  }
  for(const name of ['hi-audio.mp3','host-cheer.mp3','host-yes.mp3']) {
    if(progress.audio.some(record=>record.name===name))continue;
    const original=path.join(directory,'original/assets',name),baseline=report.inventory.find(row=>row.name===name);
    if(hash(await fs.readFile(original))!==baseline.sha256)throw new Error(`Original audio changed: ${name}`);
    const result=spawnSync('/usr/bin/python3',[path.join(root,'tools/compress-sfx.py'),original,path.join(directory,'candidates',name)],
      {encoding:'utf8',env:process.env,timeout:60000});
    if(result.status!==0)throw new Error(`Audio encode failed: ${result.stderr}`);
    const current=await fs.readFile(path.join(assetDir,name)),data=await fs.readFile(path.join(directory,'candidates',name));
    if(data.length>=current.length*0.98)throw new Error(`No audio saving: ${name}`);
    const record={name,...JSON.parse(result.stdout),sha256:hash(data),previous_bytes:current.length,previous_sha256:hash(current),original_sha256:baseline.sha256};
    progress.audio.push(record);await fs.writeFile(progressFile,JSON.stringify(progress,null,2)+'\n');
    console.log(JSON.stringify(record));
  }
  if(!applyChanges){console.log(JSON.stringify({candidates_ready:true,images:progress.records.length,audio:progress.audio.length}));return;}
  const stage=path.join(directory,'stages',report.version);
  if(await exists(stage))throw new Error('Stage backup exists');
  await fs.mkdir(stage,{recursive:true});
  await fs.writeFile(path.join(stage,'report.json'),JSON.stringify(report,null,2)+'\n');
  const edits=[],nextVersion=report.version.replace(/-v(\d+)$/,(_,number)=>`-v${Number(number)+1}`);
  for(const name of ['client-app.js','styles.css','index.html']) {
    const before=await fs.readFile(path.join(root,name),'utf8');
    let after=before.replaceAll(`?v=${report.version}`,`?v=${nextVersion}`);
    for(const audio of progress.audio) {
      const escaped=audio.name.replaceAll('.','\\.');
      after=after.replace(new RegExp(`(\\./assets/${escaped})(?:\\?[^\\s"'\x60)]+)?`,'g'),`$1?v=${nextVersion}`);
    }
    const normalize=text=>text.replace(/(\.\/assets\/[\w.-]+\.mp3)\?[^\s"'`)]+/g,'$1');
    if(normalizeReferences(normalize(before),[])!==normalizeReferences(normalize(after),[]))throw new Error(`Non-resource media edit: ${name}`);
    await fs.writeFile(path.join(stage,name),before);edits.push({name,before,after});
  }
  const changes=[...progress.records.map(record=>({name:record.target,sha256:record.sha256,previous_sha256:rows.find(row=>row.target===record.target).sha256})),...progress.audio];
  for(const record of changes) {
    const data=await fs.readFile(path.join(directory,'candidates',record.name));
    if(hash(data)!==record.sha256)throw new Error(`Candidate changed: ${record.name}`);
    const current=await fs.readFile(path.join(assetDir,record.name));
    if(hash(current)!==record.previous_sha256)throw new Error(`Media changed: ${record.name}`);
    await fs.writeFile(path.join(stage,record.name),current);
  }
  for(const edit of edits)if(await fs.readFile(path.join(root,edit.name),'utf8')!==edit.before)throw new Error('Concurrent source edit');
  for(const record of changes) {
    const target=path.join(assetDir,record.name),temporary=target+'.optimizing';
    await fs.copyFile(path.join(directory,'candidates',record.name),temporary);await fs.rename(temporary,target);
  }
  for(const record of progress.records)report.assets[report.assets.findIndex(row=>row.source===record.source)]=record;
  for(const edit of edits){const file=path.join(root,edit.name);await fs.writeFile(file+'.optimizing',edit.after);await fs.rename(file+'.optimizing',file);}
  report.stage_history=[...(report.stage_history||[]),{version:report.version,totals:report.totals}];
  report.media_refinement={applied_at:new Date().toISOString(),baseline_version:report.version,
    before_bytes:rows.reduce((sum,row)=>sum+row.bytes,0),bytes:progress.records.reduce((sum,row)=>sum+row.bytes,0),
    records:progress.records.map(row=>({target:row.target,previous_bytes:rows.find(old=>old.target===row.target).bytes,bytes:row.bytes,
      minimum_psnr:row.refinement_minimum_psnr,alpha_quantized:!!row.alpha_quantized}))};
  report.audio_refinement={records:progress.audio,before_bytes:progress.audio.reduce((sum,row)=>sum+row.previous_bytes,0),bytes:progress.audio.reduce((sum,row)=>sum+row.bytes,0)};
  report.version=nextVersion;report.refined_quality=60;report.totals=totals(report);
  report.verification=['本轮候选尺寸及质量指标已检查；页面及音效播放验收待完成。','仅本地应用，未部署线上。'];
  await save(directory,report);await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.md'),markdown(report));
  console.log(JSON.stringify({applied:true,version:nextVersion,images:report.media_refinement,audio:report.audio_refinement}));
}

async function smoothBeam(directory) {
  directory=path.resolve(directory);
  const report=JSON.parse(await fs.readFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),'utf8'));
  if(path.resolve(root,report.backup_directory)!==directory||!report.media_refinement)throw new Error('Missing media baseline');
  const row=report.assets.find(row=>row.target==='stage-beam.webp');
  const original=path.join(directory,'original/assets',row.source),output=path.join(directory,'candidates',row.target);
  if(hash(await fs.readFile(original))!==row.original_sha256||hash(await fs.readFile(path.join(assetDir,row.target)))!==row.sha256)throw new Error('Beam source changed');
  const low=await sharp(original).resize({width:96}).png().toBuffer();
  await sharp(low).resize(row.width,row.height).webp({quality:24,alphaQuality:100,effort:6}).toFile(output);
  const data=await fs.readFile(output),comparison=await metrics(original,output,row.source);
  if(data.length>25000)throw new Error('Smooth beam exceeds its size budget');
  const a=await sharp(original).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  const b=await sharp(data).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  let square=0,max=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);square+=delta*delta;max=Math.max(max,delta);}
  const record={...row,...comparison,bytes:data.length,sha256:hash(data),alpha_rmse:Math.sqrt(square/a.length),
    alpha_max_error:max,alpha_resampled:true,visible_pixels_exact:false};
  const stage=path.join(directory,'stages',report.version);
  if(await exists(stage))throw new Error('Stage backup exists');
  await fs.mkdir(stage,{recursive:true});await fs.writeFile(path.join(stage,'report.json'),JSON.stringify(report,null,2)+'\n');
  await fs.copyFile(path.join(assetDir,row.target),path.join(stage,row.target));
  const nextVersion=report.version.replace(/-v(\d+)$/,(_,n)=>`-v${Number(n)+1}`),edits=[];
  for(const name of ['client-app.js','styles.css','index.html']){
    const before=await fs.readFile(path.join(root,name),'utf8'),after=before.replaceAll(`?v=${report.version}`,`?v=${nextVersion}`);
    await fs.writeFile(path.join(stage,name),before);edits.push({name,before,after});
  }
  for(const edit of edits)if(await fs.readFile(path.join(root,edit.name),'utf8')!==edit.before)throw new Error('Concurrent source edit');
  const target=path.join(assetDir,row.target);await fs.copyFile(output,target+'.optimizing');await fs.rename(target+'.optimizing',target);
  for(const edit of edits){const file=path.join(root,edit.name);await fs.writeFile(file+'.optimizing',edit.after);await fs.rename(file+'.optimizing',file);}
  report.stage_history.push({version:report.version,totals:report.totals});
  report.assets[report.assets.findIndex(item=>item.target===row.target)]=record;
  report.media_refinement.bytes+=record.bytes-row.bytes;
  report.media_refinement.records.find(item=>item.target===row.target).bytes=record.bytes;
  report.version=nextVersion;report.totals=totals(report);
  await comparisonImage(original,output,row.source,path.join(directory,'comparisons'));await save(directory,report);
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),JSON.stringify(report,null,2)+'\n');
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.md'),markdown(report));
  console.log(JSON.stringify({version:nextVersion,beam_bytes:record.bytes,source:'original backup',smooth_gradient:true}));
}

const [command,...args]=process.argv.slice(2);
if(command==='prepare') await prepare(args.find(a=>a!=='--samples'),args.includes('--samples'));
else if(command==='apply' && args[0]) await apply(args[0]);
else if(command==='refine-sprites' && args[0]) await refineSprites(args[0],args[1]||78,args.includes('--samples'));
else if(command==='refine-ui' && args[0]) await refineUi(args[0],args.includes('--apply'));
else if(command==='refine-media' && args[0]) await refineMedia(args[0],args.includes('--apply'));
else if(command==='smooth-beam' && args[0]) await smoothBeam(args[0]);
else if(command==='report' && args[0]) {
  const report=JSON.parse(await fs.readFile(path.join(path.resolve(args[0]),'report.json'),'utf8'));
  await fs.writeFile(path.join(root,'docs/IMAGE_OPTIMIZATION.md'),markdown(report));
  console.log(JSON.stringify({version:report.version,...report.totals}));
}
else throw new Error('Usage: SHARP_MODULE=/absolute/path/to/sharp node tools/optimize-images.mjs prepare [--samples] [batch-directory] | apply batch-directory | refine-sprites batch-directory quality [--samples] | refine-ui batch-directory [--apply] | refine-media batch-directory [--apply] | report batch-directory');
