const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync('client-app.js', 'utf8').split('const simulationRuntime =')[0];
const createRuntime = vm.runInNewContext(`${source}\ncreateSimulationRuntime`);

function fixture() {
  let wall = 100000, id = 0;
  const tasks = new Map();
  const host = {
    Date: { now: () => wall }, performance: { now: () => wall - 100000 },
    setTimeout(callback, ms) { tasks.set(++id, { callback, at: wall + ms }); return id; },
    clearTimeout(handle) { tasks.delete(handle); },
    requestAnimationFrame(callback) { return host.setTimeout(callback, 16); },
    cancelAnimationFrame(handle) { host.clearTimeout(handle); },
  };
  const runtime = createRuntime(host);
  function advance(ms) {
    const end = wall + ms;
    for (;;) {
      const next = [...tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      wall = next[1].at; tasks.delete(next[0]); next[1].callback();
    }
    wall = end;
  }
  return { runtime, advance };
}

test('simulation timeout preserves exact remaining delay across long and repeated pauses', () => {
  const { runtime: r, advance } = fixture();
  let calls = 0;
  r.setTimeout(() => calls++, 6000);
  advance(1500); r.pause();
  const frozen = r.now(), frame = r.frameNow();
  advance(120000);
  assert.equal(r.now(), frozen); assert.equal(r.frameNow(), frame);
  assert.equal(r.wallNow() - r.now(), 120000); assert.equal(calls, 0);
  r.resume(); advance(2000); r.pause(); advance(9000); r.resume();
  advance(2499); assert.equal(calls, 0);
  advance(1); assert.equal(calls, 1);
});

test('simulation intervals resume remaining tick without catch-up and keep cancellable handles', () => {
  const { runtime: r, advance } = fixture();
  let calls = 0;
  const handle = r.setInterval(() => calls++, 1000);
  advance(1300); assert.equal(calls, 1);
  r.pause(); advance(8000); r.resume(); advance(699); assert.equal(calls, 1);
  advance(1); assert.equal(calls, 2);
  advance(1000); assert.equal(calls, 3);
  r.clearInterval(handle); advance(10000); assert.equal(calls, 3);
});

test('simulation RAF timestamps exclude pause and cancellation survives rearming', () => {
  const { runtime: r, advance } = fixture();
  const frames = [];
  r.requestAnimationFrame(time => frames.push(time));
  advance(16); assert.deepEqual(frames, [16]);
  const handle = r.requestAnimationFrame(time => frames.push(time));
  r.pause(); advance(7000); r.resume(); r.cancelAnimationFrame(handle);
  r.requestAnimationFrame(time => frames.push(time)); advance(16);
  assert.deepEqual(frames, [16, 32]);
});

test('timers registered during freeze remain parked and may be cancelled', () => {
  const { runtime: r, advance } = fixture();
  const values = [];
  r.pause();
  const handle = r.setTimeout(() => values.push('cancelled'), 10);
  r.setTimeout(value => values.push(value), 500, 'kept');
  r.clearTimeout(handle); advance(9000); assert.deepEqual(values, []);
  r.resume(); advance(499); assert.deepEqual(values, []);
  advance(1); assert.deepEqual(values, ['kept']);
});

test('async outputs and deferred image callbacks wait for resume', async () => {
  const { runtime: r, advance } = fixture();
  let result = false, image = false;
  r.pause();
  const waiting = r.waitUntilRunning().then(() => { result = true; });
  r.defer(() => { image = true; });
  advance(12000); await Promise.resolve();
  assert.equal(result, false); assert.equal(image, false);
  r.resume(); await waiting; await Promise.resolve();
  assert.equal(result, true); assert.equal(image, true);
});
