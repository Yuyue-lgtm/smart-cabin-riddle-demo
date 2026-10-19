const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");

const clientSource = fs.readFileSync(require.resolve("../client-app.js"), "utf8")
  .replace(/\nboot\(\);\s*$/, "\n");
const html = fs.readFileSync(require.resolve("../index.html"), "utf8");
const css = fs.readFileSync(require.resolve("../styles.css"), "utf8");

function createClient() {
  const context = vm.createContext({
    structuredClone,
    console,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    window: { setTimeout, clearTimeout, setInterval, clearInterval },
    localStorage: { getItem: () => null, setItem() {} },
  });
  vm.runInContext(clientSource, context);
  return {
    run: (code) => vm.runInContext(code, context),
    value: (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)),
  };
}

test("game screen music toggle follows Figma placement and is visible only while playing", () => {
  assert.match(html, /id="backgroundMusicToggleGame"/);
  assert.match(css, /\.game-sound-toggle\s*\{[^}]*top:\s*111px;[^}]*right:\s*31px;[^}]*z-index:\s*7;[^}]*display:\s*none;/s);
  assert.match(css, /\.game-screen \.host-bubble\s*\{\s*z-index:\s*8;/);
  assert.match(css, /\.screen-playing \.game-sound-toggle\s*\{\s*display:\s*grid;/);
  assert.match(css, /\.screen-reveal \.game-sound-toggle\s*\{\s*display:\s*grid;/);
  assert.match(css, /\.game-sound-toggle\s*\{[^}]*background:\s*rgba\(78, 78, 78, 0\.09\);/s);
  assert.match(css, /\.game-sound-toggle:hover\s*\{\s*background:\s*rgba\(255, 255, 255, 0\.12\);\s*\}/);
});

test("ready and in-game toggles share the same pressed state and icon", () => {
  const app = createClient();
  app.run(`
    const makeToggle = () => {
      const attrs = {};
      const icon = { textContent: "" };
      return {
        attrs,
        icon,
        setAttribute(name, value) { attrs[name] = value; },
        querySelector() { return icon; },
      };
    };
    els.backgroundMusicToggle = makeToggle();
    els.backgroundMusicToggleGame = makeToggle();
    backgroundMusic.enabled = false;
    syncBackgroundMusicToggle();
    backgroundMusic.enabled = true;
    syncBackgroundMusicToggle();
  `);

  assert.deepEqual(app.value("[els.backgroundMusicToggle.attrs, els.backgroundMusicToggleGame.attrs]"), [
    { "aria-pressed": "true", "aria-label": "关闭背景音乐" },
    { "aria-pressed": "true", "aria-label": "关闭背景音乐" },
  ]);
  assert.deepEqual(app.value("[els.backgroundMusicToggle.icon.textContent, els.backgroundMusicToggleGame.icon.textContent]"), ["🔊", "🔊"]);
});

test("decision arrows are enabled only for columns with content", () => {
  const app = createClient();
  const states = app.value(`(() => {
    const values = ["", "", "执行内容"];
    const columns = values.map((_, index) => {
      const classes = new Set();
      return {
        classes,
        querySelector: () => ({ textContent: values[index] }),
        classList: {
          toggle(name, enabled) {
            if (enabled) classes.add(name);
            else classes.delete(name);
          },
        },
      };
    });
    els.decisionPerception = {
      closest: () => ({ querySelectorAll: () => columns }),
    };
    syncDecisionTraceArrows();
    const empty = columns.map((column) => column.classes.has("is-blocked"));
    values[0] = "感知内容";
    syncDecisionTraceArrows();
    const perceptionOnly = columns.map((column) => ({
      content: column.classes.has("has-content"),
      blocked: column.classes.has("is-blocked"),
    }));
    values[1] = "决策内容";
    syncDecisionTraceArrows();
    const perceptionAndDecision = columns.map((column) => column.classes.has("is-blocked"));
    return { empty, perceptionOnly, perceptionAndDecision };
  })()`);
  assert.deepEqual(states.empty, [false, true, true]);
  assert.deepEqual(states.perceptionOnly, [
    { content: true, blocked: false },
    { content: false, blocked: false },
    { content: true, blocked: true },
  ]);
  assert.deepEqual(states.perceptionAndDecision, [false, false, false]);
});

test("manual event buttons stay disabled for four seconds after click", () => {
  const app = createClient();
  const result = app.value(`(() => {
    let callback;
    let delay;
    globalThis.setTimeout = (fn, ms) => {
      callback = fn;
      delay = ms;
      return 1;
    };
    renderControls = () => {};
    const buttons = [{ disabled: false }, { disabled: false }, { disabled: false }];
    const firstClick = beginManualEventCooldown(buttons);
    const disabledAfterClick = buttons.map((button) => button.disabled);
    const repeatedClick = beginManualEventCooldown(buttons);
    callback();
    return {
      firstClick,
      disabledAfterClick,
      repeatedClick,
      delay,
      enabledAfterCooldown: buttons.map((button) => !button.disabled),
    };
  })()`);
  assert.deepEqual(result, {
    firstClick: true,
    disabledAfterClick: [true, true, true],
    repeatedClick: false,
    delay: 4000,
    enabledAfterCooldown: [true, true, true],
  });
});
