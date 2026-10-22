const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../client-app.js'), 'utf8');
const layout = source.slice(source.indexOf('function syncViewportLayout()'), source.indexOf('function toggleGameDisplayMode()'));

function fixture({ expanded = false, paused = false } = {}) {
  const style = { transform: 'scale(0.5)', top: '0px', left: '0px' };
  const screenStyle = { value: '0.5', setProperty(name, value) { this.value = value; } };
  const diagnostics = [];
  const context = vm.createContext({
    STAGE_WIDTH: 1940, STAGE_HEIGHT: 1100, window: { innerWidth: 1280, innerHeight: 720 },
    simulationRuntime: { paused },
    els: { appShell: { style, classList: { contains: () => expanded },
      getBoundingClientRect: () => ({ width: style.transform === 'scale(0)' ? 0 : 970, height: 550 }) },
      gameScreen: { style: screenStyle } },
    canvasResizes: 0,
    resizeConfettiCanvas() { context.canvasResizes++; },
    resizeSummaryConfettiCanvas() { context.canvasResizes++; },
    recordClientPageState: stage => diagnostics.push(stage),
  });
  vm.runInContext(layout, context);
  return { context, style, screenStyle, diagnostics, run: code => vm.runInContext(code, context) };
}

test('transient zero or invalid viewport never collapses the last usable layout', () => {
  for (const size of [0, -1, NaN, Infinity]) {
    const f = fixture();
    f.context.window.innerHeight = size;
    f.run('resizeStage()');
    assert.equal(f.style.transform, 'scale(0.5)');
    assert.deepEqual(f.diagnostics, ['layout_invalid']);
  }
});

test('resizing while paused repairs collapsed geometry without resuming the simulation', () => {
  const f = fixture({ paused: true });
  f.style.transform = 'scale(0)';
  f.run('syncViewportLayout()');
  assert.equal(f.style.transform, `scale(${720 / 1100})`);
  assert.equal(f.context.simulationRuntime.paused, true);
  assert.equal(f.context.canvasResizes, 0);
  assert.deepEqual(f.diagnostics, ['layout_recovered']);
});

test('expanded display preserves its usable scale during a transient zero viewport', () => {
  const f = fixture({ expanded: true, paused: true });
  f.context.window.innerHeight = 0;
  f.run('syncViewportLayout()');
  assert.equal(f.screenStyle.value, '0.5');
  f.context.window.innerHeight = 720;
  f.run('syncViewportLayout()');
  assert.equal(Number(f.screenStyle.value), Math.min(1280 / 1440, 636 / 810));
});
