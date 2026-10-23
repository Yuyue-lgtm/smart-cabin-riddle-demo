const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const source = fs.readFileSync('client-app.js', 'utf8')
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/, '\n');

function client(storage = new Map()) {
  const context = vm.createContext({ structuredClone, console: { ...console, info() {}, warn() {} },
    crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    window: { setTimeout, clearTimeout },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run('render=()=>{};');
  return { run, context, storage, value: code => JSON.parse(run(`JSON.stringify(${code})`)) };
}

test('runtime includes exactly the approved 53 plus 38, with original IDs, prompts and environment groups', () => {
  execFileSync(process.execPath, ['tools/build-riddle-bank.mjs', '--check']);
  const app = client(), runtime = app.value('RIDDLES');
  const general = JSON.parse(fs.readFileSync('docs/RIDDLE_BANK_53_TAGGED_V1.json', 'utf8')).riddles;
  const environment = JSON.parse(fs.readFileSync('docs/ENVIRONMENT_RIDDLE_BANK_V2.json', 'utf8')).riddles;
  assert.equal(runtime.length, 91);
  assert.equal(new Set(runtime.map(r => r.id)).size, 91);
  assert.equal(new Set(runtime.map(r => r.answer)).size, 91);
  for (const riddle of [...general, ...environment]) {
    const row = runtime.find(row => row.id === riddle.id);
    assert.equal(row.answer, riddle.answer); assert.equal(row.hint, riddle.hint);
  }
  for (const [name, count] of Object.entries({ 雪景: 8, 雨天: 7, 城市白天: 5, 城市夜晚: 5, 风景区: 5, 傍晚: 4, 深夜: 4 })) {
    assert.equal(environment.filter(row => row.environment === name).length, count);
  }
  assert.equal(runtime.find(row => row.answer === '霓虹灯').environmentTags[0], '城市白天');
  assert.equal(runtime.some(row => row.answer === '雷电' || row.answer === '方向盘' || row.answer === '草原'), false);
});

test('six rounds follow difficulty rhythm, unique answers and family/elder challenge limits over many games', () => {
  const app = client();
  const games = app.value(`(() => {
    const games=[];
    for (const relationship of ['父母+小孩','中老年+儿女','年轻朋友']) {
      for (let game=0;game<120;game++) {
        const played=[],rows=[];
        for(let round=1;round<=6;round++) {
          const index=selectRiddleIndex({gameId:relationship+game,roundIndex:round,
            relationship,environment:'风景区雪景白天',destination:'草原',playedIndices:played,
            previousIndex:played.at(-1)??null});
          played.push(index); rows.push(RIDDLES[index]);
        }
        games.push({relationship,rows});
      }
    }
    return games;
  })()`);
  for (const game of games) {
    assert.equal(new Set(game.rows.map(r => r.id)).size, 6);
    assert.deepEqual(game.rows.slice(0, 4).map(r => r.difficulty), ['easy', 'easy', 'medium', 'medium']);
    assert.ok(['easy', 'medium'].includes(game.rows[5].difficulty));
    if (game.relationship !== '年轻朋友') {
      assert.equal(game.rows[4].difficulty, 'medium');
      assert.equal(game.rows.filter(row => row.pool === 'environment').length, 4);
    }
  }
  const friendHard = games.filter(game => game.relationship === '年轻朋友' && game.rows[4].difficulty === 'hard').length;
  assert.ok(friendHard > 45 && friendHard < 105, friendHard);
});

test('weighted selection varies across games and destination relevance increases selection probability', () => {
  const app = client();
  const counts = app.value(`(() => {
    const counts={matched:0,neutral:0,answers:new Set()};
    for(let game=0;game<1000;game++) for(const [label,destination] of [['matched','迪士尼'],['neutral','公司']]) {
      const index=selectRiddleIndex({gameId:'distribution-'+game,roundIndex:1,
        environment:'车库',destination,relationship:'父母+小孩',playedIndices:[]});
      if(RIDDLES[index].answer==='米老鼠') counts[label]++;
      counts.answers.add(RIDDLES[index].id);
    }
    return {...counts,answers:counts.answers.size};
  })()`);
  assert.ok(counts.answers > 15, JSON.stringify(counts));
  assert.ok(counts.matched > counts.neutral * 1.5, JSON.stringify(counts));
});

test('category diversity wins where an eligible alternative exists', () => {
  const app = client();
  app.run(`const allowed=['安全带','猫','狗']; const previous=RIDDLES.findIndex(r=>r.answer==='猫');
    const blocked=RIDDLES.flatMap((r,i)=>allowed.includes(r.answer)?[]:[i]);
    globalThis.result=selectRiddleIndex({gameId:'category',roundIndex:2,environment:'车库',
      playedIndices:blocked,previousIndex:previous});`);
  assert.equal(app.run('RIDDLES[result].answer'), '安全带');
});

test('preview reservation is stable and never writes recent history; actual start writes once and retains only twelve', async () => {
  const app = client();
  app.run('waitForPreloadForeground=async()=>{}; requestPreparedRound=async()=>{};');
  app.run('const source=getScenarioFirstRoundPreparation(GOLDEN_TIMELINES[0]);');
  await app.run('source.promise');
  assert.equal(app.run('getScenarioFirstRoundPreparation(GOLDEN_TIMELINES[0])===source'), true);
  assert.equal(app.run('recentRiddleIds.length'), 0);
  assert.equal(app.storage.has('smart-cabin-riddle-history-v1'), false);
  app.run(`for(let i=0;i<13;i++){
    state.game.roundIndex=i+1;state.game.currentRiddleIndex=i;recordRiddleStarted();recordRiddleStarted();
  }`);
  const ids = app.value('recentRiddleIds');
  assert.equal(ids.length, 12);
  assert.deepEqual(ids, app.value('RIDDLES.slice(1,13).map(r=>r.id)'));
  const refreshed = client(app.storage);
  assert.deepEqual(refreshed.value('recentRiddleIds'), ids);
  assert.equal(app.run('state.game.allocationHistory.length'), 13);
});

test('recent items are avoided, corrupt storage is safe and exhausted matching pools relax without unrelated exclusives', () => {
  const app = client(new Map([['smart-cabin-riddle-history-v1', '{broken']]));
  assert.deepEqual(app.value('recentRiddleIds'), []);
  app.run(`recentRiddleIds=RIDDLES.filter(r=>r.pool==='general'&&r.difficulty==='easy').slice(0,12).map(r=>r.id);`);
  for(let game=0;game<50;game++) {
    const id=app.run(`RIDDLES[selectRiddleIndex({gameId:'fresh-${game}',roundIndex:1,environment:'隧道',playedIndices:[]})].id`);
    assert.equal(app.value('recentRiddleIds').includes(id), false);
  }
  app.run(`const last=RIDDLES.findIndex(r=>r.id==='R006');
    const blocked=RIDDLES.map((r,i)=>i).filter(i=>i!==last);
    recentRiddleIds=[RIDDLES[last].id];`);
  assert.equal(app.run('selectRiddleIndex({roundIndex:5,environment:"雪景",playedIndices:blocked})'), app.run('last'));
  assert.equal(app.run('selectRiddleIndex({playedIndices:RIDDLES.map((r,i)=>i),environment:"车库"})'), null);
});

test('same context reuses a selection even if random generators and recent history change later', () => {
  const app = client();
  app.run(`const options={gameId:'stable',roundIndex:2,environment:'城区雨天白天',playedIndices:[1],previousIndex:1};
    const first=selectRiddleIndex(options); recentRiddleIds=[RIDDLES[first].id];
    Math.random=()=>{throw new Error('Must not reroll');};`);
  assert.equal(app.run('selectRiddleIndex(options)'), app.run('first'));
  assert.equal(app.run('selectRiddleIndex({...options,environment:"高速路雨天白天"})'), app.run('first'));
});

test('a future preview carries only the selected future hint, never the active puzzle clues', () => {
  const app = client();
  app.run(`state.game.publicClues=['旧题额外线索'];
    const target={gameId:'future',roundId:'future-round-2',roundIndex:2,
      riddleIndex:5,timelineId:ROUND_GOLDEN_TIMELINES[0].id,
      scenarioId:GOLDEN_TIMELINES[0].id,relationship:GOLDEN_TIMELINES[0].relationship};
    const input=buildRoundPreviewInput(target);`);
  assert.deepEqual(app.value('input.game.public_clues'), app.value('[RIDDLES[5].hint]'));
});

test('new living, food and abstract answers never inherit the old ten-item fallback facts', () => {
  const app = client();
  for (const answer of ['猫', '蜜蜂', '面条', '时间', '散步']) {
    app.run(`state.game.currentRiddleIndex=RIDDLES.findIndex(r=>r.answer===${JSON.stringify(answer)});
      state.game.status='playing'; state.game.questionCount=0;
      globalThis.reply=localDecision(buildFullWorkflowInput('chat',null,'它有生命吗？'),new Error('fixture'));`);
    assert.equal(app.run('reply.intent'), 'fallback');
    assert.match(app.run('reply.ai_reply_text'), /先不乱答/);
    assert.deepEqual(app.value('reply.covered_fact_keys'), []);
  }
});
