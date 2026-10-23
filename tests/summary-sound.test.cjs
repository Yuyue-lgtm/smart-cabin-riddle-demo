const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {test} = require('node:test');
const source = fs.readFileSync(require.resolve('../client-app.js'),'utf8')
  .replace(/\ninstallClientErrorDiagnostics\(\);\s*\nboot\(\);\s*$/,'\n');

function client() {
  const notes=[],envelopes=[];
  let now=100000,id=0;
  const timers=new Map();
  const schedule=(callback,delay=0)=>{timers.set(++id,{callback,at:now+delay});return id;};
  let resume;
  const audio={state:'running',currentTime:10,destination:{},
    createOscillator(){ const note={frequency:0,start:0,end:0,type:''};notes.push(note);
      return {set type(value){note.type=value;},frequency:{setValueAtTime(value){note.frequency=value;}},
        connect(){},disconnect(){},start(time){note.start=time;},stop(time){note.end=time;}}; },
    createGain(){const envelope=[];envelopes.push(envelope);
      return {gain:{setValueAtTime(value){envelope.push(value);},exponentialRampToValueAtTime(value){envelope.push(value);}},connect(){},disconnect(){}};},
    resume(){return new Promise(resolve=>{resume=()=>{audio.state='running';resolve();};});},
  };
  const context=vm.createContext({structuredClone,console,crypto:webcrypto,audio,
    Date:class extends Date {static now(){return now;}},
    window:{setTimeout:schedule,clearTimeout:id=>timers.delete(id),
      requestAnimationFrame:callback=>schedule(callback,16),cancelAnimationFrame:id=>timers.delete(id)},
    localStorage:{getItem:()=>null,setItem(){}}});
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run('prepareAudioContext=()=>audio; startupLoading.active=false; state.game.status="summary";');
  run(`let mvpStart=simulationRuntime.now();
    const mvpTiming={delay:3500,duration:1800};
    const mvpAnimation={animationName:'summary-mvp-emphasis',effect:{getTiming:()=>mvpTiming},
      get currentTime(){return simulationRuntime.now()-mvpStart;}};
    const mvpGroup={getAnimations:()=>[mvpAnimation]};
    els.summaryMvp={closest:()=>mvpGroup};`);
  return {run,audio,notes,envelopes,resume:()=>resume(),advance(ms){
    const end=now+ms;
    for(;;){
      const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next||next[1].at>end)break;
      now=next[1].at;timers.delete(next[0]);next[1].callback();
    }
    now=end;
  }};
}

test('summary chime has two identical-pitch metal strikes and plays with background music off',()=>{
  const app=client();
  assert.equal(app.run('backgroundMusic.enabled'),false);
  app.run('playSummarySound()');
  assert.equal(app.notes.length,6);
  const starts=[...new Set(app.notes.map(note=>note.start))];
  assert.deepEqual(starts,[10,10.26]);
  assert.deepEqual(app.notes.filter((_,i)=>i%3===0).map(note=>note.frequency),[659.25,659.25]);
  assert.deepEqual(app.notes.slice(0,3).map(note=>note.frequency),app.notes.slice(3).map(note=>note.frequency));
  assert.ok(app.notes.every(note=>note.type==='sine'&&note.end>note.start&&note.end<11));
});

test('summary chime follows actual MVP enlargement, and pauses with the animation',()=>{
  const app=client();app.run('scheduleSummarySound()');app.advance(3823);
  assert.equal(app.notes.length,0);app.advance(17);assert.equal(app.notes.length,6);
  const paused=client();paused.run('scheduleSummarySound()');paused.advance(1000);
  paused.run('simulationRuntime.pause()');paused.advance(10000);assert.equal(paused.notes.length,0);
  paused.run('simulationRuntime.resume()');paused.advance(2823);assert.equal(paused.notes.length,0);
  paused.advance(17);assert.equal(paused.notes.length,6);
});

test('both summary strikes and their overtones use half of the previous volume envelope',()=>{
  const app=client();app.run('playSummarySound()');
  assert.equal(app.envelopes.length,6);
  app.envelopes.forEach((envelope,index)=>{
    assert.deepEqual(envelope,[0.00005,0.1/(index%3+1)**2,0.00005]);
  });
});

test('changing MVP animation timing moves the sound without changing a separate timer',()=>{
  const app=client();app.run('mvpTiming.delay=100; mvpTiming.duration=1000; scheduleSummarySound()');
  app.advance(279);assert.equal(app.notes.length,0);app.advance(17);assert.equal(app.notes.length,6);
});

test('reduced motion shows the MVP with a single immediate chime',()=>{
  const app=client();app.run('mvpGroup.getAnimations=()=>[]; scheduleSummarySound()');
  app.advance(16);assert.equal(app.notes.length,6);app.advance(5000);assert.equal(app.notes.length,6);
});

test('exiting, resetting or replacing the summary cancels its pending MVP sound',()=>{
  for(const change of ['cancelSummarySound();','state.game.status="idle";', 'state.workflow.gameId="new-game";']){
    const app=client();app.run('scheduleSummarySound()');app.advance(300);app.run(change);app.advance(4000);
    assert.equal(app.notes.length,0);
  }
});

test('an old audio resume cannot play after leaving and re-entering the same summary',async()=>{
  const app=client();app.audio.state='suspended';app.run('scheduleSummarySound()');app.advance(3840);
  app.run('cancelSummarySound();mvpStart=simulationRuntime.now();scheduleSummarySound()');app.resume();await Promise.resolve();
  assert.equal(app.notes.length,0);app.advance(3840);assert.equal(app.notes.length,6);
});

test('summary chime never starts while simulation is paused or outside summary',()=>{
  for(const change of ['simulationRuntime.pause();','state.game.status="playing";']) {
    const app=client();app.run(change+'playSummarySound()');assert.equal(app.notes.length,0);
  }
});

test('late audio-context resume does not play an old summary after exit or reset',async()=>{
  for(const change of ['state.game.status="idle";','state.workflow.gameId="another-game";','simulationRuntime.pause();']) {
    const app=client();app.audio.state='suspended';app.run('playSummarySound();'+change);
    app.resume();await Promise.resolve();assert.equal(app.notes.length,0);
  }
});

test('a suspended audio context can play the active summary when permission resumes',async()=>{
  const app=client();app.audio.state='suspended';app.run('playSummarySound()');
  assert.equal(app.notes.length,0);app.resume();await Promise.resolve();assert.equal(app.notes.length,6);
});
