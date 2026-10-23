const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const assetDir = path.join(root, 'assets');
const files = fs.readdirSync(assetDir).filter(name => !name.startsWith('.'));
const runtime = ['index.html', 'styles.css', 'client-app.js']
  .map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');

test('all literal runtime asset references and sprite dependencies exist', () => {
  const references = [...runtime.matchAll(/\.\/assets\/([\w.-]+\.(?:png|webp|svg|json|mp3|m4a))/g)]
    .map(match => match[1]);
  assert.ok(references.length > 100);
  for (const name of references) {
    assert.ok(fs.existsSync(path.join(assetDir, name)), `Missing runtime asset: ${name}`);
  }
  for (const name of files.filter(name => name.endsWith('.json'))) {
    const meta = JSON.parse(fs.readFileSync(path.join(assetDir, name), 'utf8'));
    for (const dependency of [meta.meta?.image, meta.audio?.src].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(assetDir, dependency)), `${name} references missing ${dependency}`);
    }
  }
});

test('remaining assets are reachable from runtime code or referenced asset metadata', () => {
  const reachable = new Set(files.filter(name => runtime.includes(name)));
  for (const name of reachable) {
    if (!/\.(json|svg)$/.test(name)) continue;
    const contents = fs.readFileSync(path.join(assetDir, name), 'utf8');
    for (const dependency of files) if (contents.includes(dependency)) reachable.add(dependency);
  }
  assert.deepEqual(files.filter(name => !reachable.has(name)), []);
});

test('retired resources and reveal ring cannot be requested by the app', () => {
  for (const name of ['background-music.m4a', 'host-puzzled.png', 'host-wave.json',
    'host-wave.webp', 'host-wave.png', 'host-wave.mp3', 'figma-reveal-light-ring.png', 'host-yes-square.png']) {
    assert.equal(fs.existsSync(path.join(assetDir, name)), false, name);
    assert.equal(runtime.includes(name), false, name);
  }
  assert.equal(runtime.includes('reveal-ring'), false);
});
