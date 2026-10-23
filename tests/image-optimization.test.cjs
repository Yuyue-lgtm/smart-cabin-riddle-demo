const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {test}=require('node:test');
const root=path.resolve(__dirname,'..');
const report=JSON.parse(fs.readFileSync(path.join(root,'docs/IMAGE_OPTIMIZATION.json'),'utf8'));
const bytes=name=>fs.readFileSync(path.join(root,'assets',name));
const hash=value=>createHash('sha256').update(value).digest('hex');

test('all images have verified optimization records and the published bytes match',()=>{
  const images=fs.readdirSync(path.join(root,'assets')).filter(name=>/\.(png|webp|svg)$/.test(name)).sort();
  assert.deepEqual(report.assets.map(row=>row.target).sort(),images);
  assert.equal(new Set(report.assets.map(row=>row.target)).size,report.assets.length);
  for(const row of report.assets){
    const buffer=bytes(row.target);
    assert.equal(buffer.length,row.bytes,row.target);assert.equal(hash(buffer),row.sha256,row.target);
    if(row.status==='optimized'){
      assert.ok(row.bytes<row.original_bytes,row.target);
      if(row.alpha_quantized&&report.media_refinement?.records.some(item=>item.target===row.target)){
        assert.ok(['figma-ready-panel-mosaic.webp','stage-beam.webp','game-icon-loading.png'].includes(row.target));
        assert.ok(Number.isFinite(row.alpha_rmse));
      }else assert.equal(row.alpha_exact,true,row.target);
      if(row.source!==row.target)assert.equal(fs.existsSync(path.join(root,'assets',row.source)),false,row.source);
    }
  }
  assert.ok(report.totals.bytes<report.totals.original_bytes);
});

test('cabin backgrounds use the approved low-quality profile without resizing',()=>{
  const rows=report.assets.filter(row=>row.profile==='cabin');
  assert.equal(rows.length,9);
  for(const row of rows){
    assert.equal(row.encoding,'webp_q28');assert.equal(row.alpha_exact,true);
    assert.equal(row.height,651);assert.ok([807,810].includes(row.width));
  }
});

test('female young 2 retains all four Figma crops and genuine transparency',()=>{
  const rows=report.assets.filter(row=>row.target.startsWith('passenger-female-young2-'));
  assert.equal(rows.length,4);
  assert.deepEqual(new Set(rows.map(row=>row.target)),new Set(['normal','tired','sleep','laugh'].map(state=>`passenger-female-young2-${state}.webp`)));
  for(const row of rows){
    assert.equal(row.width,287);assert.equal(row.height,328);
    assert.equal(row.alpha_exact,true);assert.equal(row.export_contents_only,true);
    assert.ok(row.transparent_pixels>30000);assert.ok(row.bytes<25000);assert.ok(row.psnr>36.5);
  }
  assert.equal(report.totals.count,report.assets.length);
});

test('sprite sheets keep their original dimensions, frame coordinates, metadata and audio',()=>{
  const sprites=report.assets.filter(row=>row.profile==='sprite');assert.equal(sprites.length,9);
  for(const row of sprites){
    const name=row.source.replace(/\.webp$/,'.json');
    const metadata=JSON.parse(bytes(name));
    assert.equal(hash(bytes(name)),report.inventory.find(r=>r.name===name).sha256,name);
    assert.deepEqual(metadata.meta.size,{w:row.width,h:row.height});
    assert.equal(metadata.meta.image,row.target);
    assert.equal(row.alpha_exact,true);
    assert.ok(row.frame_samples.every(sample=>sample.exact||sample.psnr>=(row.refinement_minimum_psnr||36.5)));
    if(metadata.audio?.src)assert.equal(hash(bytes(metadata.audio.src)),
      report.audio_refinement?.records.find(r=>r.name===metadata.audio.src)?.sha256
      ||report.inventory.find(r=>r.name===metadata.audio.src).sha256);
  }
});

test('UI slices follow the approved per-asset refinement and static fallbacks remain separate',()=>{
  const selected=new Set(['figma-summary-mosaic.webp','figma-ready-panel-mosaic.webp','figma-ready-ring-mosaic.webp',
    'figma-ready-logo.webp','figma-summary-title.webp','figma-summary-bright-light.webp','stage-beam.webp',
    'figma-ready-button.webp','figma-summary-light-ring.webp','cabin-correct-light.webp','figma-summary-mvp.webp']);
  if(report.ui_refinement){
    assert.deepEqual(new Set(report.ui_refinement.records.map(row=>row.target)),selected);
    assert.ok(report.ui_refinement.bytes<report.ui_refinement.before_bytes);
  }
  for(const row of report.assets.filter(row=>row.profile==='ui'&&row.status==='optimized')){
    const media=report.media_refinement?.records.find(item=>item.target===row.target);
    if(media){
      assert.ok(row.bytes<media.previous_bytes);assert.equal(row.bytes,media.bytes);
      assert.ok(row.psnr>=media.minimum_psnr);
      if(!media.alpha_quantized)assert.equal(row.alpha_exact,true);
    }else if(report.ui_refinement&&selected.has(row.target)){
      const record=report.ui_refinement.records.find(item=>item.target===row.target);
      assert.match(row.encoding,/^webp_q\d+$/);assert.equal(row.alpha_exact,true);
      assert.equal(row.quality,record.quality);assert.ok(row.psnr>=record.minimum_psnr);
      assert.ok(row.bytes<record.previous_bytes);assert.equal(row.bytes,record.bytes);
    }else{
      assert.equal(row.encoding,'webp_lossless');assert.equal(row.visible_pixels_exact,true);
    }
  }
  for(const row of report.assets.filter(row=>/^host-.*\.png$/.test(row.source)&&row.status==='optimized')){
    assert.match(row.target,/-static\.webp$/);
    assert.ok(fs.existsSync(path.join(root,'assets',row.source.replace(/\.png$/,'.webp'))));
  }
});

test('favicon stays a transparent 130px PNG and tiny vectors remain byte-identical',()=>{
  const icon=report.assets.find(row=>row.source==='game-icon-loading.png');
  assert.equal(icon.target,'game-icon-loading.png');assert.equal(icon.width,130);assert.equal(icon.height,130);
  if(report.media_refinement){
    assert.equal(icon.encoding,'png_palette_128');assert.ok(icon.psnr>=30);assert.ok(icon.alpha_rmse<=3);
  }else assert.equal(icon.visible_pixels_exact,true);
  assert.equal(bytes(icon.target).subarray(1,4).toString(),'PNG');
  const vectors=report.assets.filter(row=>row.profile==='svg');assert.equal(vectors.length,12);
  for(const row of vectors)assert.equal(row.sha256,row.original_sha256);
});

test('additional media compression meets size budgets and accounts for all three MP3 effects',()=>{
  if(!report.media_refinement)return;
  const record=name=>report.assets.find(row=>row.target===name);
  assert.ok(record('figma-ready-panel-mosaic.webp').bytes<8000);
  assert.equal(record('figma-ready-panel-mosaic.webp').width,128);
  assert.ok(record('stage-beam.webp').bytes<25000);
  for(const row of report.assets.filter(row=>row.target.startsWith('screen-')))assert.ok(row.bytes<120000,row.target);
  const audio=report.audio_refinement.records;
  assert.deepEqual(audio.map(row=>row.name).sort(),['hi-audio.mp3','host-cheer.mp3','host-yes.mp3']);
  for(const row of audio){
    assert.equal(hash(bytes(row.name)),row.sha256);assert.equal(bytes(row.name).length,row.bytes);
    assert.ok(row.bytes<row.previous_bytes);assert.equal(row.bit_rate,64000);assert.ok(row.duration_seconds>0);
  }
  const changed=new Set(audio.map(row=>row.name));
  for(const original of report.inventory.filter(row=>/\.(mp3|json)$/.test(row.name)&&!changed.has(row.name))){
    assert.equal(hash(bytes(original.name)),original.sha256,original.name);
  }
});

test('requested host sprite restoration matches the backed-up 13.75 MiB version byte for byte',()=>{
  if(!report.sprite_restoration)return;
  const restoration=report.sprite_restoration;
  const directory=path.join(root,report.backup_directory,'stages',restoration.from_version);
  const baseline=JSON.parse(fs.readFileSync(path.join(directory,'report.json'),'utf8'));
  const sprites=report.assets.filter(row=>row.profile==='sprite');
  assert.equal(sprites.length,9);assert.equal(sprites.reduce((sum,row)=>sum+row.bytes,0),14422376);
  assert.deepEqual(new Set(restoration.targets),new Set(sprites.map(row=>row.target)));
  for(const row of sprites){
    assert.equal(row.quality,78);
    assert.equal(row.sha256,baseline.assets.find(old=>old.target===row.target).sha256);
    assert.ok(bytes(row.target).equals(fs.readFileSync(path.join(directory,row.target))),row.target);
  }
});

test('new asset URLs and entry files carry the same cache version',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(html.includes(`./client-app.js?v=${report.version}`));
  assert.ok(html.includes(`./styles.css?v=${report.version}`));
  const runtime=['index.html','client-app.js','styles.css'].map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n');
  for(const match of runtime.matchAll(/\.\/assets\/[\w.-]+\.(?:png|webp|svg)\?([^\s"'`)]+)/g)){
    assert.equal(match[1],`v=${report.version}`);
  }
});
