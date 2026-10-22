const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const source = fs.readFileSync('client-app.js', 'utf8')
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, '\n');

function client() {
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
    localStorage: { getItem: () => null, setItem() {} },
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
  for (const [name, state, count, rows] of [['hi','greeting',60,10], ['host-cheer','celebration',60,10]]) {
    const meta = JSON.parse(fs.readFileSync(`assets/${name}.json`, 'utf8'));
    assert.equal(meta.meta.image, `${name}.webp`);
    assert.equal(meta.audio.src, name === 'hi' ? 'hi-audio.mp3' : `${name}.mp3`);
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

test('ready motion keeps looping while summary completes and yields to idle or speech', () => {
  const app = client();
  for (const [mode, motion, duration] of [['ready','greeting',6000], ['summary','celebration',6000]]) {
    app.run(`clearHostSpeechLock(); state.host.text=''; state.game.status='${mode === 'ready' ? 'idle' : 'summary'}'; hostSceneMotion.mode='${mode}'; hostSceneMotion.completed=false;`);
    assert.equal(app.run(`resolveHostMedia('${mode}','normal').src`).split('?')[0], mode === 'ready' ? './assets/hi.webp' : './assets/host-cheer.webp');
    app.run(`hostSprite.source=RESOURCE_CONFIG.host.${motion}.src; hostSprite.playing=true;
      hostSprite.loop=${mode === 'ready'};
      hostSprite.totalDurationMs=${duration}; hostSprite.elapsedMs=${duration}; stepHostSprite(1000);`);
    if (mode === 'ready') {
      assert.equal(app.run('hostSceneMotion.completed'), false);
      assert.equal(app.run('hostSprite.playing'), true);
      assert.equal(app.run('state.workflow.hostSpeech.source'), '');
      assert.equal(app.run('getHostPresentation().hostSpeechVisible'), false);
      app.run('resetHostSprite();');
      continue;
    }
    assert.equal(app.run('hostSceneMotion.completed'), true);
    assert.equal(app.run(`resolveHostMedia('${mode}','normal').src`), './assets/host-normal.webp');
    if (mode === 'summary') assert.equal(app.run(`resolveHostMedia('summary','speak').src`), './assets/host-speak.webp');
  }
});

test('muted scene motion never requests its MP3', async () => {
  const app = client();
  app.context.fetch = () => { throw new Error('Muted audio must not fetch'); };
  assert.equal(await app.run('playHostSpriteAudio(RESOURCE_CONFIG.host.greeting.audio)'), false);
});

test('ready page hides any host bubble and always selects hi even after scene completion', () => {
  const app = client();
  app.run(`hostSceneMotion.mode='ready'; hostSceneMotion.completed=false;
    hostSprite.source=RESOURCE_CONFIG.host.greeting.src; hostSprite.playing=true;
    hostSprite.totalDurationMs=4000; hostSprite.elapsedMs=0;`);
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'),false);
  app.run('hostSceneMotion.completed=true; state.host.text="旧话术";');
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'),false);
  assert.equal(app.run('resolveHostMedia("ready","speak").src').split('?')[0], './assets/hi.webp');
});

test('failed hi image uses a static fallback without publishing welcome speech', async () => {
  for(const leave of [false,true]) {
    const app = client();
    app.run(`hostSceneMotion.mode='ready'; hostSceneMotion.completed=false;
      els.hostCanvas={}; els.hostImage={};
      loadHostSpriteImage=async()=>{throw new Error('fixture missing image');};
      playHostSpriteAudio=async()=>false;`);
    await app.run('loadHostSprite(RESOURCE_CONFIG.host.greeting)');
    app.advance(5999);
    assert.equal(app.run('state.workflow.hostSpeech.source'),'');
    if(leave) app.run('state.game.status="playing"; resetHostSprite();');
    app.advance(1);
    assert.equal(app.run('state.workflow.hostSpeech.source'),'');
  }
});

test('late MP3 decode cannot play after a scene change or mute/unmute', async () => {
  for (const cancel of ['resetHostSprite()', 'stopHostSpriteAudio(); backgroundMusic.enabled=false; backgroundMusic.enabled=true;']) {
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
