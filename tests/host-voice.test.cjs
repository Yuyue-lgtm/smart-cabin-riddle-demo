const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const test = require("node:test");

const source = fs.readFileSync(require.resolve("../client-app.js"), "utf8")
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, "\n");

function client({ streaming = false, playAfterChunks = 2, playError = null, streamChunks = 3,
  emptyElementBuffer = false, holdFirstAppend = false } = {}) {
  let timerId = 0;
  const timers = new Map(), requests = [], players = [];
  const schedule = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  let appended = 0, reads = 0, resolvePlayback, streamEnded = false, releaseAppend;
  const buffered = { get length() { return appended ? 1 : 0; }, start: () => 0, end: () => appended * 0.4 };
  class MediaSourceFixture extends EventTarget {
    constructor() { super(); this.readyState = 'open'; queueMicrotask(() => this.dispatchEvent(new Event('sourceopen'))); }
    static isTypeSupported() { return true; }
    addSourceBuffer() {
      const buffer = new EventTarget();
      buffer.buffered = buffered;
      buffer.updating = false;
      buffer.appendBuffer = () => {
        buffer.updating = true;
        appended++;
        const complete = () => {
          buffer.updating = false;
          buffer.dispatchEvent(new Event('updateend'));
          if (appended >= playAfterChunks) resolvePlayback?.();
        };
        if (holdFirstAppend && appended === 1) releaseAppend = complete;
        else queueMicrotask(complete);
      };
      return buffer;
    }
    endOfStream() { this.readyState = 'ended'; streamEnded = true; resolvePlayback?.(); }
  }
  const context = vm.createContext({
    structuredClone, console, crypto: webcrypto, AbortController, Blob,
    URL: { createObjectURL: () => "blob:voice-fixture", revokeObjectURL() {} },
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    ...(streaming ? { MediaSource: MediaSourceFixture } : {}),
    window: { setTimeout: schedule, clearTimeout: id => timers.delete(id), ...(streaming ? { MediaSource: MediaSourceFixture } : {}) },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      body: { append() {} },
      createElement() {
        const events = {};
        const audio = { events, plays: 0, paused: true,
          currentTime: 0,
          ...(streaming ? { buffered: emptyElementBuffer ? { length: 0 } : buffered } : {}),
          addEventListener(name, callback) { events[name] = callback; },
          async play() {
            this.plays++;
            this.playedAtChunks = appended;
            if (playError) throw playError;
            if (streaming && !streamEnded && appended < playAfterChunks) await new Promise(resolve => { resolvePlayback = resolve; });
            this.paused = false;
          },
          pause() { this.paused = true; }, removeAttribute() {}, load() {}, remove() {},
        };
        players.push(audio);
        return audio;
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, text: JSON.parse(options.body).text, signal: options.signal });
      return { ok: true, body: streaming ? { getReader: () => ({ async read() {
        if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        reads++;
        return reads <= streamChunks ? { value: new Uint8Array([1, 2]), done: false } : { done: true };
      } }) } : {}, headers: { get: () => "audio/mpeg" },
        blob: async () => new Blob(["fictional-mp3"]) };
    },
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('render=()=>{}; state.game.status="playing"; state.health.hostVoiceConfigured=true; backgroundMusic.enabled=true;');
  return { run, context, requests, players, timers, stream: () => ({ appended, reads }), releaseAppend: () => releaseAppend() };
}

test("stream reads keep feeding MSE while play waits for more audio", { timeout: 1000 }, async () => {
  const app = client({ streaming: true, playAfterChunks: 3 });
  app.run('publishHostLine("虚构流式测试", {priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.deepEqual(app.stream(), { appended: 3, reads: 4 });
  assert.equal(app.players[0].plays, 1);
  assert.equal(app.players[0].playedAtChunks, 2, 'buffer about 0.8 seconds before starting');
  assert.equal(app.run('state.workflow.hostSpeech.voicePlaying'), true);
});

test("a short complete stream ends before awaiting pending playback", { timeout: 1000 }, async () => {
  const app = client({ streaming: true, playAfterChunks: 99, streamChunks: 1 });
  app.run('publishHostLine("虚构短音频测试", {priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.stream().reads, 2);
  assert.equal(app.run('state.workflow.hostSpeech.voicePlaying'), true);
});

test("prebuffer uses SourceBuffer when the media element has not exposed its ranges", async () => {
  const app = client({ streaming: true, emptyElementBuffer: true });
  app.run('publishHostLine("虚构兼容性测试", {priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.players[0].playedAtChunks, 2, 'do not wait for a complete sentence or for audio.buffered');
});

test("a suspended media append is not mistaken for a network idle timeout", { timeout: 1000 }, async () => {
  const app = client({ streaming: true, holdFirstAppend: true });
  app.run('publishHostLine("虚构后台缓冲测试", {priority:"P0"}); simulationRuntime.pause();');
  const pending = app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  for (let index = 0; index < 100; index++) await Promise.resolve();
  assert.equal(app.stream().appended, 1);
  assert.equal([...app.timers.values()].some(timer => timer.delay === 8000 || timer.delay === 20000), false);
  assert.equal(app.requests[0].signal.aborted, false);
  app.releaseAppend();
  for (let index = 0; index < 100; index++) await Promise.resolve();
  assert.equal(app.stream().reads, 4);
  app.run('simulationRuntime.resume()');
  await pending;
  assert.equal(app.run('state.workflow.hostSpeech.voicePlaying'), true);
});

test("simulation pause does not stop draining the audio stream", { timeout: 1000 }, async () => {
  const app = client({ streaming: true });
  app.run('publishHostLine("虚构暂停测试", {priority:"P0"}); simulationRuntime.pause();');
  const pending = app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  for (let index = 0; index < 100; index++) await Promise.resolve();
  assert.equal(app.stream().reads, 4);
  assert.equal(app.players[0].plays, 0);
  assert.equal([...app.timers.values()].some(timer => timer.delay === 8000 || timer.delay === 20000), false);
  app.run('simulationRuntime.resume()');
  await pending;
  assert.equal(app.players[0].plays, 1);
});

test("streaming playback rejection aborts synthesis without leaving a speech wait gate", { timeout: 1000 }, async () => {
  const app = client({ streaming: true, playError: new DOMException('Blocked', 'NotAllowedError') });
  app.run('publishHostLine("虚构拦截测试", {priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.requests[0].signal.aborted, true);
  assert.equal(app.run('state.workflow.hostSpeech.voicePlaying || state.workflow.hostSpeech.voicePending'), false);
});

test("first audio gets a separate twenty-second budget rather than the stream idle budget", async () => {
  const app = client();
  let finishFetch;
  app.context.fetch = () => new Promise(resolve => { finishFetch = resolve; });
  app.run('publishHostLine("虚构首包等待测试", {priority:"P0"});');
  const pending = app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal([...app.timers.values()].some(timer => timer.delay === 20000), true);
  assert.equal([...app.timers.values()].some(timer => timer.delay === 8000), false);
  finishFetch({ ok: false, status: 502, headers: { get: () => null } });
  await pending;
});

test("local P0 reveals, summary and safety lines use the same once-only voice path as model replies", async () => {
  for (const source of ["victory", "question_timeout", "game_summary", "hard_brake", "temporary_interruption", "game_control", "chat"]) {
    const app = client();
    app.run(`publishHostLine("虚构测试话术", {priority:"P0", source:${JSON.stringify(source)}});`);
    await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id, state.host.text)');
    await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id, state.host.text)');
    assert.equal(app.requests.length, 1, source);
    assert.equal(app.requests[0].url, "/api/tts");
    assert.equal(app.run('state.workflow.hostSpeech.voicePlaying'), true);
    app.players[0].events.ended();
    assert.equal(app.run('isHostBusy()'), false);
  }
});

test("speech motion stops at audio end even while its bubble remains visible", async () => {
  const app = client();
  app.run('publishHostLine("音频结束后保留文字",{priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'speak');
  app.players[0].events.ended();
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'), true);
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'normal');
  app.run('publishHostLine("下一句仍可以说话",{priority:"P0"});');
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'speak');
  app.players[0].events.ended();
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'speak');
});

test("synthesis failure stops speech motion without removing its text", async () => {
  const app = client();
  app.context.fetch = async () => ({ok:false,status:502,headers:{get:()=>null}});
  app.run('publishHostLine("失败时仍展示这句文字",{priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.run('getHostPresentation().mediaHostState'), 'normal');
  assert.equal(app.run('getHostPresentation().hostSpeechVisible'), true);
});

test("starting the game cancels welcome audio so it cannot block game initialization", async () => {
  const app=client();
  app.run('state.game.status="idle"; state.timeline.status="idle"; publishHostLine("欢迎话术",{priority:"P0",source:"ready_welcome"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  app.run('startRoundGoldenTimeline=async()=>{globalThis.gameStarted=!isHostBusy();};');
  await app.run('startGoldenTimeline()');
  assert.equal(app.run('gameStarted'),true);
  assert.equal(app.players[0].paused,true);
  assert.equal(app.run('state.host.text'),'');
});

test("client voice diagnostics correlate stages without sending the spoken text", async () => {
  const app = client();
  const diagnostics=[];
  const originalFetch=app.context.fetch;
  app.context.fetch = async (url, options) => {
    if (url === '/api/client-diagnostic') {
      diagnostics.push(JSON.parse(options.body)); return {ok:true};
    }
    return originalFetch(url, options);
  };
  app.run('clientRuntimeDiagnostic.enabled=true; publishHostLine("private spoken text",{priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  app.players[0].events.ended();
  assert.deepEqual(diagnostics.map(row=>row.stage), ['requested','response','playing','ended']);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private spoken text/);
  assert.equal(diagnostics[0].sound_enabled,true);
});

test("voice buffering diagnostics record metrics, limit events and ignore simulation pauses", async () => {
  const app = client();
  const diagnostics = [];
  const originalFetch = app.context.fetch;
  app.context.fetch = async (url, options) => {
    if (url === '/api/client-diagnostic') { diagnostics.push(JSON.parse(options.body)); return {ok:true}; }
    return originalFetch(url, options);
  };
  app.run('clientRuntimeDiagnostic.enabled=true; publishHostLine("private speech",{priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  const audio = app.players[0];
  audio.currentTime = 1;
  audio.readyState = 2;
  audio.buffered = { length: 1, start: () => 0, end: () => 1.25 };
  audio.events.waiting();
  audio.events.stalled();
  audio.events.waiting();
  audio.events.waiting();
  const buffering = diagnostics.filter(row => ['waiting', 'stalled'].includes(row.stage));
  assert.equal(buffering.length, 3);
  assert.equal(buffering[0].buffered_ahead_ms, 250);
  assert.equal(buffering[0].audio_chunk_count, 1);
  assert.ok(buffering[0].audio_bytes > 0);
  app.run('simulationRuntime.pause()');
  audio.events.stalled();
  app.run('simulationRuntime.resume()');
  audio.events.ended();
  assert.equal(diagnostics.at(-1).waiting_count, 3);
  assert.equal(diagnostics.at(-1).stalled_count, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private speech/);
});

test("a visible line can start voice when health configuration arrives after its first render", async () => {
  const app = client();
  app.run('publishHostLine("虚构测试话术", {priority:"P2",source:"environment"}); state.health.hostVoiceConfigured=false;');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.requests.length, 0);
  assert.equal(app.run('state.workflow.hostSpeech.voiceRequested'), false);
  app.run('state.health.hostVoiceConfigured=true;');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.requests.length, 1);
});

test("the shared sound toggle skips synthesis while muted and does not replay old lines when enabled", async () => {
  const app = client();
  app.run('setBackgroundMusicEnabled(false); publishHostLine("静音时的测试话术",{priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.requests.length, 0);
  assert.equal(app.run('isHostBusy()'), false);
  app.run('setBackgroundMusicEnabled(true);');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.requests.length, 0);
  app.run('publishHostLine("开启后的新话术",{priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].text, "开启后的新话术");
});

test("enabling sound on the ready screen does not replay the greeting animation or old welcome line", async () => {
  const app = client();
  app.run('state.game.status="idle"; state.timeline.status="idle"; hostSceneMotion.mode="ready"; hostSceneMotion.completed=true; hostSprite.source=RESOURCE_CONFIG.host.greeting.src; hostSprite.loadId=7; publishHostLine("已经说完的欢迎话术",{priority:"P2",source:"ready_welcome"});');
  const speechId = app.run('state.workflow.hostSpeech.id');

  app.run('setBackgroundMusicEnabled(true);');

  assert.equal(app.run('hostSceneMotion.completed'), true);
  assert.equal(app.run('hostSprite.source'), app.run('RESOURCE_CONFIG.host.greeting.src'));
  assert.equal(app.run('hostSprite.loadId'), 7);
  assert.equal(app.run('state.workflow.hostSpeech.id'), speechId);
  assert.equal(app.run('state.workflow.hostSpeech.source'), "ready_welcome");
  assert.equal(app.requests.length, 0);
});

test("turning shared sound off cancels pending synthesis and prevents its late audio from playing", async () => {
  const app = client();
  let release, entered, signal;
  const ready = new Promise(resolve => { entered = resolve; });
  app.context.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, body: {}, headers: { get: () => "audio/mpeg" },
      blob: () => new Promise(resolve => { release = resolve; entered(); }) };
  };
  app.run('publishHostLine("正在合成的测试话术",{priority:"P0"});');
  const pending = app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  await ready;
  app.run('setBackgroundMusicEnabled(false);');
  assert.equal(signal.aborted, true);
  assert.equal(app.run('isHostBusy()'), false);
  release(new Blob(["cancelled-audio"]));
  await pending;
  assert.equal(app.players.reduce((sum, player) => sum + player.plays, 0), 0);
  assert.equal(app.run('state.host.text'), "正在合成的测试话术");
});

test("turning shared sound off stops active playback and clears the voice wait gate", async () => {
  const app = client();
  app.run('publishHostLine("正在播放的测试话术",{priority:"P0"});');
  await app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  assert.equal(app.players[0].paused, false);
  app.run('setBackgroundMusicEnabled(false);');
  assert.equal(app.players[0].paused, true);
  assert.equal(app.run('hostVoicePlayback.audio'), null);
  assert.equal(app.run('isHostBusy()'), false);
  assert.equal(app.run('state.host.text'), "正在播放的测试话术");
});

test("P0 cancels old synthesis and a late old audio blob cannot play or overwrite new speech state", async () => {
  const app = client();
  let release, signal, entered;
  const blobReady = new Promise(resolve => { entered = resolve; });
  app.context.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, body: {}, headers: { get: () => "audio/mpeg" },
      blob: () => new Promise(resolve => { release = resolve; entered(); }) };
  };
  app.run('publishHostLine("旧的测试话术",{priority:"P2"});');
  const pending = app.run('startHostVoiceSpeech(state.workflow.hostSpeech.id,state.host.text)');
  await blobReady;
  app.run('publishHostLine("新的安全话术",{priority:"P0",source:"hard_brake"});');
  assert.equal(signal.aborted, true);
  release(new Blob(["old-audio"]));
  await pending;
  assert.equal(app.players.reduce((sum, audio) => sum + audio.plays, 0), 0);
  assert.equal(app.run('state.host.text'), "新的安全话术");
  assert.equal(app.run('state.workflow.hostSpeech.voicePending'), false);
});

for (const [status, advance] of [["victory", "advanceAfterVictory"], ["failed", "advanceAfterTimeout"]]) {
  test(`${status} waits for local voice completion before finishing the final round`, () => {
    const app = client();
    app.run(`logRoundAdvanceDiagnostic=()=>{}; finishGameSeries=()=>{state.game.status="summary";};
      state.game.status=${JSON.stringify(status)}; state.game.roundIndex=state.game.totalRounds;
      state.workflow.hostSpeech.voicePending=true;`);
    app.run(`${advance}(state.game.roundIndex)`);
    assert.equal(app.run('state.game.status'), status);
    app.run(`state.workflow.hostSpeech.voicePending=false; state.workflow.hostSpeech.voicePlaying=true;
      ${advance}(state.game.roundIndex);`);
    assert.equal(app.run('state.game.status'), status);
    app.run(`state.workflow.hostSpeech.voicePlaying=false; ${advance}(state.game.roundIndex);`);
    assert.equal(app.run('state.game.status'), "summary");
  });
}
