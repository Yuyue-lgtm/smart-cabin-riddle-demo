const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const source = fs.readFileSync('client-app.js', 'utf8')
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, '\n');

function client(storage = new Map()) {
  let now = 100000, id = 0;
  const tasks = new Map();
  const schedule = (callback, delay = 0) => {
    tasks.set(++id, { callback, at: now + delay }); return id;
  };
  const context = vm.createContext({ structuredClone, console, crypto: webcrypto, URL,
    Date: class extends Date { static now() { return now; } },
    setTimeout: schedule, clearTimeout: id => tasks.delete(id),
    requestAnimationFrame: callback => schedule(callback, 16), cancelAnimationFrame: id => tasks.delete(id),
    window: { setTimeout: schedule, clearTimeout: id => tasks.delete(id) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    document: { baseURI: 'http://localhost/' },
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('render=()=>{}; drawHostSpriteFrame=()=>{};');
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...tasks.entries()].sort((a,b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at; tasks.delete(next[0]); next[1].callback(now);
    }
    now = end;
  }
  return { context, run, advance };
}

test('imported JSON uses canonical files and valid uniform frame coordinates', () => {
  const app = client();
  for (const [name, state, count, rows] of [['hi','greeting',60,10], ['host-ready-normal','readyNormal',40,7],
    ['host-ready-speak','readySpeak',34,6], ['host-cheer','celebration',60,10]]) {
    const meta = JSON.parse(fs.readFileSync(`assets/${name}.json`, 'utf8'));
    assert.equal(meta.meta.image, `${name}.webp`);
    if (['hi', 'host-cheer'].includes(name)) assert.equal(meta.audio.src, name === 'hi' ? 'hi-audio.mp3' : `${name}.mp3`);
    else assert.equal(meta.audio, undefined);
    assert.equal(meta.meta.frameCount, count);
    assert.equal(meta.meta.fps, 10);
    assert.deepEqual(meta.meta.size, { w: 4320, h: rows * 720 });
    const frames = Object.values(meta.frames);
    assert.equal(frames.length, count);
    for (const [index, entry] of frames.entries()) {
      assert.deepEqual(entry.frame, {x: index % 6 * 720, y: Math.floor(index / 6) * 720, w:720, h:720});
      assert.equal(entry.duration, 100);
      assert.ok(entry.frame.y + entry.frame.h <= meta.meta.size.h);
    }
    assert.equal(app.run(`RESOURCE_CONFIG.host.${state}.frameCount`), count);
    assert.equal(app.run(`RESOURCE_CONFIG.host.${state}.playVictorySound`), false);
  }
});

test('ready greeting plays once before its welcome, while summary keeps its existing transitions', () => {
  const app = client();
  for (const [mode, motion, duration] of [['ready','greeting',6000], ['summary','celebration',6000]]) {
    app.run(`clearHostSpeechLock(); state.host.text=''; state.game.status='${mode === 'ready' ? 'idle' : 'summary'}'; hostSceneMotion.mode='${mode}'; hostSceneMotion.completed=false;`);
    assert.equal(app.run(`resolveHostMedia('${mode}','normal').src`).split('?')[0], mode === 'ready' ? './assets/hi.webp' : './assets/host-cheer.webp');
    app.run(`hostSprite.source=RESOURCE_CONFIG.host.${motion}.src; hostSprite.playing=true;
      hostSprite.loop=false;
      hostSprite.totalDurationMs=${duration}; hostSprite.elapsedMs=${duration}; stepHostSprite(1000);`);
    if (mode === 'ready') {
      assert.equal(app.run('hostSceneMotion.completed'), true);
      assert.equal(app.run('hostSprite.playing'), false);
      assert.equal(app.run('state.workflow.hostSpeech.source'), 'ready_welcome');
      assert.equal(app.run('getHostPresentation().hostSpeechVisible'), true);
      assert.equal(app.run('state.host.text'), app.run('getPrestartHostText(getActiveGoldenLine())'));
      assert.equal(app.run('resolveHostMedia("ready","normal").src').split('?')[0], './assets/host-ready-normal.webp');
      assert.equal(app.run('resolveHostMedia("ready","speak").src').split('?')[0], './assets/host-ready-speak.webp');
      const speech = app.run('state.workflow.hostSpeech.id');
      app.run('finishHostSceneMotion()');
      assert.equal(app.run('state.workflow.hostSpeech.id'), speech);
      app.run('resetHostSprite();');
      continue;
    }
    assert.equal(app.run('hostSceneMotion.completed'), true);
    assert.equal(app.run(`resolveHostMedia('${mode}','normal').src`).split('?')[0], './assets/host-normal.webp');
    if (mode === 'summary') assert.equal(app.run(`resolveHostMedia('summary','speak').src`).split('?')[0], './assets/host-speak.webp');
  }
});

test('scene MP3 plays by default even when music and synthesized host voice are off', async () => {
  const app = client();
  let plays = 0;
  app.context.Audio = class { play() { plays++; return Promise.resolve(); } pause() {} addEventListener() {} };
  assert.equal(app.run('backgroundMusic.enabled'), false);
  assert.equal(await app.run('playHostSpriteAudio(RESOURCE_CONFIG.host.greeting.audio)'), true);
  app.advance(1000);
  assert.equal(plays, 1);
});

test('sound onboarding shows two seconds after ready entry without waiting for greeting or welcome', () => {
  const app = client();
  app.run(`els.soundOnboarding={hidden:true}; hostSceneMotion.mode='ready'; hostSceneMotion.completed=false;
    resetSoundOnboardingEntry(); scheduleSoundOnboarding();`);
  app.advance(1999);
  assert.equal(app.run('els.soundOnboarding.hidden'), true);
  app.advance(1);
  assert.equal(app.run('els.soundOnboarding.hidden'), false);
  app.run(`hostSceneMotion.completed=true;
    publishHostLine('欢迎一起猜谜',{source:'ready_welcome',priority:'P0'});
    setHostVoiceState(state.workflow.hostSpeech.id,{pending:false,playing:false});
    scheduleSoundOnboarding();`);
  app.advance(1000);
  assert.equal(app.run('els.soundOnboarding.hidden'), false);
});

test('sound onboarding rechecks scene, sound and dismissal before showing', () => {
  for (const change of ['state.game.status="playing"', 'backgroundMusic.enabled=true',
    'localStorage.getItem=()=>"2"', 'dismissSoundOnboarding()']) {
    const app = client();
    app.run(`els.soundOnboarding={hidden:true}; hostSceneMotion.mode='ready'; hostSceneMotion.completed=true;
      scheduleSoundOnboarding(); ${change};`);
    app.advance(2000);
    assert.equal(app.run('els.soundOnboarding.hidden'), true, change);
  }
});

test('onboarding redraws do not restart its two-second entry timer and a new entry resets it', () => {
  const app=client();
  app.run('els.soundOnboarding={hidden:true}; resetSoundOnboardingEntry(); scheduleSoundOnboarding();');
  app.advance(1500);app.run('scheduleSoundOnboarding();');app.advance(499);
  assert.equal(app.run('els.soundOnboarding.hidden'),true);
  app.advance(1);assert.equal(app.run('els.soundOnboarding.hidden'),false);
  app.run('resetSoundOnboardingEntry(); scheduleSoundOnboarding();');app.advance(1000);
  app.run('resetSoundOnboardingEntry(); scheduleSoundOnboarding();');app.advance(1999);
  assert.equal(app.run('els.soundOnboarding.hidden'),true);
  app.advance(1);assert.equal(app.run('els.soundOnboarding.hidden'),false);
  assert.equal(app.run('getSoundOnboardingShowCount()'),2);
});

test('ready host moves right and only ready bubble receives the vertical offset after text fitting', () => {
  const app = client();
  assert.match(fs.readFileSync('styles.css','utf8'), /\.game-screen\.screen-ready \.host-avatar\s*\{\s*left:\s*813px;\s*top:\s*251px;\s*width:\s*556px;\s*height:\s*556px;/);
  app.run(`document.createRange=()=>({selectNodeContents(){},getClientRects:()=>[{top:0},{top:52}]});
    globalThis.getComputedStyle=()=>({lineHeight:'52px'});
    globalThis.bubble={style:{},dataset:{baseTop:'155px'}};
    globalThis.options={maxHeight:167,minHeight:100,paddingY:48,anchorLines:2,anchorLineHeight:52};
    fitBubbleHeight(bubble,{},options);`);
  const original = Number.parseFloat(app.run('bubble.style.top'));
  app.run('fitBubbleHeight(bubble,{}, {...options,anchorOffsetY:-30});');
  assert.equal(Number.parseFloat(app.run('bubble.style.top')), original - 30);
  app.run('fitBubbleHeight(bubble,{},options);');
  assert.equal(Number.parseFloat(app.run('bubble.style.top')), original);
  assert.match(fs.readFileSync('styles.css','utf8'), /\.game-screen\.screen-ready \.host-bubble\s*\{\s*box-shadow:\s*0 4px 10px rgba\(0, 0, 0, 0\.18\), 0 14px 32px rgba\(0, 0, 0, 0\.28\);/);
});

test('sound onboarding counts real displays across reloads and stops after two', () => {
  const storage = new Map([['smart-cabin-sound-onboarding-dismissed-v2', '1']]);
  const key = 'smart-cabin-sound-onboarding-show-count-v3';
  for (let visit = 1; visit <= 3; visit++) {
    const app = client(storage);
    app.run(`els.soundOnboarding={hidden:true}; hostSceneMotion.mode='ready'; hostSceneMotion.completed=true;
      scheduleSoundOnboarding(); scheduleSoundOnboarding();`);
    app.advance(2000);
    assert.equal(app.run('els.soundOnboarding.hidden'), visit > 2);
    assert.equal(storage.get(key), String(Math.min(visit, 2)));
    app.run('scheduleSoundOnboarding(); dismissSoundOnboarding(); scheduleSoundOnboarding();');
    app.advance(2000);
    assert.equal(app.run('els.soundOnboarding.hidden'), true);
    assert.equal(storage.get(key), String(Math.min(visit, 2)));
  }
});

test('reset can show the second onboarding but redraws and enabled sound do not inflate its count', () => {
  const app = client();
  app.run(`els.soundOnboarding={hidden:true}; hostSceneMotion.mode='ready'; hostSceneMotion.completed=true;
    backgroundMusic.enabled=true; scheduleSoundOnboarding();`);
  app.advance(1);
  assert.equal(app.run('getSoundOnboardingShowCount()'), 0);
  app.run('backgroundMusic.enabled=false; scheduleSoundOnboarding();');
  app.advance(2000);
  app.run('hideSoundOnboarding(); scheduleSoundOnboarding();');
  app.advance(2000);
  assert.equal(app.run('getSoundOnboardingShowCount()'), 1);
  app.run('resetSoundOnboardingEntry(); scheduleSoundOnboarding();');
  app.advance(2000);
  assert.equal(app.run('getSoundOnboardingShowCount()'), 2);
  app.run('resetSoundOnboardingEntry(); scheduleSoundOnboarding();');
  app.advance(2000);
  assert.equal(app.run('els.soundOnboarding.hidden'), true);
});

test('retired puzzled state falls back to the normal host animation', () => {
  const app = client();
  assert.equal(app.run('resolveHostMedia("playing","awkward") === RESOURCE_CONFIG.host.normal'), true);
  assert.equal(app.run('resolveHostMedia("playing","尴尬") === RESOURCE_CONFIG.host.normal'), true);
});

test('heart motion follows smile emotion aliases for one non-looping cycle and a four-second transient', () => {
  const app = client();
  app.run('state.game.status="playing";');
  for (const emotion of ['smile', 'smiling', 'happy', 'laugh', 'comfort', 'confident', 'observing', '微笑', '笑']) {
    app.run(`applyHostAvatarState({}, {host_emotion:${JSON.stringify(emotion)}}, false);`);
    assert.equal(app.run('state.host.avatarState'), 'smile', emotion);
    assert.equal(app.run('resolveHostMedia("playing",getHostPresentation().mediaHostState).src').split('?')[0], './assets/host-heart.webp', emotion);
  }
  assert.equal(app.run('RESOURCE_CONFIG.host.smile.loop'), false);
  assert.equal(app.run('RESOURCE_CONFIG.host.smile.frameCount * HOST_SPRITE_FRAME_DURATION_MS'), 2700);
  app.advance(3999);
  assert.equal(app.run('state.host.avatarState'), 'smile');
  app.advance(1);
  assert.equal(app.run('state.host.avatarState'), 'normal');
  app.run('applyHostAvatarState({}, {host_emotion:"smile"}, true);');
  assert.equal(app.run('resolveHostMedia("reveal", state.host.avatarState).src').split('?')[0], './assets/host-yes.webp');
  app.run('hostSceneMotion.completed=true; applyHostAvatarState({}, {host_emotion:"smile"}, false);');
  assert.equal(app.run('resolveHostMedia("ready", state.host.avatarState).src').split('?')[0], './assets/host-ready-normal.webp');
});

test('storage failures preserve the two-display limit within the current page', () => {
  const app = client();
  app.run(`localStorage.getItem=()=>{throw new Error('blocked');};
    localStorage.setItem=()=>{throw new Error('blocked');};
    els.soundOnboarding={hidden:true}; hostSceneMotion.mode='ready'; hostSceneMotion.completed=true;`);
  for (let visit = 1; visit <= 3; visit++) {
    app.run('resetSoundOnboardingEntry(); scheduleSoundOnboarding();');
    app.advance(2000);
    assert.equal(app.run('els.soundOnboarding.hidden'), visit > 2);
  }
});

test('ready page shows only its own welcome after greeting and syncs speech motion to playback', () => {
  const app = client();
  app.run(`hostSceneMotion.mode='ready'; hostSceneMotion.completed=false;
    hostSprite.source=RESOURCE_CONFIG.host.greeting.src; hostSprite.playing=true;
    hostSprite.totalDurationMs=4000; hostSprite.elapsedMs=0;`);
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'),false);
  app.run('hostSceneMotion.completed=true; state.host.text="旧话术";');
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'),false);
  app.run('publishHostLine("准备页欢迎语",{source:"ready_welcome",priority:"P0"}); state.health.hostVoiceConfigured=true; backgroundMusic.enabled=true;');
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'), true);
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'normal');
  app.run('setHostVoiceState(state.workflow.hostSpeech.id,{pending:false,playing:true})');
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'speak');
  app.run('setHostVoiceState(state.workflow.hostSpeech.id,{pending:false,playing:false})');
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'normal');
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'), true);
  assert.equal(app.run('resolveHostMedia("playing","speak").src').split('?')[0], './assets/host-speak.webp');
});

test('failed hi image advances to welcome after a bounded fallback, but not after leaving ready', async () => {
  for(const leave of [false,true]) {
    const app = client();
    app.run(`hostSceneMotion.mode='ready'; hostSceneMotion.completed=false;
      els.hostCanvas={}; els.hostImage={};
      loadReadyHostMedia=async()=>{throw new Error('fixture missing image');};
      playHostSpriteAudio=async()=>false;`);
    await app.run('loadHostSprite(RESOURCE_CONFIG.host.greeting)');
    app.advance(5999);
    assert.equal(app.run('state.workflow.hostSpeech.source'),'');
    if(leave) app.run('state.game.status="playing"; resetHostSprite();');
    app.advance(1);
    assert.equal(app.run('state.workflow.hostSpeech.source'),leave ? '' : 'ready_welcome');
  }
});

test('all ready sprites and metadata plus greeting audio are preloaded and cached before entry', async () => {
  const app = client();
  const requests = [];
  app.context.fetch = async url => {
    requests.push(url);
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(url.split('?')[0].replace('./',''), 'utf8')),
      arrayBuffer: async () => new ArrayBuffer(1) };
  };
  app.run(`loadHostSpriteImage=async src=>({width:4320,height:src.includes('ready-normal')?5040:src.includes('ready-speak')?4320:7200,decode:async()=>{}});`);
  assert.equal(app.run('createReadyHostPreloadTasks().length'), 4);
  await app.run('Promise.all(createReadyHostPreloadTasks().map(task=>task.load()))');
  assert.equal(requests.length, 4);
  for (const name of ['greeting','readyNormal','readySpeak']) {
    await app.run(`loadReadyHostMedia(RESOURCE_CONFIG.host.${name})`);
    assert.equal(app.run(`createHostSpriteFrames(RESOURCE_CONFIG.host.${name}).length`), app.run(`RESOURCE_CONFIG.host.${name}.frameCount`));
  }
  assert.equal(requests.length, 4);
});

test('every current golden line has a welcome matching the editable script', () => {
  const app = client();
  const document = fs.readFileSync('docs/GOLDEN_EXPERIENCE_LINES_V2_DRAFT.md','utf8');
  const lines = JSON.parse(app.run('JSON.stringify(GOLDEN_TIMELINES)'));
  for (const line of lines) {
    assert.ok(line.welcomeText && document.includes(line.welcomeText));
    assert.ok(line.welcomeText.length <= 35);
  }
});

test('invalid ready sprite metadata fails preload and can be retried without keeping a poisoned cache', async () => {
  const app = client();
  let attempts = 0;
  app.context.fetch = async () => ({ ok: true, json: async () => {
    const value = JSON.parse(fs.readFileSync('assets/host-ready-normal.json','utf8'));
    if (++attempts === 1) value.frames['frame_000.png'].frame.x = 9000;
    return value;
  } });
  app.run('loadHostSpriteImage=async()=>({width:4320,height:5040,decode:async()=>{}});');
  await assert.rejects(app.run('loadReadyHostMedia(RESOURCE_CONFIG.host.readyNormal)'), /does not match/);
  await app.run('loadReadyHostMedia(RESOURCE_CONFIG.host.readyNormal)');
  assert.equal(attempts, 2);
  assert.equal(app.run('RESOURCE_CONFIG.host.readyNormal.frames.length'),40);
});

test('late MP3 decode cannot play after a scene change or explicit cancellation', async () => {
  for (const cancel of ['resetHostSprite()', 'stopHostSpriteAudio()']) {
    const app = client();
    let release, starts = 0;
    app.context.fakeContext = { state:'running', currentTime:0,
      decodeAudioData: () => new Promise(resolve => { release = resolve; }),
      createBufferSource() { starts++; throw new Error('Stale audio must not play'); },
    };
    app.context.fetch = async () => ({ ok:true, arrayBuffer:async () => new ArrayBuffer(1) });
    app.run('backgroundMusic.enabled=true; prepareAudioContext=()=>fakeContext;');
    const playing = app.run('playHostSpriteAudio(RESOURCE_CONFIG.host.celebration.audio)');
    while (!release) await Promise.resolve();
    app.run(cancel);
    release({ duration: 3 });
    assert.equal(await playing, false);
    assert.equal(starts, 0);
  }
});

test('a music toggle during MP3 decode does not cancel animation sound', async () => {
  const app = client();
  let release, starts = 0;
  app.context.fakeContext = { state:'running', currentTime:0, destination:{},
    decodeAudioData: () => new Promise(resolve => { release = resolve; }),
    createBufferSource: () => ({ connect() {}, start() { starts++; }, addEventListener() {} }),
    createGain: () => ({ gain:{setValueAtTime(){}}, connect(){} }),
  };
  app.context.fetch = async () => ({ ok:true, arrayBuffer:async () => new ArrayBuffer(1) });
  app.run('prepareAudioContext=()=>fakeContext; cancelHostVoiceSpeech=()=>{}; refreshHostSpeechMedia=()=>{};');
  const playing = app.run('playHostSpriteAudio(RESOURCE_CONFIG.host.celebration.audio)');
  while (!release) await Promise.resolve();
  app.run('setBackgroundMusicEnabled(true); setBackgroundMusicEnabled(false);');
  release({ duration:3 });
  assert.equal(await playing, true);
  assert.equal(starts, 1);
});

test('autoplay-blocked sound retries only the current animation and resumes at its current frame', async () => {
  const app = client();
  let plays = 0;
  app.context.Audio = class { duration=5; play() { plays++; return plays === 1
    ? Promise.reject(Object.assign(new Error('gesture required'), {name:'NotAllowedError'})) : Promise.resolve(); }
    pause() {} addEventListener() {} };
  app.run('hostSprite.playing=true; hostSprite.audio=RESOURCE_CONFIG.host.greeting.audio; playHostSpriteAudioElement(hostSprite.audio);');
  app.advance(1000); await Promise.resolve();
  app.run('hostSprite.elapsedMs=1500; retryHostSpriteAudio(); retryHostSpriteAudio();');
  assert.equal(plays, 2);
  assert.equal(app.run('hostSprite.audioElement.currentTime'), 1.5);
  app.run('hostSprite.audioElement.spriteNeedsGesture=true; resetHostSprite(); retryHostSpriteAudio();');
  assert.equal(plays, 2);
});

test('delayed media fallback is cancelled when its scene is replaced', () => {
  const app = client();
  let plays = 0;
  app.context.Audio = class { play() { plays++; return Promise.resolve(); } pause() {} addEventListener() {} };
  app.run('backgroundMusic.enabled=true; playHostSpriteAudioElement({...RESOURCE_CONFIG.host.celebration.audio,delayMs:180}); resetHostSprite();');
  app.advance(300);
  assert.equal(plays, 0);
});

test('event pill stays for ten simulation seconds and pauses its remaining time', () => {
  const app = client();
  app.run('showImportantEvent("舱内出现笑声");');
  app.advance(9999);
  assert.equal(app.run('state.ui.importantEvent.phase'), 'visible');
  app.run('simulationRuntime.pause();'); app.advance(60000);
  assert.equal(app.run('state.ui.importantEvent.phase'), 'visible');
  app.run('simulationRuntime.resume();'); app.advance(1);
  assert.equal(app.run('state.ui.importantEvent.phase'), 'hiding');
  app.advance(320);
  assert.equal(app.run('state.ui.importantEvent.phase'), 'hidden');
  assert.match(fs.readFileSync('styles.css','utf8'), /\.cabin-region \.important-event\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.3\);/s);
});
