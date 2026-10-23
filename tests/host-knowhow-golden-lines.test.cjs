const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/主持经验库-v1.jsonl'), 'utf8');
const rows = source.trim().split(/\r?\n/).map(JSON.parse);
const record = id => rows.find(row => row.knowhow_id === id);
const content = id => JSON.stringify(record(id));
const syncPath = path.join(root, 'tools/dify-workflow-mcp/scripts/sync-host-knowhow.mjs');

test('28 stable knowledge IDs preserve existing guards and achievement entries', () => {
  assert.deepEqual(rows.map(row => row.knowhow_id), Array.from({ length: 28 }, (_, i) => `HK${String(i + 1).padStart(2, '0')}`));
  const changed = ['HK01', 'HK02', 'HK03', 'HK04', 'HK05', 'HK06', 'HK07', 'HK08', 'HK09', 'HK24', 'HK25', 'HK26', 'HK28'];
  assert.deepEqual(rows.filter(row => row.version === '5.0').map(row => row.knowhow_id), changed);
  for (const row of rows.filter(row => !changed.includes(row.knowhow_id))) assert.equal(row.version, '2.0');
});

test('every default strategy is allowed by the existing knowledge output guard', () => {
  const code = `
import json
from pathlib import Path
scope = {"main": lambda *args, **kwargs: None}
exec(Path("tools/dify-workflow-mcp/workflows/host/src/knowhow_guard.py").read_text(), scope)
print(json.dumps({key: sorted(value) for key, value in scope["STRATEGY_BY_ID"].items()}))
`;
  const result = spawnSync('python3', ['-c', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const strategies = JSON.parse(result.stdout);
  for (const row of rows) assert.ok(strategies[row.knowhow_id]?.includes(row.recommended_strategy), row.knowhow_id);
});

test('upload paragraphs round-trip through the actual retrieval parser without truncating a record', async () => {
  const { renderKnowhowUpload } = await import(pathToFileURL(syncPath).href);
  const markdown = fs.readFileSync(path.join(root, 'docs/主持经验库-v1.md'), 'utf8');
  assert.equal(markdown, renderKnowhowUpload(rows));
  assert.deepEqual(markdown.trim().split('\n\n').map(JSON.parse), rows);
  const code = `
import json
from pathlib import Path
rows = [json.loads(line) for line in Path("docs/主持经验库-v1.jsonl").read_text().splitlines()]
scope = {}
exec(Path("tools/dify-workflow-mcp/workflows/host/src/knowhow_context.py").read_text(), scope)
for row in rows:
    serialized = json.dumps(row, ensure_ascii=False, separators=(",", ":"))
    assert len(serialized) < 4000
    out = scope["main"]("{}", [{"content": serialized}], "[]")
    assert out["knowhow_status"] == "used", row["knowhow_id"]
    actual = json.loads(out["director_context"])["knowhow"]["retrieved"][0]
    assert actual["knowhow_id"] == row["knowhow_id"]
    assert json.loads(actual["content"]) == row
print("28 complete records pass the existing retrieval parser")
`;
  const result = spawnSync('python3', ['-c', code], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('help and independent thinking have contextual examples without treating knowledge examples as facts', () => {
  assert.match(content('HK01'), /太难了，帮帮我/);
  assert.match(content('HK01'), /太难了，但让我再想想/);
  assert.match(content('HK02'), /唯一复述来源/);
  assert.match(content('HK02'), /相同的公开事实/);
  assert.match(content('HK03'), /不追加线索、不邀请他人/);
  assert.ok(record('HK02').examples.every(example => example.context));
});

test('collaboration resolves current identities and cannot invite a sleeping member, driver or baby', () => {
  assert.match(content('HK04'), /eligible_target_seats/);
  assert.match(content('HK04'), /主驾/);
  assert.match(content('HK04'), /婴儿/);
  assert.match(content('HK04'), /左后爷爷睡着/);
  assert.match(content('HK04'), /先征求同意/);
  assert.match(content('HK28'), /随机选择可参与成员/);
  assert.match(content('HK28'), /代替副驾生成发言/);
});

test('sleep care preserves memory temperature, execution receipts and manual overrides', () => {
  const row = content('HK05');
  for (const token of ['cabin.apply_sleep_comfort', 'cabin.restore_sleep_comfort', '用户记忆值',
    '不关闭空调', '睡前设置', '手动', '气泡实际显示', '未执行先说已经调好', '全车背景音乐']) assert.ok(row.includes(token), token);
});

test('environment and safety knowledge does not authorize retrieval on the P0 fast path or force next questions', () => {
  const row = content('HK06');
  for (const token of ['车库', '隧道', '雪景', '雨天', '城市白天', '城市夜晚', '风景区', '傍晚', '深夜',
    '不等待经验检索', '没有专属题库', '不改本题谜底', '代码判定', '不宣称已减速', '不邀请游戏提神']) assert.ok(row.includes(token), token);
  assert.match(content('HK08'), /固定等待时长不代表道路已经安全/);
  assert.match(content('HK08'), /五分钟黄金线不绑定题号/);
  assert.match(content('HK09'), /04:40/);
  assert.match(content('HK09'), /不等于整局结束/);
});

test('mixed controls bind to the actual speaker, keep game pause scoped and never equate audio zones with global music', () => {
  const row = content('HK07');
  for (const token of ['speaker_seat', 'music.set_enabled', 'cabin.set_zone_light', 'game.set_paused',
    '不能解除安全暂停', '否定、引用或假设', '分区音频独立', '它会关灯吗', 'speaker_seat=rearLeft']) assert.ok(row.includes(token), token);
  assert.match(content('HK24'), /不提高全车音量/);
  assert.match(content('HK26'), /不修改真实用户偏好/);
});

test('both maintenance entry points are idempotent and never downgrade the canonical source', () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'golden-knowhow-')));
  try {
    const scripts = path.join(temporary, 'tools/dify-workflow-mcp/scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(path.join(temporary, 'docs'));
    fs.writeFileSync(path.join(temporary, 'docs/主持经验库-v1.jsonl'), source);
    for (const name of ['sync-host-knowhow.mjs', 'update-cabin-knowhow.mjs']) {
      fs.copyFileSync(path.join(root, 'tools/dify-workflow-mcp/scripts', name), path.join(scripts, name));
    }
    for (const name of ['sync-host-knowhow.mjs', 'update-cabin-knowhow.mjs', 'update-cabin-knowhow.mjs']) {
      const result = spawnSync(process.execPath, [path.join(scripts, name)], { cwd: temporary, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.readFileSync(path.join(temporary, 'docs/主持经验库-v1.jsonl'), 'utf8'), source);
    }
    assert.deepEqual(fs.readFileSync(path.join(temporary, 'docs/主持经验库-v1.md'), 'utf8').trim().split('\n\n').map(JSON.parse), rows);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('upload validation rejects duplicate, incomplete and wrongly typed records', async () => {
  const { renderKnowhowUpload } = await import(pathToFileURL(syncPath).href);
  assert.throws(() => renderKnowhowUpload([rows[0], rows[0]]));
  assert.throws(() => renderKnowhowUpload([{ ...rows[0], title: '' }]));
  assert.throws(() => renderKnowhowUpload([{ ...rows[0], recommended_actions: 'not a list' }]));
  assert.throws(() => renderKnowhowUpload([{ ...rows[0], examples: [{ user: 'question' }] }]));
});
